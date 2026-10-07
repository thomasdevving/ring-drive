import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../store.mjs';
import {AbsenceScheduler, collectEvidence, UNCHECKED_RETRY} from '../scheduler.mjs';
import {RingError} from '../ring-client.mjs';
import {windowFor} from '../absence.mjs';
import {schoolRule} from './fixtures.mjs';

const at = iso => Date.parse(iso);
const ruleInput = overrides => { const {id, createdAt, ...fields} = schoolRule(overrides); return fields; };
/** Fake Ring client: pages of history per device, newest first. */
function fakeRing(pagesByDevice, {fail = new Set()} = {}) {
  const calls = [];
  return {calls, async history(deviceId, cursor, types) {
    calls.push({deviceId, cursor, types});
    if (fail.has(deviceId)) throw new RingError(424, 'Ring token expired.');
    const pages = pagesByDevice[deviceId] ?? [[]], index = cursor ? Number(cursor) : 0;
    const next = index + 1 < pages.length ? `/v1/history/devices/${deviceId}/events?event_types=${types}&page%5Bkey%5D=${index + 1}` : undefined;
    return {data:pages[index].map(([start, end, type = types]) => ({id:`${deviceId}-${start}`, attributes:{event_type:type, start:at(start), end:end && at(end)}})), ...(next ? {links:{next}} : {})};
  }};
}
async function setup({ring = fakeRing({}), now = '2026-10-07T06:20:00Z', overrides = {}} = {}) {
  let clock = at(now); const incidents = [];
  const store = new Store(null, () => clock);
  clock = at('2026-10-01T00:00:00Z'); const rule = await store.createRule(ruleInput(overrides)); clock = at(now);
  const scheduler = new AbsenceScheduler({store, ring, now:() => clock, onIncident:async i => incidents.push(i)});
  return {store, rule, scheduler, incidents, ring, setNow:iso => { clock = at(iso); }};
}

test('No observation at any exit camera creates exactly one ABSENCE incident with careful wording', async () => {
  const {store, scheduler, incidents} = await setup();
  const [run] = await scheduler.tick();
  assert.equal(run.outcome, 'absence'); assert.equal(incidents.length, 1);
  const incident = store.incident(run.incidentId);
  assert.equal(incident.type, 'ABSENCE'); assert.equal(incident.simulated, false); assert.equal(incident.state, 'DETECTED');
  assert.equal(incident.summary.source, 'template'); assert.match(incident.summary.text, /^School run: No person was detected at the front door, the side gate or the back door between 07:30 and 08:15\./);
  assert.deepEqual(await scheduler.tick(), [], 'second tick is idempotent');
  assert.equal(store.incidents().length, 1);
});

test('A person at the back door satisfies the rule; the history query uses the expected type', async () => {
  const ring = fakeRing({back:[[['2026-10-07T05:58:00Z','2026-10-07T05:58:40Z']]]});
  const {scheduler, incidents} = await setup({ring});
  const [run] = await scheduler.tick();
  assert.equal(run.outcome, 'satisfied'); assert.equal(run.firstMatchAt, '2026-10-07T05:58:00.000Z'); assert.equal(incidents.length, 0);
  assert.deepEqual(new Set(ring.calls.map(c => c.types)), new Set(['motion.human']));
  assert.deepEqual(ring.calls.map(c => c.deviceId).sort(), ['back','front','side']);
});

test('History pagination follows cursors until it passes the window start', async () => {
  const ring = fakeRing({front:[[['2026-10-07T06:19:00Z']], [['2026-10-07T06:16:00Z']], [['2026-10-07T05:40:00Z']], [['2026-10-07T04:00:00Z']], [['2026-10-07T03:00:00Z']]]});
  const {scheduler} = await setup({ring});
  const [run] = await scheduler.tick();
  assert.equal(run.outcome, 'satisfied');
  assert.deepEqual(ring.calls.filter(c => c.deviceId === 'front').map(c => c.cursor), [null,'1','2','3'], 'stops once the margin before the window start is reached');
});

test('Ring failure is UNCHECKED, retried with backoff, and never reported as absence', async () => {
  const fail = new Set(['side']);
  const ring = fakeRing({}, {fail});
  const {store, scheduler, incidents, setNow} = await setup({ring});
  const [first] = await scheduler.tick();
  assert.equal(first.outcome, 'unchecked'); assert.deepEqual(first.problems, ['History for the side gate unavailable: HTTP 424']); assert.equal(incidents.length, 0);
  assert.deepEqual(await scheduler.tick(), [], 'no retry before the interval');
  setNow('2026-10-07T06:25:00Z'); fail.clear();
  const [retry] = await scheduler.tick();
  assert.equal(retry.outcome, 'absence'); assert.equal(retry.attempts, 2); assert.equal(store.runsFor(retry.ruleId).length, 1);
});

test('UNCHECKED retries stop after the attempt limit', async () => {
  const {scheduler, setNow} = await setup({ring:fakeRing({}, {fail:new Set(['front'])})});
  let minute = 20, runs = 0;
  for (let i = 0; i < UNCHECKED_RETRY.maxAttempts + 3; i++) { setNow(`2026-10-07T${String(6 + Math.floor(minute / 60)).padStart(2,'0')}:${String(minute % 60).padStart(2,'0')}:00Z`); runs += (await scheduler.tick()).length; minute += 6; }
  assert.equal(runs, UNCHECKED_RETRY.maxAttempts);
});

test('Without a configured Ring backend a Ring rule is UNCHECKED, not absent', async () => {
  const {scheduler, incidents} = await setup({ring:null});
  const [run] = await scheduler.tick();
  assert.equal(run.outcome, 'unchecked'); assert.deepEqual(run.problems, ['Ring backend is not configured']); assert.equal(incidents.length, 0);
});

test('Simulated and real evidence never mix', async () => {
  const {store, scheduler} = await setup({overrides:{evidenceSource:'simulated'}});
  await store.addObservation({id:'real', deviceId:'front', eventType:'motion.human', startMs:at('2026-10-07T05:50:00Z'), simulated:false});
  const [run] = await scheduler.tick();
  assert.equal(run.outcome, 'absence', 'real webhook evidence is ignored by a simulated rule');
  assert.equal(store.incident(run.incidentId).simulated, true);

  const real = await setup();
  await real.store.addObservation({id:'sim', deviceId:'front', eventType:'motion.human', startMs:at('2026-10-07T05:50:00Z'), simulated:true});
  assert.equal((await real.scheduler.tick())[0].outcome, 'absence', 'simulated evidence never satisfies a Ring rule');
});

test('A signed-webhook observation satisfies a Ring rule even when history is unavailable', async () => {
  const {store, scheduler} = await setup({ring:fakeRing({}, {fail:new Set(['front','side','back'])})});
  await store.addObservation({id:'hook', deviceId:'side', eventType:'motion.human', startMs:at('2026-10-07T05:44:00Z'), simulated:false});
  assert.equal((await scheduler.tick())[0].outcome, 'satisfied');
});

test('Manual and scheduled evaluation of one window cannot create two incidents; state survives a restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ring-drive-store-'));
  try {
    const path = join(directory, 'household.local.json'); let clock = at('2026-10-01T00:00:00Z');
    const store = await Store.open(path, () => clock);
    const rule = await store.createRule(ruleInput()); clock = at('2026-10-07T06:20:00Z');
    const scheduler = new AbsenceScheduler({store, ring:fakeRing({}), now:() => clock});
    const [manual, scheduled] = await Promise.all([scheduler.evaluateDate(rule, '2026-10-07'), scheduler.tick()]);
    assert.equal(manual.run.outcome, 'absence'); assert.equal(scheduled.length, 1); assert.equal(store.incidents().length, 1);
    const reopened = await Store.open(path, () => clock);
    assert.equal(reopened.incidents().length, 1);
    assert.deepEqual(await new AbsenceScheduler({store:reopened, ring:fakeRing({}), now:() => clock}).tick(), []);
    assert.equal((await scheduler.evaluateDate(rule, '2026-10-07')).alreadyEvaluated, true);
    assert.match((await scheduler.evaluateDate(rule, '2026-10-10')).error, /does not apply/);
    assert.match((await scheduler.evaluateDate(rule, '2026-10-08')).error, /not ended/);
  } finally { await rm(directory, {recursive:true, force:true}); }
});

test('collectEvidence ignores doorbell history entries and reports page overflow as incomplete', async () => {
  const rule = schoolRule(), window = windowFor(rule, '2026-10-07');
  const doorbell = await collectEvidence({rule, window, store:new Store(null), ring:fakeRing({front:[[['2026-10-07T05:50:00Z',null,'ding']]]})});
  assert.equal(doorbell.observations.length, 0); assert.equal(doorbell.complete, true);
  const endless = {history:async (id, cursor) => ({data:[{id:`${id}${cursor}`, attributes:{start:at('2026-10-07T06:10:00Z')}}], links:{next:`/x?page[key]=${Number(cursor ?? 0) + 1}`}})};
  const overflow = await collectEvidence({rule, window, store:new Store(null), ring:endless});
  assert.equal(overflow.complete, false); assert.match(overflow.problems[0], /exceeded 20 pages/);
});
