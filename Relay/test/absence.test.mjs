import test from 'node:test';
import assert from 'node:assert/strict';
import {schoolRule} from './fixtures.mjs';
import {validateRule, RuleError, windowFor, dueWindows, evaluateWindow, absenceSummary, uncheckedSummary, zonedTimeToEpoch, matchesExpected} from '../absence.mjs';

const at = iso => Date.parse(iso);
const obs = (deviceId, startIso, extra = {}) => ({id:`${deviceId}-${startIso}`, deviceId, eventType:'motion.human', startMs:at(startIso), source:'ringHistory', ...extra});
const complete = observations => ({observations, complete:true, problems:[]});

test('Rule validation normalises input and rejects unsafe or ambiguous rules', () => {
  const rule = schoolRule();
  assert.equal(rule.expectedEventType, 'motion.human'); assert.equal(rule.graceSeconds, 120); assert.equal(rule.evidenceSource, 'ring'); assert.equal(rule.enabled, true);
  const base = {name:'x', personLabel:'Child', daysOfWeek:['mon'], window:{start:'07:30',end:'08:15'}, timeZone:'Europe/Amsterdam', exitCameras:[{deviceId:'a',label:'front door'}]};
  for (const bad of [
    {daysOfWeek:[]}, {daysOfWeek:['monday']}, {window:{start:'7:30',end:'08:15'}}, {window:{start:'08:15',end:'07:30'}},
    {timeZone:'Mars/Olympus'}, {exitCameras:[]}, {exitCameras:[{deviceId:'a',label:'x'},{deviceId:'a',label:'y'}]},
    {expectedEventType:'ding'}, {graceSeconds:-1}, {graceSeconds:5000}, {name:''}, {evidenceSource:'guess'}
  ]) assert.throws(() => validateRule({...base, ...bad}), RuleError, JSON.stringify(bad));
  assert.throws(() => validateRule(null), RuleError);
});

test('Windows follow the rule time zone across daylight-saving changes and skip other weekdays', () => {
  const rule = schoolRule();
  const summer = windowFor(rule, '2026-10-07');
  assert.equal(new Date(summer.startMs).toISOString(), '2026-10-07T05:30:00.000Z');
  assert.equal(new Date(summer.endMs).toISOString(), '2026-10-07T06:15:00.000Z');
  assert.equal(new Date(windowFor(rule, '2026-11-02').startMs).toISOString(), '2026-11-02T06:30:00.000Z');
  assert.equal(windowFor(rule, '2026-10-10'), null, 'Saturday is not configured');
  assert.equal(zonedTimeToEpoch('2026-10-07','07:30','America/New_York'), at('2026-10-07T11:30:00Z'));
});

test('A window becomes due only after end + grace, within lookback, and only for rules that existed before it ended', () => {
  const rule = schoolRule();
  assert.deepEqual(dueWindows(rule, at('2026-10-07T06:16:59Z')), []);
  assert.deepEqual(dueWindows(rule, at('2026-10-07T06:17:00Z')).map(w => w.key), ['rule-1|2026-10-07']);
  assert.deepEqual(dueWindows(rule, at('2026-10-07T13:00:00Z')), [], 'older than the lookback');
  assert.deepEqual(dueWindows({...rule, createdAt:'2026-10-07T06:20:00Z'}, at('2026-10-07T06:30:00Z')), [], 'created after the window ended');
  assert.deepEqual(dueWindows({...rule, enabled:false}, at('2026-10-07T06:30:00Z')), []);
  assert.deepEqual(dueWindows(rule, at('2026-10-10T06:30:00Z')), [], 'weekend');
});

test('Any qualifying person observation at any exit camera satisfies the rule', () => {
  const rule = schoolRule(), window = windowFor(rule, '2026-10-07');
  const result = evaluateWindow(rule, window, complete([obs('back','2026-10-07T06:02:00Z')]));
  assert.equal(result.outcome, 'satisfied'); assert.equal(result.matched[0].deviceId, 'back');
  // An event that began before the window and was still running at its start overlaps it.
  assert.equal(evaluateWindow(rule, window, complete([obs('side','2026-10-07T05:29:00Z',{endMs:at('2026-10-07T05:31:00Z')})])).outcome, 'satisfied');
  assert.equal(evaluateWindow(rule, window, complete([obs('front','2026-10-07T06:15:00Z')])).outcome, 'satisfied', 'inclusive end');
});

test('Observations outside the window, at non-exit cameras, doorbells or other types do not satisfy the rule', () => {
  const rule = schoolRule(), window = windowFor(rule, '2026-10-07');
  const result = evaluateWindow(rule, window, complete([
    obs('front','2026-10-07T05:29:59Z'), obs('front','2026-10-07T06:15:01Z'), obs('garage','2026-10-07T05:45:00Z'),
    obs('front','2026-10-07T05:45:00Z',{eventType:'ding'}), obs('front','2026-10-07T05:46:00Z',{eventType:'motion.vehicle'})
  ]));
  assert.equal(result.outcome, 'absence');
  const anyMotion = schoolRule({expectedEventType:'motion'});
  assert.equal(evaluateWindow(anyMotion, windowFor(anyMotion,'2026-10-07'), complete([obs('front','2026-10-07T05:46:00Z',{eventType:'motion'})])).outcome, 'satisfied');
  assert.ok(matchesExpected('motion','motion.human')); assert.ok(!matchesExpected('motion.human','motion')); assert.ok(!matchesExpected('motion','ding'));
});

test('Incomplete evidence never becomes an absence, but positive evidence still satisfies', () => {
  const rule = schoolRule(), window = windowFor(rule, '2026-10-07');
  const unchecked = evaluateWindow(rule, window, {observations:[], complete:false, problems:['History for the back door unavailable: HTTP 424']});
  assert.equal(unchecked.outcome, 'unchecked'); assert.deepEqual(unchecked.problems, ['History for the back door unavailable: HTTP 424']);
  assert.equal(evaluateWindow(rule, window, {observations:[obs('front','2026-10-07T05:50:00Z',{source:'ringWebhook'})], complete:false, problems:['x']}).outcome, 'satisfied');
});

test('Wording reports only what cameras did not record; never location, identity or direction', () => {
  const text = absenceSummary(schoolRule());
  assert.equal(text, 'School run: No person was detected at the front door, the side gate or the back door between 07:30 and 08:15. The cameras cannot show where anyone is.');
  assert.match(absenceSummary(schoolRule({expectedEventType:'motion'})), /No motion was detected/);
  for (const wording of [text, uncheckedSummary(schoolRule())]) {
    assert.doesNotMatch(wording, /still|at home|has not left|hasn't left|didn't leave|leav|Child|missing|burglar|intruder|suspicious/i);
  }
  assert.match(uncheckedSummary(schoolRule()), /could not check.*No alert was raised/);
});
