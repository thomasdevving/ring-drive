import test from 'node:test';
import assert from 'node:assert/strict';
import {Summarizer, templateSummary, incidentFacts, rejectReason, segments, SYSTEM_PROMPT} from '../summary.mjs';
import {IncidentService, IncidentError} from '../incidents.mjs';
import {Store} from '../store.mjs';
import {createRelay} from '../server.mjs';

const at = iso => Date.parse(iso);
const ID = '3f2a7c1e-9b4d-4e8a-a1c2-5d6e7f8a9b0c';
// 08:02 / 08:03 local time in Amsterdam (CEST).
const multiCamera = () => ({id:ID, type:'INTRUSION', priority:'urgent', simulated:true, timeZone:'Europe/Amsterdam', observations:[
  {id:'a', deviceId:'side-cam', zone:'side', kind:'person', atMs:at('2026-10-07T06:02:00Z'), confidence:0.94},
  {id:'b', deviceId:'rear-cam', zone:'rear', kind:'person', atMs:at('2026-10-07T06:03:00Z'), confidence:0.94},
  {id:'c', deviceId:'rear-cam', zone:'rear', kind:'person', atMs:at('2026-10-07T06:04:25Z'), confidence:0.94}]});
const absence = () => ({type:'ABSENCE', ruleName:'School run', personLabel:'Sanne', expectedEventType:'motion.human', simulated:false,
  window:{start:'07:30', end:'08:15', timeZone:'Europe/Amsterdam'}, cameras:[{deviceId:'f', label:'front door'},{deviceId:'b', label:'back door'}]});
const reply = (text, stop_reason = 'end_turn') => ({stop_reason, content:[{type:'thinking', thinking:''},{type:'text', text}]});
function fakeClient(respond) {
  const calls = [];
  return {calls, messages:{create:async (params, options) => { calls.push({params, options}); return respond(params, calls.length); }}};
}

test('Camera segments merge per camera and carry durations; the template is factual and spoken', () => {
  const s = segments(multiCamera().observations);
  assert.deepEqual(s.map(x => [x.zone, x.seconds, x.count]), [['side',0,1],['rear',85,2]]);
  assert.equal(templateSummary(multiCamera()),
    'Person activity at the side entrance at 08:02. Then person activity at the rear door from 08:03 to 08:04, for 85 seconds. Video stays locked until you are parked.');
  assert.match(templateSummary(absence()), /^School run: No person was detected at the front door or the back door between 07:30 and 08:15\./);
});

test('Facts sent to the model contain no person labels or device identifiers', () => {
  const facts = JSON.stringify(incidentFacts(absence())) + JSON.stringify(incidentFacts(multiCamera()));
  assert.doesNotMatch(facts, /Sanne|side-cam|rear-cam|deviceId/);
  assert.match(SYSTEM_PROMPT, /Never speculate/);
});

test('Output validation rejects speculation, claims about people, invented times and durations, and formatting', () => {
  const ok = 'A person was seen at the side entrance at 08:02, then at the rear door from 08:03 to 08:04 for 85 seconds. The video stays locked until you are parked.';
  assert.equal(rejectReason(ok, multiCamera()), null);
  assert.equal(rejectReason('A possible burglar was at the rear door at 08:03.', multiCamera()), 'speculative wording');
  assert.equal(rejectReason('Someone was at the rear door at 08:09.', multiCamera()), 'unsupported time');
  assert.equal(rejectReason('Someone stayed at the rear door for 90 seconds.', multiCamera()), 'unsupported duration');
  assert.equal(rejectReason('- Side entrance at 08:02', multiCamera()), 'formatting');
  assert.equal(rejectReason('', multiCamera()), 'empty');
  assert.equal(rejectReason('School run: the front and back door cameras recorded no person between 07:30 and 08:15.', absence()), null);
  assert.equal(rejectReason('No one was seen leaving between 07:30 and 08:15.', absence()), 'claims about a person');
  assert.equal(rejectReason('Your child may still be at home.', absence()), 'claims about a person');
});

test('Bedrock output is stored when valid; the request uses the configured model and low effort', async () => {
  const client = fakeClient(() => reply('Person activity at the side entrance at 08:02. Then at the rear door from 08:03 to 08:04, for 85 seconds. The video stays locked until you are parked.'));
  const summary = await new Summarizer({client, model:'anthropic.claude-test'}).summarize(multiCamera());
  assert.equal(summary.source, 'bedrock'); assert.equal(summary.model, 'anthropic.claude-test'); assert.equal(summary.basedOn, 3);
  const {params} = client.calls[0];
  assert.equal(params.model, 'anthropic.claude-test'); assert.equal(params.output_config.effort, 'low'); assert.equal(params.system, SYSTEM_PROMPT);
  assert.ok(JSON.parse(params.messages[0].content).sequence.length === 2);
});

test('Any Bedrock failure falls back to the deterministic template with a reason', async () => {
  const cases = [
    [fakeClient(() => reply('A suspicious stranger at the rear door at 08:03.')), /^rejected: speculative wording$/],
    [fakeClient(() => reply('Partial', 'max_tokens')), /^stop reason max_tokens$/],
    [fakeClient(() => reply('', 'refusal')), /^stop reason refusal$/],
    [fakeClient(() => { throw Object.assign(new Error('denied'), {status:403}); }), /^Bedrock error HTTP 403$/],
    [fakeClient(() => new Promise(() => {})), /^timeout$/],
    [null, /^Bedrock not configured$/],
  ];
  for (const [client, reason] of cases) {
    const summary = await new Summarizer({client, timeoutMs:20}).summarize(multiCamera());
    assert.equal(summary.source, 'template'); assert.equal(summary.text, templateSummary(multiCamera())); assert.match(summary.fallbackReason, reason);
  }
});

test('Synced incidents get a template immediately and the Bedrock text once generated; only the newest generation is kept', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const client = fakeClient(async (params, n) => {
    if (n === 1) { await gate; return reply('Person activity at the side entrance at 08:02.'); }
    return reply('Person activity at the side entrance at 08:02, then at the rear door from 08:03 to 08:04 for 85 seconds.');
  });
  const store = new Store(null), service = new IncidentService({store, summarizer:new Summarizer({client})});
  const first = multiCamera(); first.observations = first.observations.slice(0, 1);
  const {incident, created} = await service.upsertIntrusion(first);
  assert.equal(created, true); assert.equal(store.incident(incident.id).summary.source, 'template');
  const update = await service.upsertIntrusion(multiCamera());
  assert.equal(update.changed, true); assert.equal(update.incident.observations.length, 3);
  release(); await service.idle();
  const stored = store.incident(ID);
  assert.equal(stored.summaryStatus, 'ready'); assert.equal(stored.summary.basedOn, 3); assert.match(stored.summary.text, /85 seconds/);
  assert.equal((await service.upsertIntrusion(multiCamera())).changed, false, 'duplicate delivery');
  await assert.rejects(service.upsertIntrusion({...multiCamera(), simulated:false}), e => e instanceof IncidentError && e.status === 409);
  await assert.rejects(service.upsertIntrusion({...multiCamera(), id:'nope'}), e => e.status === 400);
});

test('Summary endpoint answers immediately with the stored text while Bedrock is still generating', async () => {
  const store = new Store(null), client = fakeClient(() => new Promise(() => {}));
  const incidents = new IncidentService({store, summarizer:new Summarizer({client, timeoutMs:60000})});
  const server = createRelay({clientToken:'k', store, incidents});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, headers = {Authorization:'Bearer k', 'Content-Type':'application/json'};
  try {
    const created = await fetch(base + '/incidents', {method:'POST', headers, body:JSON.stringify(multiCamera())});
    assert.equal(created.status, 201);
    const started = Date.now();
    const summary = await (await fetch(`${base}/incidents/${ID}/summary`, {headers})).json();
    assert.ok(Date.now() - started < 1000);
    assert.equal(summary.data.status, 'generating'); assert.equal(summary.data.source, 'template'); assert.match(summary.data.text, /85 seconds/);
    assert.equal((await fetch(base + '/incidents', {method:'POST', headers, body:'{"id":"x"}'})).status, 400);
    assert.equal((await fetch(`${base}/incidents/${ID}/summary`)).status, 401);
  } finally { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
});
