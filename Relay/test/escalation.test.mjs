import test from 'node:test';
import assert from 'node:assert/strict';
import {validateContact, ContactError, recipients, drivingState, validateLadder, DEFAULT_LADDER} from '../contacts.mjs';
import {Outbox, dryRunChannels} from '../outbox.mjs';
import {Escalation, stepMessage} from '../escalation.mjs';
import {IncidentService} from '../incidents.mjs';
import {AbsenceScheduler} from '../scheduler.mjs';
import {Store} from '../store.mjs';
import {createRelay} from '../server.mjs';
import {validateRule} from '../absence.mjs';

const T0 = Date.parse('2026-10-07T06:17:00Z');
async function household({now, drivers = ['Lisa'], extra = []} = {}) {
  const store = new Store(null, now);
  const people = {};
  for (const [name, role, channel = 'app', phone] of [['Sanne','monitored'],['Thomas','household'],['Lisa','household'],['Oma','emergency','call','+31600000000'], ...extra])
    people[name] = await store.createContact(validateContact({name, role, channel, ...(phone ? {phone} : {})}));
  for (const name of ['Thomas','Lisa']) await store.setPresence(people[name].id, {driving:drivers.includes(name), source:'simulated'});
  return {store, people};
}
async function absenceIncident(store, extra = {}) {
  return store.createIncident({type:'ABSENCE', status:'active', state:'TRIAGED', simulated:true, ruleName:'School run', personLabel:'Sanne',
    summary:{text:'School run: No person was detected at the front door between 07:30 and 08:15. The cameras cannot show where anyone is.', source:'template'},
    audit:[], ...extra});
}

test('Contacts and ladders are validated', () => {
  assert.deepEqual(validateContact({name:'Thomas', role:'household'}), {name:'Thomas', role:'household', priority:5, channel:'app'});
  for (const bad of [{name:'x', role:'boss'}, {name:'', role:'household'}, {name:'x', role:'household', channel:'sms'}, {name:'x', role:'household', phone:'0612'},
    {name:'x', role:'household', priority:0}, {name:'x', role:'household', channel:'fax'}]) assert.throws(() => validateContact(bad), ContactError, JSON.stringify(bad));
  assert.deepEqual(validateLadder([{target:'monitored', message:'School starts in 15 minutes'}, {target:'driver', afterSeconds:120}]),
    [{target:'monitored', afterSeconds:0, message:'School starts in 15 minutes'}, {target:'driver', afterSeconds:120}]);
  assert.throws(() => validateLadder([{target:'police'}]), ContactError);
  assert.throws(() => validateLadder([]), ContactError);
  const rule = validateRule({name:'School run', personLabel:'Child', daysOfWeek:['mon'], window:{start:'07:30', end:'08:15'}, timeZone:'Europe/Amsterdam',
    exitCameras:[{deviceId:'f', label:'front door'}], escalation:[{target:'household', afterSeconds:60}]});
  assert.equal(rule.escalation[0].afterSeconds, 60);
  assert.throws(() => validateRule({...rule, escalation:[{target:'x'}]}), /escalation/);
});

test('Routing prefers household members who are not driving and never picks the driver for household steps', async () => {
  const now = () => T0;
  const {store, people} = await household({now});
  const names = (target, opts) => recipients(store.contacts(), target, T0, opts).map(c => c.name);
  assert.deepEqual(names('household'), ['Thomas']);
  assert.deepEqual(names('driver'), ['Lisa']);
  assert.deepEqual(names('monitored'), ['Sanne']);
  assert.deepEqual(names('emergency'), ['Oma']);
  assert.deepEqual(names('household', {excludeContactId:people.Thomas.id}), [], 'the requester is excluded; the driving member is never chosen');
  await store.setPresence(people.Thomas.id, {driving:false, source:'motion'});
  assert.equal(drivingState(store.contact(people.Thomas.id), T0 + 11 * 60000), 'unknown', 'presence expires');
  assert.deepEqual(recipients(store.contacts(), 'household', T0 + 11 * 60000).map(c => c.name), ['Lisa','Thomas'], 'all unknown: fall back to everyone not known to drive');
});

test('Outbox honours dry-run per channel and never automates calls', async () => {
  assert.deepEqual([...dryRunChannels(undefined)], ['sms']);
  assert.deepEqual([...dryRunChannels('all')].sort(), ['app','sms']);
  assert.deepEqual([...dryRunChannels('none')], []);
  assert.deepEqual([...dryRunChannels('app, sms')], ['app','sms']);
  const sent = [];
  const outbox = new Outbox({dryRun:new Set(), sendSms:async m => { sent.push(m); return {providerId:'m-1'}; }});
  assert.deepEqual(await outbox.deliver({name:'A', channel:'app'}, 'hi'), {channel:'app', status:'delivered'});
  assert.deepEqual(await outbox.deliver({name:'B', channel:'sms', phone:'+31611111111'}, 'hi'), {channel:'sms', status:'sent', providerId:'m-1'});
  assert.equal((await outbox.deliver({name:'C', channel:'call', phone:'+31622222222'}, 'hi')).status, 'skipped');
  assert.equal((await new Outbox({dryRun:new Set(['sms'])}).deliver({name:'B', channel:'sms', phone:'+31611111111'}, 'hi')).status, 'dry_run');
  assert.equal((await new Outbox({dryRun:new Set(), sendSms:async () => { throw Object.assign(new Error('x'), {name:'AuthorizationError'}); }}).deliver({name:'B', channel:'sms', phone:'+3161'}, 'hi')).reason, 'AuthorizationError');
  assert.deepEqual(sent, [{phone:'+31611111111', message:'hi'}]);
});

test('08:15 ladder: monitored person first, then a household member who is not driving, then the driver', async () => {
  let clock = T0; const now = () => clock;
  const {store, people} = await household({now});
  const escalation = new Escalation({store, now});
  const incident = await absenceIncident(store);
  await escalation.begin(incident.id, validateLadder([{target:'monitored', message:'School starts in 15 minutes'}, {target:'household', afterSeconds:120}, {target:'driver', afterSeconds:120}]));
  let stored = store.incident(incident.id);
  assert.equal(stored.state, 'TRIAGED', 'driver not interrupted yet');
  assert.deepEqual(store.notifications().map(n => [n.contactName, n.message, n.status]), [['Sanne','School starts in 15 minutes','delivered']]);
  clock += 119000; await escalation.tick(); assert.equal(store.notifications().length, 1, 'waits for an acknowledgement');
  clock += 1000; await escalation.tick();
  assert.deepEqual(store.notifications().map(n => n.contactName), ['Sanne','Thomas'], 'Lisa is driving, so only Thomas');
  assert.match(store.notifications()[1].message, /Tap "I've seen this"/);
  clock += 120000; await escalation.tick();
  stored = store.incident(incident.id);
  assert.equal(stored.state, 'NOTIFIED'); assert.equal(stored.escalation.status, 'completed');
  assert.ok(stored.audit.some(e => /Driver alerted \(escalation step 3\)/.test(e.note)));
  assert.deepEqual(escalation.inbox(people.Lisa.id).map(n => n.target), ['driver']);
});

test('An acknowledgement stops the ladder before the driver is interrupted', async () => {
  let clock = T0; const now = () => clock;
  const {store, people} = await household({now});
  const escalation = new Escalation({store, now});
  const incident = await absenceIncident(store);
  await escalation.begin(incident.id, DEFAULT_LADDER);
  clock += 300000; await escalation.tick();
  const [toThomas] = escalation.inbox(people.Thomas.id);
  await assert.rejects(escalation.acknowledge(toThomas.id, {contactId:people.Lisa.id}), e => e.status === 403);
  const {incident:acked} = await escalation.acknowledge(toThomas.id, {contactId:people.Thomas.id});
  assert.equal(acked.escalation.status, 'acknowledged'); assert.equal(acked.acknowledgedBy[0].name, 'Thomas');
  assert.ok(acked.audit.some(e => e.note === 'Thomas has seen this' && e.source === 'household'));
  assert.equal((await escalation.acknowledge(toThomas.id)).alreadyAcknowledged, true);
  clock += 3600000; await escalation.tick();
  assert.equal(store.incident(incident.id).state, 'TRIAGED', 'driver never interrupted');
  const [seen] = escalation.inbox(people.Thomas.id);
  assert.equal(seen.id, toThomas.id); assert.ok(seen.ackAt, 'the inbox shows the message as seen');
});

test('The monitored person answering "on my way" also stops the ladder', async () => {
  let clock = T0; const now = () => clock;
  const {store, people} = await household({now});
  const escalation = new Escalation({store, now});
  const incident = await absenceIncident(store);
  await escalation.begin(incident.id);
  const [reminder] = escalation.inbox(people.Sanne.id);
  assert.match(stepMessage({target:'monitored'}, incident), /I'm on my way/);
  await escalation.acknowledge(reminder.id, {contactId:people.Sanne.id});
  clock += 3600000; await escalation.tick();
  const stored = store.incident(incident.id);
  assert.equal(stored.state, 'TRIAGED'); assert.ok(stored.audit.some(e => e.note === 'Sanne replied: on my way'));
  assert.equal(store.notifications().length, 1);
});

test('With nobody to reach, the ladder reaches the driver at once; dry-run messages are recorded but not in inboxes', async () => {
  const store = new Store(null, () => T0), escalation = new Escalation({store, now:() => T0});
  const incident = await absenceIncident(store);
  await escalation.begin(incident.id);
  assert.equal(store.incident(incident.id).state, 'NOTIFIED');
  const dry = await household({now:() => T0});
  const dryEscalation = new Escalation({store:dry.store, outbox:new Outbox({dryRun:new Set(['app'])}), now:() => T0});
  const dryIncident = await absenceIncident(dry.store);
  await dryEscalation.begin(dryIncident.id);
  assert.equal(dry.store.notifications()[0].status, 'dry_run');
  assert.deepEqual(dryEscalation.inbox(dry.people.Sanne.id), []);
  assert.match(dry.store.incident(dryIncident.id).audit.at(-1).note, /Sanne \(app, dry run\)/);
});

test('Notify household at the driver request reaches only members who are not driving', async () => {
  const {store, people} = await household({now:() => T0});
  const escalation = new Escalation({store, now:() => T0});
  const incident = await absenceIncident(store, {state:'HOUSEHOLD_NOTIFIED'});
  const sent = await escalation.notifyHousehold(incident.id, {requestedBy:people.Lisa.id});
  assert.deepEqual(sent.map(n => n.contactName), ['Thomas']); assert.match(sent[0].message, /^The driver asked you to check this\. School run/);
  const everyoneDriving = await household({now:() => T0, drivers:['Thomas','Lisa']});
  const e2 = new Escalation({store:everyoneDriving.store, now:() => T0}), i2 = await absenceIncident(everyoneDriving.store);
  assert.deepEqual(await e2.notifyHousehold(i2.id, {requestedBy:everyoneDriving.people.Lisa.id}), []);
  assert.match(everyoneDriving.store.incident(i2.id).audit.at(-1).note, /appears to be driving/);
  await assert.rejects(escalation.notifyHousehold('nope'), e => e.status === 404);
});

test('End to end: an absence rule fires, starts the ladder and the household API reflects it', async () => {
  let clock = Date.parse('2026-10-01T00:00:00Z'); const now = () => clock;
  const {store, people} = await household({now});
  const escalation = new Escalation({store, now}), incidents = new IncidentService({store, escalation, now});
  const rule = await store.createRule(validateRule({name:'School run', personLabel:'Sanne', daysOfWeek:['wed'], window:{start:'07:30', end:'08:15'}, timeZone:'Europe/Amsterdam',
    exitCameras:[{deviceId:'f', label:'front door'}], evidenceSource:'simulated', escalation:[{target:'monitored', message:'School starts in 15 minutes'}, {target:'driver', afterSeconds:60}]}));
  clock = T0;
  for (const name of ['Thomas','Lisa']) await store.setPresence(people[name].id, {driving:name === 'Lisa', source:'simulated'});
  const scheduler = new AbsenceScheduler({store, now, onIncident:i => incidents.absenceCreated(i)});
  const server = createRelay({clientToken:'k', store, incidents, escalation, scheduler, now});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`, headers = {Authorization:'Bearer k', 'Content-Type':'application/json'};
  const get = async path => (await (await fetch(base + path, {headers})).json()).data;
  const post = (path, body = {}) => fetch(base + path, {method:'POST', headers, body:JSON.stringify(body)});
  try {
    const [run] = await scheduler.tick(); await incidents.idle(); await escalation.tick();
    assert.equal(run.outcome, 'absence');
    assert.equal((await get(`/members/${people.Sanne.id}/inbox`))[0].message, 'School starts in 15 minutes');
    assert.equal((await get(`/incidents/${run.incidentId}`)).state, 'TRIAGED');
    clock += 60000; await escalation.tick();
    assert.equal((await get(`/incidents/${run.incidentId}`)).state, 'NOTIFIED');
    assert.deepEqual((await get(`/incidents/${run.incidentId}/notifications`)).map(n => n.contactName), ['Sanne','Lisa']);
    const contacts = await get('/contacts');
    assert.equal(contacts.find(c => c.name === 'Lisa').drivingState, 'driving');
    assert.equal((await post(`/members/${people.Thomas.id}/status`, {driving:'yes'})).status, 400);
    assert.equal((await post(`/members/${people.Thomas.id}/status`, {driving:true, source:'carplay'})).status, 200);
    const notified = await (await post(`/incidents/${run.incidentId}/notify-household`, {requestedBy:people.Lisa.id})).json();
    assert.deepEqual(notified.data, [], 'Thomas now reports driving too');
    const [reminder] = await get(`/members/${people.Sanne.id}/inbox`);
    assert.equal((await post(`/notifications/${reminder.id}/ack`, {contactId:people.Sanne.id})).status, 200);
    assert.ok((await get(`/incidents/${run.incidentId}`)).acknowledgedBy[0].name === 'Sanne');
    const created = await post('/contacts', {name:'Buurman', role:'neighbour', channel:'sms', phone:'+31633333333', priority:2});
    assert.equal(created.status, 201);
    assert.equal((await post('/contacts', {name:'X', role:'household', channel:'sms'})).status, 400);
    assert.equal((await fetch(`${base}/contacts/${(await created.json()).data.id}`, {method:'DELETE', headers})).status, 204);
    assert.equal((await fetch(`${base}/members/${people.Sanne.id}/inbox`)).status, 401);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
