import {Summarizer, templateSummary, DEFAULT_TIME_ZONE} from './summary.mjs';
import {applyEntries, backendTransition, availableChoices} from './state-machine.mjs';

export class IncidentError extends Error { constructor(status, message) { super(message); this.status = status; } }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZONES = new Set(['front','side','rear','unknown']);
const KINDS = new Set(['person','package','departed','motion','doorbell']);
const PRIORITIES = new Set(['passive','review','urgent']);
const string = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;

/** Camera incidents are triaged on the phone and synced here for summaries, timeline and household features. */
export function validateIntrusion(input) {
  if (!input || typeof input !== 'object' || !UUID.test(input.id ?? '')) throw new IncidentError(400, 'id must be the incident UUID.');
  if (!PRIORITIES.has(input.priority)) throw new IncidentError(400, 'priority must be passive, review or urgent.');
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  try { new Intl.DateTimeFormat('en-US', {timeZone}); } catch { throw new IncidentError(400, 'timeZone must be an IANA time zone.'); }
  if (!Array.isArray(input.observations) || !input.observations.length || input.observations.length > 200) throw new IncidentError(400, 'observations must contain 1-200 items.');
  const observations = input.observations.map(o => {
    if (!string(o?.id, 200) || !string(o.deviceId, 128) || !ZONES.has(o.zone) || !KINDS.has(o.kind) || !Number.isSafeInteger(o.atMs)
      || (o.endMs !== undefined && (!Number.isSafeInteger(o.endMs) || o.endMs < o.atMs)) || !(o.confidence >= 0 && o.confidence <= 1)
      || (o.cameraName !== undefined && !string(o.cameraName, 60)) || (o.componentId !== undefined && !string(o.componentId, 128)))
      throw new IncidentError(400, 'Each observation needs id, deviceId, zone, kind, atMs and confidence 0-1; cameraName/componentId/endMs are optional.');
    return {id:o.id, deviceId:o.deviceId, zone:o.zone, kind:o.kind, atMs:o.atMs, confidence:o.confidence,
      ...(o.endMs !== undefined ? {endMs:o.endMs} : {}), ...(o.cameraName ? {cameraName:o.cameraName} : {}), ...(o.componentId ? {componentId:o.componentId} : {})};
  });
  return {id:input.id, priority:input.priority, simulated:input.simulated === true, timeZone, observations};
}

export class IncidentService {
  constructor({store, summarizer = new Summarizer(), now = () => Date.now(), log = () => {}}) {
    Object.assign(this, {store, summarizer, now, log}); this.pending = new Set();
  }
  /** Resolves when all background summary generations have finished (tests, shutdown). */
  async idle() { while (this.pending.size) await Promise.allSettled([...this.pending]); }

  /** Called for every new or materially changed incident. Never blocks the caller on Bedrock. */
  refreshSummary(id) {
    const task = this.#refresh(id).catch(error => this.log(`Summary refresh failed: ${error.message}`));
    this.pending.add(task); task.finally(() => this.pending.delete(task));
    return task;
  }
  async #refresh(id) {
    let generation;
    const incident = await this.store.updateIncident(id, i => {
      generation = (i.summaryGeneration ?? 0) + 1; i.summaryGeneration = generation; i.summaryStatus = 'generating';
      i.summary = {text:templateSummary(i), source:'template', generatedAt:new Date(this.now()).toISOString(), basedOn:i.observations?.length ?? 0};
    });
    if (!incident) return;
    const summary = await this.summarizer.summarize(structuredClone(incident));
    // A newer observation set may have arrived meanwhile; only the latest generation may write.
    await this.store.updateIncident(id, i => { if (i.summaryGeneration === generation) { i.summary = summary; i.summaryStatus = 'ready'; } });
  }

  /** A new absence incident: summary in the background, then the driver is alerted. */
  async absenceCreated(incident) {
    this.refreshSummary(incident.id);
    await this.store.updateIncident(incident.id, i => {
      backendTransition(i, 'TRIAGED', 'Absence confirmed: camera history read for every exit camera', this.now());
      backendTransition(i, 'NOTIFIED', 'Driver alerted', this.now());
    });
  }

  /** Audit entries reported by the driver app (or Siri) in order; idempotent by entry id. */
  async recordEntries(id, entries) {
    const incident = this.store.incident(id);
    if (!incident) throw new IncidentError(404, 'Incident not found');
    const {accepted, state} = applyEntries(incident, entries, this.now());
    if (accepted.length) await this.store.updateIncident(id, i => { i.audit = [...(i.audit ?? []), ...accepted]; i.state = state; });
    return {incident:this.store.incident(id), accepted:accepted.length};
  }

  /** Response shape: the stored record plus the choices the driver can take now. */
  present(incident) { return {...incident, availableChoices:availableChoices(incident)}; }

  async upsertIntrusion(input) {
    const fields = validateIntrusion(input), existing = this.store.incident(fields.id);
    if (!existing) {
      const incident = await this.store.createIncident({...fields, type:'INTRUSION', status:'active', state:'NOTIFIED',
        audit:[{at:new Date(this.now()).toISOString(), state:'NOTIFIED', note:'Camera incident synced from the driver app'}]});
      this.refreshSummary(incident.id);
      return {incident, created:true};
    }
    if (existing.type !== 'INTRUSION') throw new IncidentError(409, 'Incident exists with a different type.');
    if (existing.simulated !== fields.simulated) throw new IncidentError(409, 'Simulated and real evidence cannot be combined.');
    const known = new Set(existing.observations.map(o => o.id));
    const added = fields.observations.filter(o => !known.has(o.id));
    const changed = added.length > 0 || existing.priority !== fields.priority;
    const incident = await this.store.updateIncident(fields.id, i => {
      i.observations = [...i.observations, ...added].sort((a,b) => a.atMs - b.atMs); i.priority = fields.priority;
    });
    if (changed) this.refreshSummary(incident.id);
    return {incident, created:false, changed};
  }
}
