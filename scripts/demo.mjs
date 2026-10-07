// Reproducible demo scenarios for the Ring Drive video. All seed data is flagged and labeled as simulated.
//
//   node scripts/demo.mjs 0815 [--auto] [--wait SECONDS]
//     Child not seen leaving → push to the child → no acknowledgement → driver alerted → driver asks Siri to notify
//     the household. With --auto the driver's Siri choice and the household acknowledgement are played headlessly
//     through the same backend APIs the apps use, recorded with source "rehearsal".
//
//   node scripts/demo.mjs multicam [--backend-only]
//     Person at the side camera, then the back door for 85 s → driver alert → explanation → find a safe stop →
//     parked → video unlocked with a per-camera timeline. Starts the labeled in-app scenario through a deep link
//     when an iOS Simulator is booted, and follows the incident on the backend. --backend-only posts the same
//     observations to the backend (as the app would after on-device triage) to show the summary and timeline.
//
//   node scripts/demo.mjs reset      Removes the simulated demo contacts and rule.
import {spawn, spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {loadEnvFile} from 'node:process';
import {setTimeout as sleep} from 'node:timers/promises';
import {segments, clockTime} from '../Relay/summary.mjs';

try { loadEnvFile(new URL('../Relay/.env.local', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const port = process.env.PORT || 8787, base = process.env.BACKEND_URL ?? `http://127.0.0.1:${port}`, token = process.env.RELAY_CLIENT_TOKEN;
if (!token) { console.error('RELAY_CLIENT_TOKEN missing. Run node scripts/setup_ring.mjs first.'); process.exit(2); }
const [scenario, ...flags] = process.argv.slice(2);
const flag = name => flags.includes(name);
const option = (name, fallback) => { const i = flags.indexOf(name); return i >= 0 ? Number(flags[i + 1]) : fallback; };
const timeZone = process.env.DEMO_TIME_ZONE || 'Europe/Amsterdam';
const RULE_NAME = 'School run (simulated)';
const say = (step, text) => console.log(`\n▶ ${step}  ${text}`);

async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, {method, headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body:body && JSON.stringify(body)});
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} → HTTP ${response.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
async function waitFor(check, seconds, label) {
  for (const end = Date.now() + seconds * 1000; Date.now() < end; await sleep(1000)) { const value = await check(); if (value) return value; }
  throw new Error(`Timed out waiting for ${label}`);
}

let backend = null;
async function ensureBackend() {
  try { if ((await fetch(base + '/health')).ok) return; } catch {}
  console.log(`Starting the backend on ${base} (simulation enabled)…`);
  backend = spawn(process.execPath, ['--env-file-if-exists=.env.local', 'server.mjs'], {cwd:new URL('../Relay/', import.meta.url),
    env:{...process.env, SIMULATION_ENABLED:'1'}, stdio:['ignore','inherit','inherit']});
  await waitFor(async () => { try { return (await fetch(base + '/health')).ok; } catch { return false; } }, 15, 'the backend');
}
function finish(keepRunning) {
  if (backend && keepRunning) { console.log('\nThe backend started by this script keeps running for the phone part. Press Ctrl-C to stop.'); return; }
  backend?.kill(); process.exit(0);
}

async function seedHousehold() {
  for (const c of (await call('/contacts')).data.filter(c => c.simulated)) await call(`/contacts/${c.id}`, 'DELETE');
  const add = body => call('/contacts', 'POST', {...body, simulated:true}).then(r => r.data);
  const people = {
    Sanne: await add({name:'Sanne', role:'monitored', priority:1}),
    Thomas: await add({name:'Thomas', role:'household', priority:1}),
    Lisa: await add({name:'Lisa', role:'household', priority:2}),
    Oma: await add({name:'Oma', role:'emergency', channel:'call', phone:'+31000000000', priority:1}),
  };
  await call(`/members/${people.Thomas.id}/status`, 'POST', {driving:false, source:'simulated'});
  await call(`/members/${people.Lisa.id}/status`, 'POST', {driving:true, source:'simulated'});
  return people;
}
async function removeDemoRules() {
  for (const r of (await call('/rules')).data.filter(r => r.name === RULE_NAME)) await call(`/rules/${r.id}`, 'DELETE');
}
function printTimeline(incident) {
  console.log('\nTimeline (backend):');
  for (const e of incident.audit ?? []) console.log(`  ${clockTime(Date.parse(e.at), timeZone)}  ${e.state.padEnd(18)} ${e.choice ? `[${e.choice}] ` : ''}${e.note}${e.source ? `  (${e.source})` : ''}`);
}
function printCameraTimeline(incident) {
  console.log('\nPer-camera timeline:');
  for (const s of segments(incident.observations ?? [])) {
    console.log(`  ${s.camera.padEnd(16)} ${clockTime(s.firstMs, timeZone)}${s.count > 1 ? `–${clockTime(s.lastMs, timeZone)}  ${s.seconds} s, ${s.count} observations` : ''}  ${s.kind}`);
  }
}

async function scenario0815() {
  const wait = option('--wait', 20);
  await removeDemoRules();
  const people = await seedHousehold();
  say('Seed', 'Simulated household: Sanne (monitored), Thomas (home, not driving), Lisa (driving, the driver iPhone), Oma (emergency).');
  const rule = (await call('/rules', 'POST', {name:RULE_NAME, personLabel:'Sanne', daysOfWeek:['sun','mon','tue','wed','thu','fri','sat'],
    window:{start:'07:30', end:'08:15'}, timeZone, evidenceSource:'simulated',
    exitCameras:[{deviceId:'demo-front', label:'front door'}, {deviceId:'demo-side', label:'side gate'}, {deviceId:'demo-back', label:'back door'}],
    escalation:[{target:'monitored', message:'School starts in 15 minutes'}, {target:'driver', afterSeconds:wait}]})).data;
  // The most recent 07:30–08:15 window that has ended, in the household time zone.
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23'})
    .formatToParts(new Date()).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const date = `${parts.hour}:${parts.minute}` >= '08:15' ? today : new Date(Date.parse(today + 'T12:00:00Z') - 86400000).toISOString().slice(0, 10);
  const run = (await call(`/rules/${rule.id}/evaluate`, 'POST', {date})).data;
  if (run.outcome !== 'absence') throw new Error(`Expected an absence, got ${run.outcome}`);
  say('08:15', `Absence rule fired for ${date}: no simulated person observation at any exit camera.`);
  const withSummary = await waitFor(async () => { const i = (await call(`/incidents/${run.incidentId}`)).data; return i.summaryStatus === 'ready' && i; }, 30, 'the summary');
  console.log(`  Stored summary (${withSummary.summary.source}${withSummary.summary.fallbackReason ? `, ${withSummary.summary.fallbackReason}` : ''}):\n  "${withSummary.summary.text}"`);
  const reminder = (await call(`/members/${people.Sanne.id}/inbox`)).data[0];
  say('Step 1', `Push to Sanne: "${reminder.message}". Waiting ${wait} s for an acknowledgement…`);
  await waitFor(async () => (await call(`/incidents/${run.incidentId}`)).data.state === 'NOTIFIED', wait + 20, 'the driver step');
  say('Step 2', 'No acknowledgement → driver alerted. The driver iPhone (member Lisa) adopts the incident, speaks the summary and updates the Live Activity.');
  if (flag('--auto')) {
    const entry = (state, extra = {}) => ({id:randomUUID(), at:new Date().toISOString(), state, source:'rehearsal', ...extra});
    await call(`/incidents/${run.incidentId}/audit`, 'POST', {entries:[entry('EXPLAINED', {note:'Rehearsal: summary read aloud by Siri'})]});
    await call(`/incidents/${run.incidentId}/audit`, 'POST', {entries:[entry('HOUSEHOLD_NOTIFIED', {choice:'NOTIFY_HOUSEHOLD', note:'Rehearsal: "Hey Siri, notify my household with Ring Drive"'})]});
    const sent = (await call(`/incidents/${run.incidentId}/notify-household`, 'POST', {requestedBy:people.Lisa.id})).data;
    say('Step 3', `Driver → Siri: notify household → ${sent.map(n => n.contactName).join(', ') || 'nobody (everyone driving)'} (Lisa is driving, so she is never chosen).`);
    await sleep(3000);
    const [toThomas] = (await call(`/members/${people.Thomas.id}/inbox`)).data;
    await call(`/notifications/${toThomas.id}/ack`, 'POST', {contactId:people.Thomas.id});
    say('Step 4', 'Thomas taps "I\'ve seen this" → Live Activity outcome: "Thomas has seen this".');
  } else {
    console.log(`
On the driver iPhone (the app's Household tab → "This iPhone belongs to" = Lisa; backend key saved in Demo & Ring):
  1. Wait for the alert (the app checks every 15 s), then say: "Hey Siri, explain my Ring Drive alert".
  2. Say: "Hey Siri, notify my household with Ring Drive" → Thomas is notified (Lisa is driving).
  3. On Thomas's iPhone (member Thomas), tap "I've seen this", or run:
       node scripts/household.mjs inbox ${people.Thomas.id}
       node scripts/household.mjs ack <notification-id> ${people.Thomas.id}
  Then re-run with --auto for a headless rehearsal of the same steps.`);
  }
  printTimeline((await call(`/incidents/${run.incidentId}`)).data);
  finish(!flag('--auto'));
}

async function scenarioMulticam() {
  const started = Date.now();
  if (flag('--backend-only')) {
    const now = Date.now(), at = s => now + s * 1000;
    const observations = [[1,'demo-side','side',-100],[2,'demo-back','rear',-86],[3,'demo-back','rear',-45],[4,'demo-back','rear',-1]]
      .map(([n, deviceId, zone, s]) => ({id:`demo-${n}-${randomUUID()}`, deviceId, zone, kind:'person', atMs:at(s), confidence:0.94, cameraName:zone === 'side' ? 'side camera' : 'back door'}));
    const created = (await call('/incidents', 'POST', {id:randomUUID(), priority:'urgent', simulated:true, timeZone, observations})).data;
    say('Rehearsal', 'Posted the simulated observations as the app does after on-device triage (side camera, then back door for 85 s).');
    const incident = await waitFor(async () => { const i = (await call(`/incidents/${created.id}`)).data; return i.summaryStatus === 'ready' && i; }, 30, 'the summary');
    console.log(`  Stored summary (${incident.summary.source}${incident.summary.fallbackReason ? `, ${incident.summary.fallbackReason}` : ''}):\n  "${incident.summary.text}"`);
    printCameraTimeline(incident);
    console.log('\nThe driver steps (explanation, find a safe stop, parked, video) run on the iPhone; see the README demo script.');
    return finish(false);
  }
  const simctl = spawnSync('xcrun', ['simctl', 'openurl', 'booted', 'ringdrive://demo/multicam'], {encoding:'utf8'});
  if (simctl.status === 0) say('Start', 'Opened ringdrive://demo/multicam in the booted iOS Simulator.');
  else say('Start', 'No booted iOS Simulator found. In the app: Demo & Ring → "Side camera → back door for 85 s" (or open ringdrive://demo/multicam).');
  console.log(`
On the iPhone: Listen to explanation → Find a safe place to stop → Simulate arrival & standstill (20 s) → I'm safely parked →
Incident timeline (per-camera timeline) → Review incident video. Following the incident on the backend (Ctrl-C to stop)…`);
  const seen = new Set(); let incident;
  for (const end = Date.now() + 15 * 60000; Date.now() < end; await sleep(2000)) {
    incident = (await call(`/incidents?type=INTRUSION&since=${started - 5000}`)).data.find(i => i.simulated);
    if (!incident) continue;
    if (!seen.has('summary') && incident.summaryStatus === 'ready') { seen.add('summary'); say('Summary', `(${incident.summary.source}) "${incident.summary.text}"`); }
    for (const e of incident.audit) if (!seen.has(e.at + e.state)) { seen.add(e.at + e.state); say(e.state, `${e.choice ? `[${e.choice}] ` : ''}${e.note}`); }
    if (incident.state === 'VIDEO_UNLOCKED') break;
  }
  if (incident) printCameraTimeline(incident);
  else console.log('\nNo synced incident appeared. Save the backend key in the app (Demo & Ring → "Save key for household features").');
  finish(false);
}

try {
  if (!['0815','multicam','reset'].includes(scenario)) { console.error('Usage: node scripts/demo.mjs <0815 [--auto] [--wait SECONDS] | multicam [--backend-only] | reset>'); process.exit(2); }
  await ensureBackend();
  if (scenario === '0815') await scenario0815();
  else if (scenario === 'multicam') await scenarioMulticam();
  else { await removeDemoRules(); for (const c of (await call('/contacts')).data.filter(c => c.simulated)) await call(`/contacts/${c.id}`, 'DELETE'); console.log('Simulated demo contacts and rule removed.'); finish(false); }
} catch (error) { console.error(`\nDemo failed: ${error.message}`); backend?.kill(); process.exit(1); }
