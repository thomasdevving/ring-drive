// Attention-aware escalation for absence incidents: reach the people who can act without driving first,
// and interrupt the driver only when nobody else has acknowledged.
import {DEFAULT_LADDER, recipients} from './contacts.mjs';
import {Outbox} from './outbox.mjs';
import {backendTransition} from './state-machine.mjs';
import {IncidentError} from './incidents.mjs';

const TARGET_LABELS = {monitored:'monitored person', household:'household members who are not driving', driver:'driver', emergency:'emergency contacts'};

export function stepMessage(step, incident) {
  if (step.message) return step.message;
  const summary = incident.summary?.text ?? 'Ring Drive has an update about your home.';
  switch (step.target) {
    case 'monitored': return `${incident.ruleName ?? 'Ring Drive'}: a reminder from your household. Tap "I'm on my way" to let them know.`;
    case 'household': return `${summary} Tap "I've seen this" so the driver is not interrupted.`;
    default: return summary;
  }
}

export class Escalation {
  constructor({store, outbox = new Outbox(), now = () => Date.now(), log = () => {}}) {
    Object.assign(this, {store, outbox, now, log}); this.queue = Promise.resolve(); this.timer = null;
  }
  start(intervalMs = 5000) { this.timer ??= setInterval(() => this.tick().catch(e => this.log(`Escalation failed: ${e.message}`)), intervalMs); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); this.timer = null; }
  /** Serialized: ladder steps, acknowledgements and driver requests never interleave. */
  #serial(task) { const run = this.queue.then(task); this.queue = run.catch(() => {}); return run; }
  #at() { return new Date(this.now()).toISOString(); }
  #audit(incident, note, source = 'backend') { (incident.audit ??= []).push({at:this.#at(), state:incident.state, note, source}); }

  /** Begins the ladder for a new absence incident and runs every step that is already due. */
  begin(incidentId, ladder = DEFAULT_LADDER) {
    return this.#serial(async () => {
      await this.store.updateIncident(incidentId, i => {
        i.escalation = {ladder, next:0, nextAt:this.#at(), status:'running', steps:[]};
        this.#audit(i, `Escalation started: ${ladder.map(s => s.target).join(' → ')}`);
      });
      await this.#runDue();
    });
  }
  tick() { return this.#serial(() => this.#runDue()); }

  async #runDue() {
    for (const incident of this.store.incidents()) {
      let e = incident.escalation;
      while (e?.status === 'running' && Date.parse(e.nextAt) <= this.now()) { await this.#runStep(incident.id); e = this.store.incident(incident.id).escalation; }
    }
  }

  async #runStep(incidentId) {
    const incident = this.store.incident(incidentId), e = incident.escalation, step = e.ladder[e.next];
    const contacts = this.store.contacts(), message = stepMessage(step, incident);
    const people = recipients(contacts, step.target, this.now());
    const delivered = [];
    for (const contact of people) {
      const result = await this.outbox.deliver(contact, message);
      const notification = await this.store.addNotification({incidentId, step:e.next, target:step.target, contactId:contact.id, contactName:contact.name,
        role:contact.role, message, simulated:!!incident.simulated, ...result});
      if (['delivered','sent','dry_run'].includes(result.status)) delivered.push(notification);
    }
    await this.store.updateIncident(incidentId, i => {
      const label = TARGET_LABELS[step.target];
      if (step.target === 'driver' && i.state === 'TRIAGED') backendTransition(i, 'NOTIFIED', `Driver alerted (escalation step ${e.next + 1}) because no one acknowledged`, this.now());
      const names = delivered.map(n => `${n.contactName} (${n.status === 'dry_run' ? `${n.channel}, dry run` : n.channel})`);
      this.#audit(i, people.length ? `Escalation step ${e.next + 1}: ${label}: ${names.join(', ') || 'no delivery succeeded'}` : `Escalation step ${e.next + 1}: no ${label} available; continuing`);
      i.escalation.steps.push({index:e.next, target:step.target, at:this.#at(), notificationIds:delivered.map(n => n.id)});
      i.escalation.next += 1;
      if (i.escalation.next >= i.escalation.ladder.length) i.escalation.status = 'completed';
      // Nobody reached: there is no one to wait for, so the next step is due immediately.
      else i.escalation.nextAt = new Date(this.now() + (delivered.length || step.target === 'driver' ? i.escalation.ladder[i.escalation.next].afterSeconds * 1000 : 0)).toISOString();
    });
  }

  /** A household member or the monitored person has seen the message: stop escalating before the driver. */
  acknowledge(notificationId, {contactId} = {}) {
    return this.#serial(async () => {
      const notification = this.store.notification(notificationId);
      if (!notification) throw new IncidentError(404, 'Notification not found');
      if (contactId && contactId !== notification.contactId) throw new IncidentError(403, 'This notification belongs to another member.');
      if (notification.ackAt) return {notification, incident:this.store.incident(notification.incidentId), alreadyAcknowledged:true};
      await this.store.updateNotification(notificationId, n => { n.ackAt = this.#at(); });
      const incident = await this.store.updateIncident(notification.incidentId, i => {
        i.acknowledgedBy = [...(i.acknowledgedBy ?? []), {contactId:notification.contactId, name:notification.contactName, role:notification.role, at:this.#at()}];
        if (i.escalation?.status === 'running') i.escalation.status = 'acknowledged';
        this.#audit(i, notification.role === 'monitored' ? `${notification.contactName} replied: on my way` : `${notification.contactName} has seen this`, 'household');
      });
      return {notification:this.store.notification(notificationId), incident};
    });
  }

  /** The driver's NOTIFY_HOUSEHOLD choice: message household members who are not driving (never the requester). */
  notifyHousehold(incidentId, {requestedBy} = {}) {
    return this.#serial(async () => {
      const incident = this.store.incident(incidentId);
      if (!incident) throw new IncidentError(404, 'Incident not found');
      const people = recipients(this.store.contacts(), 'household', this.now(), {excludeContactId:requestedBy});
      const message = `The driver asked you to check this. ${incident.summary?.text ?? ''}`.trim();
      const sent = [];
      for (const contact of people) {
        const result = await this.outbox.deliver(contact, message);
        sent.push(await this.store.addNotification({incidentId, target:'household', requestedByDriver:true, contactId:contact.id, contactName:contact.name,
          role:contact.role, message, simulated:!!incident.simulated, ...result}));
      }
      await this.store.updateIncident(incidentId, i => this.#audit(i, sent.length
        ? `Household notified at the driver's request: ${sent.map(n => `${n.contactName} (${n.status === 'dry_run' ? 'dry run' : n.status})`).join(', ')}`
        : 'Driver asked to notify the household, but every household member appears to be driving or none are configured'));
      return sent;
    });
  }

  inbox(contactId) {
    const since = this.now() - 24 * 3600000;
    return this.store.notifications().filter(n => n.contactId === contactId && n.status === 'delivered' && Date.parse(n.createdAt) >= since)
      .sort((a,b) => b.createdAt.localeCompare(a.createdAt))
      .map(n => ({...n, incidentType:this.store.incident(n.incidentId)?.type ?? null}));
  }
}
