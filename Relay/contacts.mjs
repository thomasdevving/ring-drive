// Household contacts, member presence (driving or not) and escalation ladders for absence rules.

export const ROLES = ['household','monitored','emergency','neighbour'];
export const CHANNELS = ['app','sms','call'];
export const TARGETS = ['monitored','household','driver','emergency'];
export const PRESENCE_TTL_MS = 10 * 60000;
/** Used when a rule defines no ladder: remind the monitored person, then household members who are not driving, then the driver. */
export const DEFAULT_LADDER = [{target:'monitored', afterSeconds:0}, {target:'household', afterSeconds:300}, {target:'driver', afterSeconds:300}];

export class ContactError extends Error { constructor(message) { super(message); this.status = 400; } }
const text = (value, max, field, optional = false) => {
  if (optional && (value === undefined || value === null || value === '')) return undefined;
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new ContactError(`${field} must be 1-${max} characters.`);
  return value.trim();
};

export function validateContact(input) {
  if (!input || typeof input !== 'object') throw new ContactError('Contact must be a JSON object.');
  if (!ROLES.includes(input.role)) throw new ContactError(`role must be one of ${ROLES.join(', ')}.`);
  const channel = input.channel ?? 'app';
  if (!CHANNELS.includes(channel)) throw new ContactError(`channel must be one of ${CHANNELS.join(', ')}.`);
  const priority = input.priority ?? 5;
  if (!Number.isInteger(priority) || priority < 1 || priority > 9) throw new ContactError('priority must be an integer 1 (first) to 9.');
  const phone = text(input.phone, 20, 'phone', true);
  if (phone && !/^\+[1-9]\d{6,14}$/.test(phone)) throw new ContactError('phone must be in E.164 format, for example +31612345678.');
  if ((channel === 'sms' || channel === 'call') && !phone) throw new ContactError(`channel ${channel} needs a phone number.`);
  // Seed data for demos is flagged so every surface can label it as simulated.
  return {name:text(input.name, 40, 'name'), role:input.role, priority, channel, ...(phone ? {phone} : {}), ...(input.simulated === true ? {simulated:true} : {})};
}

export function validateLadder(steps) {
  if (steps === undefined) return undefined;
  if (!Array.isArray(steps) || !steps.length || steps.length > 5) throw new ContactError('escalation must list 1-5 steps.');
  return steps.map(step => {
    if (!TARGETS.includes(step?.target)) throw new ContactError(`escalation[].target must be one of ${TARGETS.join(', ')}.`);
    const afterSeconds = step.afterSeconds ?? 0;
    if (!Number.isInteger(afterSeconds) || afterSeconds < 0 || afterSeconds > 7200) throw new ContactError('escalation[].afterSeconds must be 0-7200.');
    return {target:step.target, afterSeconds, ...(step.message !== undefined ? {message:text(step.message, 160, 'escalation[].message')} : {})};
  });
}

/** Driving state is trusted only while fresh; unknown is treated as "maybe driving" for preference ordering. */
export function drivingState(contact, now) {
  const p = contact.presence;
  if (!p || now - Date.parse(p.at) > PRESENCE_TTL_MS) return 'unknown';
  return p.driving ? 'driving' : 'not-driving';
}

/**
 * Who receives a ladder step or a driver's "notify household" request. Household members who are known
 * not to be driving come first; members with unknown state follow; members known to be driving are never
 * chosen for household steps (they are the driver step).
 */
export function recipients(contacts, target, now, {excludeContactId} = {}) {
  const byPriority = list => [...list].sort((a,b) => a.priority - b.priority || a.name.localeCompare(b.name));
  const pool = contacts.filter(c => c.id !== excludeContactId);
  switch (target) {
    case 'monitored': return byPriority(pool.filter(c => c.role === 'monitored'));
    case 'emergency': return byPriority(pool.filter(c => c.role === 'emergency' || c.role === 'neighbour'));
    case 'driver': return byPriority(pool.filter(c => c.role === 'household' && drivingState(c, now) === 'driving'));
    case 'household': {
      const household = pool.filter(c => c.role === 'household');
      const free = byPriority(household.filter(c => drivingState(c, now) === 'not-driving'));
      return free.length ? free : byPriority(household.filter(c => drivingState(c, now) === 'unknown'));
    }
  }
  return [];
}
