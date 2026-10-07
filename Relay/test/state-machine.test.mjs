import test from 'node:test';
import assert from 'node:assert/strict';
import {offeredChoices, availableChoices, applyEntries, backendTransition, ALLOWED, STATES} from '../state-machine.mjs';
import {IncidentService, IncidentError} from '../incidents.mjs';
import {Store} from '../store.mjs';
import {createRelay} from '../server.mjs';

const now = Date.parse('2026-10-07T06:30:00Z');
const iso = seconds => new Date(now + seconds * 1000).toISOString();
const absence = (state = 'NOTIFIED') => ({id:'a', type:'ABSENCE', status:'active', state, audit:[]});
const camera = (priority, state = 'NOTIFIED') => ({id:'c', type:'INTRUSION', status:'active', priority, state, audit:[]});

test('Offered choices match the Swift ChoicePolicy per incident type', () => {
  assert.deepEqual(offeredChoices(absence()), ['NOTIFY_HOUSEHOLD','CALL_CONTACT','DISMISS']);
  assert.deepEqual(offeredChoices(camera('urgent')), ['FIND_STOP','NOTIFY_HOUSEHOLD','CALL_CONTACT','DISMISS']);
  assert.deepEqual(offeredChoices(camera('review')), ['FIND_STOP','DISMISS']);
  assert.deepEqual(offeredChoices(camera('passive')), ['FIND_STOP','DISMISS']);
  assert.deepEqual(offeredChoices({...camera('urgent'), status:'resolved'}), ['FIND_STOP','DISMISS']);
  assert.deepEqual(availableChoices(camera('urgent')), [], 'nothing before EXPLAINED');
  assert.deepEqual(availableChoices(camera('urgent','EXPLAINED')), ['FIND_STOP','NOTIFY_HOUSEHOLD','CALL_CONTACT','DISMISS']);
  assert.deepEqual(availableChoices(camera('urgent','HOUSEHOLD_NOTIFIED')), ['FIND_STOP','CALL_CONTACT','DISMISS']);
  assert.deepEqual(availableChoices(absence('DISMISSED')), []);
  assert.deepEqual(Object.keys(ALLOWED).sort(), [...STATES].sort());
});

test('Absence incidents follow the table strictly and never enter the stop or video path', () => {
  const {accepted, state} = applyEntries(absence(), [
    {id:'1', at:iso(1), state:'EXPLAINED'}, {id:'2', at:iso(2), state:'HOUSEHOLD_NOTIFIED', choice:'NOTIFY_HOUSEHOLD', source:'siri'},
    {id:'3', at:iso(3), state:'CONTACT_CALLED', choice:'CALL_CONTACT', note:'Called Sanne'}], now);
  assert.equal(state, 'CONTACT_CALLED');
  assert.deepEqual(accepted.map(e => [e.state, e.choice, e.source]), [['EXPLAINED',undefined,'driver-app'],['HOUSEHOLD_NOTIFIED','NOTIFY_HOUSEHOLD','siri'],['CONTACT_CALLED','CALL_CONTACT','driver-app']]);
  assert.equal(accepted[2].note, 'Called Sanne'); assert.equal(accepted[1].at, iso(2));
  const reject = (incident, entry, status) => assert.throws(() => applyEntries(incident, [entry], now), e => e instanceof IncidentError && e.status === status, JSON.stringify(entry));
  reject(absence('EXPLAINED'), {at:iso(1), state:'STOP_REQUESTED', choice:'FIND_STOP'}, 409);
  reject(absence('EXPLAINED'), {at:iso(1), state:'PARKED_CONFIRMED'}, 409);
  reject(absence('NOTIFIED'), {at:iso(1), state:'DISMISSED', choice:'DISMISS'}, 409);
  reject(absence('DISMISSED'), {at:iso(1), state:'EXPLAINED'}, 409);
  reject(absence('EXPLAINED'), {at:iso(1), state:'DISMISSED', choice:'NOTIFY_HOUSEHOLD'}, 400);
  reject(absence('EXPLAINED'), {at:'yesterday', state:'DISMISSED'}, 400);
  reject(absence('EXPLAINED'), {at:iso(3 * 86400), state:'DISMISSED'}, 400);
});

test('Camera incidents record what the phone reports, but choices must still be offered', () => {
  const {state} = applyEntries(camera('urgent'), ['EXPLAINED','STOP_REQUESTED','NAVIGATING','PARKED_CONFIRMED','VIDEO_UNLOCKED'].map((s, i) => ({id:String(i), at:iso(i), state:s})), now);
  assert.equal(state, 'VIDEO_UNLOCKED');
  assert.throws(() => applyEntries(camera('passive','EXPLAINED'), [{at:iso(1), state:'HOUSEHOLD_NOTIFIED', choice:'NOTIFY_HOUSEHOLD'}], now), e => e.status === 409);
  assert.throws(() => applyEntries(camera('review','EXPLAINED'), [{at:iso(1), state:'CONTACT_CALLED', choice:'CALL_CONTACT'}], now), e => e.status === 409);
});

test('Entries are idempotent by id and backend transitions are validated', () => {
  const incident = absence('EXPLAINED'); incident.audit = [{id:'1', state:'EXPLAINED'}];
  const {accepted} = applyEntries(incident, [{id:'1', at:iso(1), state:'EXPLAINED'}, {id:'2', at:iso(2), state:'DISMISSED', choice:'DISMISS'}], now);
  assert.deepEqual(accepted.map(e => e.id), ['2']);
  const fresh = {...absence('DETECTED')};
  backendTransition(fresh, 'TRIAGED', 'x', now); assert.equal(fresh.state, 'TRIAGED'); assert.equal(fresh.audit.at(-1).source, 'backend');
  assert.throws(() => backendTransition(fresh, 'EXPLAINED', 'x', now), e => e.status === 409);
});

test('Driver choices are persisted with timestamps and returned with the remaining choices', async () => {
  const store = new Store(null, () => now), incidents = new IncidentService({store, now:() => now});
  const created = await store.createIncident({id:'0d9b8c6a-1111-4222-8333-944455566677', type:'ABSENCE', status:'active', state:'DETECTED', ruleName:'School run', expectedEventType:'motion.human',
    window:{start:'07:30', end:'08:15', timeZone:'Europe/Amsterdam'}, cameras:[{deviceId:'f', label:'front door'}], audit:[{at:iso(0), state:'DETECTED', note:'x'}]});
  await incidents.absenceCreated(created); await incidents.idle();
  assert.deepEqual(store.incident(created.id).audit.map(e => e.state), ['DETECTED','TRIAGED','NOTIFIED']);
  const server = createRelay({clientToken:'k', store, incidents, now:() => now});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, headers = {Authorization:'Bearer k', 'Content-Type':'application/json'};
  const post = body => fetch(`${base}/incidents/${created.id}/audit`, {method:'POST', headers, body:JSON.stringify(body)});
  try {
    const first = await (await post({entries:[{id:'e1', at:iso(10), state:'EXPLAINED'}, {id:'e2', at:iso(12), state:'HOUSEHOLD_NOTIFIED', choice:'NOTIFY_HOUSEHOLD'}]})).json();
    assert.equal(first.accepted, 2); assert.equal(first.data.state, 'HOUSEHOLD_NOTIFIED'); assert.deepEqual(first.data.availableChoices, ['CALL_CONTACT','DISMISS']);
    assert.equal((await (await post({entries:[{id:'e2', at:iso(12), state:'HOUSEHOLD_NOTIFIED', choice:'NOTIFY_HOUSEHOLD'}]})).json()).accepted, 0, 'retry is idempotent');
    assert.equal((await post({entries:[{id:'e3', at:iso(13), state:'STOP_REQUESTED', choice:'FIND_STOP'}]})).status, 409);
    assert.equal((await post({entries:[]})).status, 400);
    assert.equal((await fetch(`${base}/incidents/9d9b8c6a-1111-4222-8333-944455566677/audit`, {method:'POST', headers, body:'{"entries":[{"at":"x","state":"EXPLAINED"}]}'})).status, 404);
    const listed = await (await fetch(`${base}/incidents?type=ABSENCE&active=1`, {headers})).json();
    assert.equal(listed.data.length, 1); assert.equal(listed.data[0].audit.find(e => e.choice).at, iso(12));
    assert.equal((await (await fetch(`${base}/incidents?type=INTRUSION`, {headers})).json()).data.length, 0);
    await post({entries:[{id:'e4', at:iso(20), state:'DISMISSED', choice:'DISMISS'}]});
    assert.equal((await (await fetch(`${base}/incidents?active=1`, {headers})).json()).data.length, 0, 'dismissed incidents are not active');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
