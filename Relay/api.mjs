import {randomUUID} from 'node:crypto';
import {validateRule, RuleError, localDateOf} from './absence.mjs';
import {IncidentError} from './incidents.mjs';

const uuid = '([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})';
const routes = {
  rule:new RegExp(`^/rules/${uuid}$`), runs:new RegExp(`^/rules/${uuid}/runs$`),
  evaluate:new RegExp(`^/rules/${uuid}/evaluate$`), incident:new RegExp(`^/incidents/${uuid}$`),
  summary:new RegExp(`^/incidents/${uuid}/summary$`)
};
const SIMULATED_TYPES = new Set(['motion','motion.human','motion.vehicle','motion.animal','motion.other_motion','ding']);

/**
 * Household API used by the native app and scripts. The caller has already checked the client token.
 * Returns false when the path is not an API route.
 */
export async function handleApi(req, res, url, {store, scheduler, incidents, simulation, now, json, readBody}) {
  const path = url.pathname, method = req.method;
  const body = async () => { const raw = await readBody(req); return raw.length ? JSON.parse(raw) : {}; };
  let match;
  try {
    if (path === '/rules' && method === 'GET') return json(res, 200, {data:store.rules()}), true;
    if (path === '/rules' && method === 'POST') return json(res, 201, {data:await store.createRule(validateRule(await body()))}), true;
    if ((match = path.match(routes.rule))) {
      const id = match[1];
      if (method === 'GET') { const rule = store.rule(id); return json(res, rule ? 200 : 404, rule ? {data:rule} : {error:'Rule not found'}), true; }
      if (method === 'PUT') { const rule = await store.replaceRule(id, validateRule(await body())); return json(res, rule ? 200 : 404, rule ? {data:rule} : {error:'Rule not found'}), true; }
      if (method === 'DELETE') { const removed = await store.deleteRule(id); res.writeHead(removed ? 204 : 404).end(); return true; }
    }
    if ((match = path.match(routes.runs)) && method === 'GET') return json(res, 200, {data:store.runsFor(match[1])}), true;
    if ((match = path.match(routes.evaluate)) && method === 'POST') {
      const rule = store.rule(match[1]); if (!rule) return json(res, 404, {error:'Rule not found'}), true;
      const {date = localDateOf(rule.timeZone, now())} = await body();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, {error:'date must be YYYY-MM-DD in the rule time zone'}), true;
      const result = await scheduler.evaluateDate(rule, date);
      return json(res, result.error ? 409 : 200, result.error ? {error:result.error} : {data:result.run, alreadyEvaluated:!!result.alreadyEvaluated}), true;
    }
    if (path === '/incidents' && method === 'GET') return json(res, 200, {data:store.incidents()}), true;
    if (path === '/incidents' && method === 'POST') {
      const result = await incidents.upsertIntrusion(await body());
      return json(res, result.created ? 201 : 200, {data:result.incident}), true;
    }
    if ((match = path.match(routes.summary)) && method === 'GET') {
      // Read at tap time: always answers immediately with the best stored text.
      const incident = store.incident(match[1]); if (!incident) return json(res, 404, {error:'Incident not found'}), true;
      return json(res, 200, {data:{...incident.summary, status:incident.summaryStatus ?? 'ready'}}), true;
    }
    if ((match = path.match(routes.incident)) && method === 'GET') {
      const incident = store.incident(match[1]); return json(res, incident ? 200 : 404, incident ? {data:incident} : {error:'Incident not found'}), true;
    }
    if (path === '/simulate/observations' && method === 'POST') {
      // Off unless SIMULATION_ENABLED=1. Simulated evidence is stored separately and never satisfies a Ring rule.
      if (!simulation) return json(res, 403, {error:'Simulation is disabled on this backend'}), true;
      const input = await body();
      const startMs = input.startMs ?? now(), endMs = input.endMs;
      if (typeof input.deviceId !== 'string' || !input.deviceId || input.deviceId.length > 128 || !SIMULATED_TYPES.has(input.eventType)
        || !Number.isSafeInteger(startMs) || startMs > now() + 5000 || (endMs !== undefined && (!Number.isSafeInteger(endMs) || endMs < startMs)))
        return json(res, 400, {error:'Need deviceId, a documented eventType, and epoch-ms startMs/endMs not in the future'}), true;
      const observation = {id:`sim-${randomUUID()}`, deviceId:input.deviceId, eventType:input.eventType, startMs, endMs, source:'simulated', simulated:true};
      await store.addObservation(observation);
      return json(res, 201, {data:observation}), true;
    }
  } catch (error) {
    if (error instanceof RuleError) return json(res, 400, {error:error.message}), true;
    if (error instanceof IncidentError) return json(res, error.status, {error:error.message}), true;
    if (error instanceof SyntaxError) return json(res, 400, {error:'Malformed JSON'}), true;
    throw error;
  }
  return false;
}
