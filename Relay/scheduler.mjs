import {RING_ORIGIN} from './ring-client.mjs';
import {dueWindows, windowFor, evaluateWindow, absenceSummary} from './absence.mjs';

const HISTORY_PAGE_LIMIT = 20;
// History is newest-first by start; read slightly past the window start so long events that began earlier still overlap.
const HISTORY_OVERLAP_MARGIN_MS = 15 * 60000;
export const UNCHECKED_RETRY = {intervalMs:5 * 60000, maxAttempts:6};

/** Reads every exit camera's history back to the window start. Any failure makes the evidence incomplete. */
export async function collectEvidence({rule, window, ring, store}) {
  const sinceMs = window.startMs - HISTORY_OVERLAP_MARGIN_MS;
  if (rule.evidenceSource === 'simulated') {
    return {observations:store.observations({simulated:true, sinceMs}), complete:true, problems:[]};
  }
  // Signed webhook observations are positive evidence only; they never prove that nothing happened.
  const observations = store.observations({simulated:false, sinceMs}), problems = [];
  if (!ring) return {observations, complete:false, problems:['Ring backend is not configured']};
  for (const camera of rule.exitCameras) {
    let cursor = null, reached = false;
    try {
      for (let page = 0; page < HISTORY_PAGE_LIMIT && !reached; page++) {
        const body = await ring.history(camera.deviceId, cursor, rule.expectedEventType);
        for (const event of body.data) {
          const startMs = Number(event.attributes?.start), endMs = Number(event.attributes?.end);
          if (!Number.isFinite(startMs) || event.attributes?.event_type === 'ding') continue;
          // The query is filtered server-side by the expected type; the returned subtype format is not documented.
          observations.push({id:event.id, deviceId:camera.deviceId, eventType:rule.expectedEventType, startMs,
            endMs:Number.isFinite(endMs) ? endMs : undefined, source:'ringHistory'});
          if (startMs < sinceMs) reached = true;
        }
        const next = body.links?.next;
        if (!next) { reached = true; break; }
        cursor = new URL(next, RING_ORIGIN).searchParams.get('page[key]');
        if (!cursor) { reached = true; break; }
      }
      if (!reached) problems.push(`History for the ${camera.label} exceeded ${HISTORY_PAGE_LIMIT} pages`);
    } catch (error) {
      problems.push(`History for the ${camera.label} unavailable: ${error.status ? `HTTP ${error.status}` : 'request failed'}`);
    }
  }
  return {observations, complete:problems.length === 0, problems};
}

export class AbsenceScheduler {
  constructor({store, ring = null, now = () => Date.now(), onIncident = async () => {}, log = () => {}}) {
    Object.assign(this, {store, ring, now, onIncident, log}); this.running = null; this.timer = null; this.queue = Promise.resolve();
  }
  start(intervalMs = 30000) { this.timer ??= setInterval(() => this.tick().catch(e => this.log(`Absence check failed: ${e.message}`)), intervalMs); this.timer.unref?.(); }
  stop() { clearInterval(this.timer); this.timer = null; }

  /** Evaluates every due window once; UNCHECKED windows are retried a bounded number of times. */
  tick() {
    if (this.running) return this.running;
    const task = (async () => {
      const results = [];
      for (const rule of this.store.rules()) for (const window of dueWindows(rule, this.now())) {
        const previous = this.store.run(window.key);
        if (previous && (previous.outcome !== 'unchecked' || previous.attempts >= UNCHECKED_RETRY.maxAttempts
          || this.now() - Date.parse(previous.evaluatedAt) < UNCHECKED_RETRY.intervalMs)) continue;
        results.push(await this.evaluate(rule, window));
      }
      return results;
    })();
    // Cleared after assignment: a tick with nothing due settles synchronously.
    this.running = task.finally(() => { this.running = null; });
    return this.running;
  }

  /** Manual evaluation of an ended window (demo and support). Final outcomes are never re-evaluated. */
  async evaluateDate(rule, localDate) {
    const window = windowFor(rule, localDate);
    if (!window) return {error:'The rule does not apply on that date.'};
    if (window.endMs > this.now()) return {error:'The window has not ended yet.'};
    const previous = this.store.run(window.key);
    if (previous && previous.outcome !== 'unchecked') return {run:previous, alreadyEvaluated:true};
    return {run:await this.evaluate(rule, window)};
  }

  /** Serialized so a manual evaluation and a scheduler tick cannot both create an incident for one window. */
  evaluate(rule, window) {
    const task = this.queue.then(() => {
      const previous = this.store.run(window.key);
      return previous && previous.outcome !== 'unchecked' ? previous : this.#evaluate(rule, window, previous);
    });
    this.queue = task.catch(() => {});
    return task;
  }

  async #evaluate(rule, window, previous) {
    const evidence = await collectEvidence({rule, window, ring:this.ring, store:this.store});
    const result = evaluateWindow(rule, window, evidence);
    const at = new Date(this.now()).toISOString();
    let incident = null;
    if (result.outcome === 'absence') {
      incident = await this.store.createIncident({
        type:'ABSENCE', simulated:rule.evidenceSource === 'simulated', status:'active', state:'DETECTED',
        ruleId:rule.id, ruleName:rule.name, personLabel:rule.personLabel, expectedEventType:rule.expectedEventType,
        window:{localDate:window.localDate, start:rule.window.start, end:rule.window.end, timeZone:rule.timeZone, startMs:window.startMs, endMs:window.endMs},
        cameras:rule.exitCameras,
        summary:{text:absenceSummary(rule), source:'template', generatedAt:at},
        audit:[{at, state:'DETECTED', note:`No qualifying observation at ${rule.exitCameras.length} exit camera(s); camera history read for the full window`}]
      });
    }
    const run = await this.store.putRun({key:window.key, ruleId:rule.id, localDate:window.localDate, outcome:result.outcome,
      evaluatedAt:at, attempts:(previous?.attempts ?? 0) + 1, matchedCount:result.matched.length,
      firstMatchAt:result.matched[0] ? new Date(result.matched[0].startMs).toISOString() : null,
      problems:result.problems ?? [], incidentId:incident?.id ?? null});
    this.log(`Absence rule window ${window.localDate}: ${result.outcome}`);
    if (incident) await this.onIncident(incident);
    return run;
  }
}
