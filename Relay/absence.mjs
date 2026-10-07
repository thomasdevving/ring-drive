// Absence rules: fire when an expected observation does NOT happen inside a user-configured window.
// Ring provides no identity or direction, so the person label is used for wording and routing only;
// any qualifying observation at any exit camera satisfies the rule.

import {validateLadder} from './contacts.mjs';

export const DAYS = ['sun','mon','tue','wed','thu','fri','sat'];
// Documented Ring history filters that a rule may expect. A doorbell press is never an exit.
export const EXPECTED_TYPES = ['motion.human','motion'];
export const RULE_LIMITS = {graceSeconds:{min:0,max:900,default:120}, maxCameras:12};

export class RuleError extends Error {}

const clock = /^([01]\d|2[0-3]):([0-5]\d)$/;
const text = (value, max, field) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new RuleError(`${field} must be 1-${max} characters.`);
  return value.trim();
};
function validTimeZone(zone) {
  try { new Intl.DateTimeFormat('en-US',{timeZone:zone}); return true; } catch { return false; }
}

/** Returns a normalised rule or throws RuleError. Identity and timestamps are assigned by the store. */
export function validateRule(input) {
  if (!input || typeof input !== 'object') throw new RuleError('Rule must be a JSON object.');
  const days = input.daysOfWeek;
  if (!Array.isArray(days) || !days.length || days.some(d => !DAYS.includes(d))) throw new RuleError(`daysOfWeek must be a non-empty subset of ${DAYS.join(', ')}.`);
  const start = input.window?.start, end = input.window?.end;
  if (!clock.test(start ?? '') || !clock.test(end ?? '')) throw new RuleError('window.start and window.end must be HH:MM (24-hour).');
  if (end <= start) throw new RuleError('window.end must be after window.start on the same day.');
  if (!validTimeZone(input.timeZone)) throw new RuleError('timeZone must be an IANA time zone such as Europe/Amsterdam.');
  const cameras = input.exitCameras;
  if (!Array.isArray(cameras) || !cameras.length || cameras.length > RULE_LIMITS.maxCameras) throw new RuleError(`exitCameras must list 1-${RULE_LIMITS.maxCameras} cameras; include every exit, not only the front door.`);
  const exitCameras = cameras.map(c => ({deviceId:text(c?.deviceId,128,'exitCameras[].deviceId'), label:text(c?.label,40,'exitCameras[].label')}));
  if (new Set(exitCameras.map(c => c.deviceId)).size !== exitCameras.length) throw new RuleError('exitCameras must not repeat a device.');
  const expectedEventType = input.expectedEventType ?? 'motion.human';
  if (!EXPECTED_TYPES.includes(expectedEventType)) throw new RuleError(`expectedEventType must be one of ${EXPECTED_TYPES.join(', ')}.`);
  const {min, max, default: fallback} = RULE_LIMITS.graceSeconds;
  const graceSeconds = input.graceSeconds ?? fallback;
  if (!Number.isInteger(graceSeconds) || graceSeconds < min || graceSeconds > max) throw new RuleError(`graceSeconds must be an integer from ${min} to ${max}.`);
  const evidenceSource = input.evidenceSource ?? 'ring';
  if (!['ring','simulated'].includes(evidenceSource)) throw new RuleError('evidenceSource must be ring or simulated.');
  let escalation;
  try { escalation = validateLadder(input.escalation); } catch (error) { throw new RuleError(error.message); }
  return {
    name:text(input.name,60,'name'), personLabel:text(input.personLabel,40,'personLabel'),
    daysOfWeek:DAYS.filter(d => days.includes(d)), window:{start,end}, timeZone:input.timeZone,
    exitCameras, expectedEventType, graceSeconds, evidenceSource, enabled:input.enabled !== false, ...(escalation ? {escalation} : {})
  };
}

function zonedParts(zone, ms) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',weekday:'short'})
    .formatToParts(new Date(ms)).map(p => [p.type,p.value]));
  return {year:+parts.year, month:+parts.month, day:+parts.day, hour:+parts.hour, minute:+parts.minute, second:+parts.second, weekday:parts.weekday.toLowerCase()};
}
const offsetAt = (zone, ms) => {
  const p = zonedParts(zone, ms);
  return Date.UTC(p.year,p.month-1,p.day,p.hour,p.minute,p.second) - Math.floor(ms / 1000) * 1000;
};
/** Wall-clock time in a zone → epoch ms. Two passes settle DST transitions. */
export function zonedTimeToEpoch(localDate, hhmm, zone) {
  const [y,m,d] = localDate.split('-').map(Number), [h,mi] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y,m-1,d,h,mi);
  const first = guess - offsetAt(zone, guess);
  return guess - offsetAt(zone, first);
}
export function localDateOf(zone, ms) {
  const p = zonedParts(zone, ms);
  return `${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
}
export function weekdayOf(localDate) {
  const [y,m,d] = localDate.split('-').map(Number);
  return DAYS[new Date(Date.UTC(y,m-1,d)).getUTCDay()];
}
const shiftDate = (localDate, days) => {
  const [y,m,d] = localDate.split('-').map(Number);
  return new Date(Date.UTC(y,m-1,d+days)).toISOString().slice(0,10);
};

/** The window for one local date, or null when the rule does not apply on that day. */
export function windowFor(rule, localDate) {
  if (!rule.daysOfWeek.includes(weekdayOf(localDate))) return null;
  return {ruleId:rule.id, localDate, key:`${rule.id}|${localDate}`,
    startMs:zonedTimeToEpoch(localDate, rule.window.start, rule.timeZone),
    endMs:zonedTimeToEpoch(localDate, rule.window.end, rule.timeZone)};
}

/** Windows whose end + grace has passed, newest last. Lookback bounds catch-up after a restart. */
export function dueWindows(rule, now, lookbackMs = 6 * 3600000) {
  if (!rule.enabled) return [];
  const today = localDateOf(rule.timeZone, now);
  return [shiftDate(today,-1), today].map(date => windowFor(rule, date)).filter(w => w
    && w.endMs + rule.graceSeconds * 1000 <= now
    && now - w.endMs <= lookbackMs
    && w.endMs > Date.parse(rule.createdAt));
}

export const matchesExpected = (expected, eventType) =>
  expected === 'motion' ? eventType === 'motion' || eventType?.startsWith('motion.') : eventType === expected;
const overlaps = (o, w) => o.startMs <= w.endMs && (o.endMs ?? o.startMs) >= w.startMs;

/**
 * Pure decision for one window.
 * evidence: {observations:[{deviceId,eventType,startMs,endMs?,source}], complete:boolean, problems:[string]}
 *  - complete means every exit camera's history was read back to the window start.
 * A missing observation becomes ABSENCE only when the evidence is complete; otherwise it is UNCHECKED.
 */
export function evaluateWindow(rule, window, evidence) {
  const exits = new Set(rule.exitCameras.map(c => c.deviceId));
  const matched = evidence.observations.filter(o => exits.has(o.deviceId) && matchesExpected(rule.expectedEventType, o.eventType) && overlaps(o, window))
    .sort((a,b) => a.startMs - b.startMs);
  if (matched.length) return {outcome:'satisfied', matched};
  if (!evidence.complete) return {outcome:'unchecked', matched:[], problems:evidence.problems};
  return {outcome:'absence', matched:[]};
}

const list = items => items.length < 2 ? items.join('') : `${items.slice(0,-1).join(', ')} or ${items.at(-1)}`;
/**
 * Spoken wording. States only what the cameras did not record. It never claims where anyone is,
 * who someone is, or which way they moved, because Ring provides none of that.
 */
export function absenceSummary(rule) {
  const what = rule.expectedEventType === 'motion' ? 'No motion was detected' : 'No person was detected';
  const where = list(rule.exitCameras.map(c => `the ${c.label}`));
  return `${rule.name}: ${what} at ${where} between ${rule.window.start} and ${rule.window.end}. The cameras cannot show where anyone is.`;
}
export function uncheckedSummary(rule) {
  return `${rule.name}: Ring Drive could not check the cameras for ${rule.window.start} to ${rule.window.end}. No alert was raised.`;
}
