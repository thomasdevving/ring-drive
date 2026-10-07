import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createRelay} from '../server.mjs';
import {Store} from '../store.mjs';
import {AbsenceScheduler} from '../scheduler.mjs';

const headers = {Authorization:'Bearer client-key', 'Content-Type':'application/json'};
const rule = {name:'School run', personLabel:'Child', daysOfWeek:['wed'], window:{start:'07:30', end:'08:15'}, timeZone:'Europe/Amsterdam',
  exitCameras:[{deviceId:'front',label:'front door'},{deviceId:'back',label:'back door'}]};
async function withServer(task, {simulation = false, now = Date.parse('2026-10-07T05:00:00Z'), ring = null} = {}) {
  let clock = now; const store = new Store(null, () => clock);
  const scheduler = new AbsenceScheduler({store, ring, now:() => clock});
  const server = createRelay({clientToken:'client-key', signingKey:'hmac', expectedAccount:'home', store, scheduler, simulation, now:() => clock});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (path, method = 'GET', body) => fetch(base + path, {method, headers, body:body && JSON.stringify(body)});
  try { await task({base, call, store, setNow:iso => { clock = Date.parse(iso); }}); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

test('Rule and incident routes require the client token', async () => withServer(async ({base}) => {
  for (const [path, method] of [['/rules','GET'],['/rules','POST'],['/incidents','GET'],['/simulate/observations','POST']]) {
    assert.equal((await fetch(base + path, {method})).status, 401, path);
  }
}));

test('Rules can be created, read, replaced and deleted; invalid rules are rejected with a reason', async () => withServer(async ({call}) => {
  const bad = await call('/rules', 'POST', {...rule, exitCameras:[]});
  assert.equal(bad.status, 400); assert.match((await bad.json()).error, /every exit/);
  assert.equal((await call('/rules', 'POST')).status, 400);
  const created = await call('/rules', 'POST', rule); assert.equal(created.status, 201);
  const {data} = await created.json(); assert.equal(data.graceSeconds, 120); assert.ok(data.createdAt);
  assert.equal((await (await call('/rules')).json()).data.length, 1);
  const replaced = await (await call(`/rules/${data.id}`, 'PUT', {...rule, name:'School (late start)', window:{start:'08:30',end:'09:15'}})).json();
  assert.equal(replaced.data.window.start, '08:30'); assert.equal(replaced.data.createdAt, data.createdAt);
  assert.equal((await call(`/rules/${data.id}`, 'DELETE')).status, 204);
  assert.equal((await call(`/rules/${data.id}`)).status, 404);
  assert.equal((await call('/rules/not-a-uuid')).status, 404);
}));

test('Evaluating an ended window over simulated evidence creates a labeled ABSENCE incident', async () => withServer(async ({call, setNow}) => {
  const {data:created} = await (await call('/rules', 'POST', {...rule, evidenceSource:'simulated'})).json();
  assert.equal((await call(`/rules/${created.id}/evaluate`, 'POST', {date:'2026-10-07'})).status, 409, 'window has not ended');
  setNow('2026-10-07T06:20:00Z');
  const evaluated = await (await call(`/rules/${created.id}/evaluate`, 'POST', {date:'2026-10-07'})).json();
  assert.equal(evaluated.data.outcome, 'absence');
  const {data:incidents} = await (await call('/incidents')).json();
  assert.equal(incidents.length, 1); assert.equal(incidents[0].type, 'ABSENCE'); assert.equal(incidents[0].simulated, true);
  assert.equal((await (await call(`/incidents/${incidents[0].id}`)).json()).data.summary.text, incidents[0].summary.text);
  assert.equal((await (await call(`/rules/${created.id}/evaluate`, 'POST', {date:'2026-10-07'})).json()).alreadyEvaluated, true);
  assert.equal((await (await call(`/rules/${created.id}/runs`)).json()).data.length, 1);
}, {simulation:true}));

test('Simulation endpoint is off by default and its evidence satisfies only simulated rules', async () => {
  await withServer(async ({call}) => {
    assert.equal((await call('/simulate/observations', 'POST', {deviceId:'back', eventType:'motion.human'})).status, 403);
  });
  await withServer(async ({call, setNow}) => {
    const {data:created} = await (await call('/rules', 'POST', {...rule, evidenceSource:'simulated'})).json();
    assert.equal((await call('/simulate/observations', 'POST', {deviceId:'back', eventType:'knock'})).status, 400);
    assert.equal((await call('/simulate/observations', 'POST', {deviceId:'back', eventType:'motion.human', startMs:Date.parse('2026-10-07T05:55:00Z')})).status, 400, 'future');
    setNow('2026-10-07T06:00:00Z');
    const posted = await call('/simulate/observations', 'POST', {deviceId:'back', eventType:'motion.human', startMs:Date.parse('2026-10-07T05:55:00Z')});
    assert.equal(posted.status, 201); assert.equal((await posted.json()).data.simulated, true);
    setNow('2026-10-07T06:20:00Z');
    assert.equal((await (await call(`/rules/${created.id}/evaluate`, 'POST', {date:'2026-10-07'})).json()).data.outcome, 'satisfied');
  }, {simulation:true});
});

test('Accepted signed webhooks are kept as real positive evidence for absence rules', async () => withServer(async ({base, store}) => {
  const now = Date.parse('2026-10-07T05:00:00Z');
  const raw = JSON.stringify({meta:{request_id:'r', account_id:'home'}, data:{id:'evt', type:'motion_detected', attributes:{source:'back', timestamp:now, sub_type:'human', component_ids:['lens-1']}}});
  const signature = 'sha256=' + createHmac('sha256','hmac').update(raw).digest('hex');
  assert.equal((await fetch(base + '/webhooks/ring', {method:'POST', body:raw, headers:{'X-Signature':signature}})).status, 200);
  const [observation] = store.observations({simulated:false, sinceMs:0});
  assert.equal(observation.eventType, 'motion.human'); assert.equal(observation.deviceId, 'back'); assert.deepEqual(observation.componentIds, ['lens-1']);
}));
