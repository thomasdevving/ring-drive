// Mirror of the Swift incident state machine (Sources/RingDriveCore/Models.swift, DriverChoices.swift).
// The backend is the authority for ABSENCE incidents; for camera incidents the phone enforces parking
// safety and reports its transitions, which are recorded here for the timeline, household and Alexa views.
import {IncidentError} from './incidents.mjs';

export const STATES = ['DETECTED','TRIAGED','NOTIFIED','EXPLAINED','STOP_REQUESTED','NAVIGATING','PARKED_CONFIRMED','VIDEO_UNLOCKED',
  'HOUSEHOLD_NOTIFIED','CONTACT_CALLED','DISMISSED'];
export const ALLOWED = {
  DETECTED:['TRIAGED'], TRIAGED:['NOTIFIED'], NOTIFIED:['EXPLAINED'],
  EXPLAINED:['STOP_REQUESTED','HOUSEHOLD_NOTIFIED','CONTACT_CALLED','DISMISSED'],
  HOUSEHOLD_NOTIFIED:['CONTACT_CALLED','STOP_REQUESTED','DISMISSED'], CONTACT_CALLED:['HOUSEHOLD_NOTIFIED','STOP_REQUESTED','DISMISSED'],
  STOP_REQUESTED:['NAVIGATING','PARKED_CONFIRMED','DISMISSED'], NAVIGATING:['STOP_REQUESTED','PARKED_CONFIRMED','DISMISSED'],
  PARKED_CONFIRMED:['VIDEO_UNLOCKED'], VIDEO_UNLOCKED:[], DISMISSED:[]
};
export const CHOICE_TARGETS = {NOTIFY_HOUSEHOLD:'HOUSEHOLD_NOTIFIED', CALL_CONTACT:'CONTACT_CALLED', FIND_STOP:'STOP_REQUESTED', DISMISS:'DISMISSED'};
const VIDEO_STATES = new Set(['PARKED_CONFIRMED','VIDEO_UNLOCKED']);

/** Same policy as ChoicePolicy.offered in Swift. */
export function offeredChoices(incident) {
  if (incident.type === 'ABSENCE') return ['NOTIFY_HOUSEHOLD','CALL_CONTACT','DISMISS'];
  if (incident.status === 'resolved') return ['FIND_STOP','DISMISS'];
  return {urgent:['FIND_STOP','NOTIFY_HOUSEHOLD','CALL_CONTACT','DISMISS'], review:['FIND_STOP','DISMISS'], passive:['FIND_STOP','DISMISS']}[incident.priority] ?? ['DISMISS'];
}
export function availableChoices(incident) {
  return offeredChoices(incident).filter(c => ALLOWED[incident.state]?.includes(CHOICE_TARGETS[c]));
}

/** Validates one entry against the incident; returns the normalized audit entry. Does not mutate. */
export function checkEntry(incident, entry, now) {
  const at = Date.parse(entry?.at ?? '');
  if (!STATES.includes(entry?.state) || !Number.isFinite(at) || Math.abs(now - at) > 86400000) throw new IncidentError(400, 'Each entry needs a known state and an ISO timestamp within a day.');
  if (entry.choice !== undefined && entry.choice !== null) {
    if (CHOICE_TARGETS[entry.choice] !== entry.state) throw new IncidentError(400, 'choice does not match state.');
    if (!offeredChoices(incident).includes(entry.choice)) throw new IncidentError(409, `${entry.choice} is not offered for this incident.`);
  }
  if (incident.type === 'ABSENCE') {
    if (VIDEO_STATES.has(entry.state) || entry.state === 'STOP_REQUESTED' || entry.state === 'NAVIGATING') throw new IncidentError(409, 'Absence incidents have no stop or video path.');
    if (!ALLOWED[incident.state]?.includes(entry.state)) throw new IncidentError(409, `Transition ${incident.state} → ${entry.state} is not allowed.`);
  }
  const note = typeof entry.note === 'string' ? entry.note.slice(0, 200) : (entry.choice ? `Driver chose ${entry.choice}` : 'Transition accepted');
  return {id:typeof entry.id === 'string' ? entry.id.slice(0, 64) : undefined, at:new Date(at).toISOString(), state:entry.state, note,
    ...(entry.choice ? {choice:entry.choice} : {}), source:['driver-app','siri','backend','household'].includes(entry.source) ? entry.source : 'driver-app'};
}

/** Applies entries in order, skipping ids already recorded. Returns the number of new entries. */
export function applyEntries(incident, entries, now) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 50) throw new IncidentError(400, 'entries must contain 1-50 items.');
  const known = new Set((incident.audit ?? []).map(e => e.id).filter(Boolean));
  const draft = {...incident}, accepted = [];
  for (const raw of entries) {
    if (raw?.id && known.has(raw.id)) continue;
    const entry = checkEntry(draft, raw, now);
    accepted.push(entry); draft.state = entry.state; if (entry.id) known.add(entry.id);
  }
  return {accepted, state:draft.state};
}

/** Backend-originated transition (escalation engine, household acknowledgement). */
export function backendTransition(incident, state, note, now) {
  if (!ALLOWED[incident.state]?.includes(state)) throw new IncidentError(409, `Transition ${incident.state} → ${state} is not allowed.`);
  incident.state = state;
  (incident.audit ??= []).push({at:new Date(now).toISOString(), state, note, source:'backend'});
}
