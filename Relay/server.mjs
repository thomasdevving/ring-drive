import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { RingClient, RingError, EncryptedTokenStore, RING_ORIGIN } from './ring-client.mjs';
import { Store } from './store.mjs';
import { AbsenceScheduler } from './scheduler.mjs';
import { handleApi } from './api.mjs';
import { IncidentService } from './incidents.mjs';
import { Summarizer, bedrockClientFromEnv, DEFAULT_MODEL } from './summary.mjs';

const API_PREFIXES = ['/rules', '/incidents', '/simulate'];

export function verifySignature(key, raw, received = '') {
  const hex = received.replace(/^sha256=/, '');
  if (!key || !/^[a-fA-F0-9]{64}$/.test(hex)) return false;
  return timingSafeEqual(createHmac('sha256', key).update(raw).digest(), Buffer.from(hex, 'hex'));
}
export function createRelay({ signingKey, clientToken, expectedAccount, ring, now = () => Date.now(), store = new Store(null, now),
  incidents = new IncidentService({store, now}),
  scheduler = new AbsenceScheduler({store, ring, now, onIncident:incident => incidents.refreshSummary(incident.id)}), simulation = false }) {
  if (!clientToken) throw new Error('Configure RELAY_CLIENT_TOKEN using scripts/setup_ring.mjs.');
  const queue = [], seen = new Map(), calls = [];
  function json(res, code, body) { res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); }
  function authorised(req) {
    const received = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${clientToken}`);
    return received.length === expected.length && timingSafeEqual(received, expected);
  }
  async function readBody(req) {
    const chunks = []; let length = 0;
    for await (const chunk of req) { length += chunk.length; if (length > 65536) throw new RingError(413, 'Payload too large'); chunks.push(chunk); }
    return Buffer.concat(chunks);
  }
  function record(endpoint, count, status = 200) {
    // Injected test transports must never create an official-runtime receipt.
    if (ring?.fetch !== globalThis.fetch) return;
    calls.push({method:endpoint.includes('media/video')?'POST':'GET',endpoint,status,count,at:new Date(now()).toISOString()});
    if (calls.length > 50) calls.shift();
  }
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, {status:'ready', mode:'ring-backend'});
    if (req.url?.startsWith('/ring/')) {
      if (!authorised(req)) return json(res, 401, {error:'Backend client token required'});
      if (!ring) return json(res, 503, {error:'Ring backend is not configured'});
      try {
        const url = new URL(req.url, 'http://localhost');
        if (req.method === 'GET' && url.pathname === '/ring/proof') return json(res, 200, {origin:RING_ORIGIN,calls,verified:calls.length > 0});
        if (req.method === 'GET' && url.pathname === '/ring/v1/users/me') {
          const body = await ring.profile(); record('/v1/users/me',1); return json(res,200,body);
        }
        if (req.method === 'GET' && url.pathname === '/ring/v1/devices') {
          const body = await ring.devices(); record('/v1/devices',body.data.length); return json(res,200,body);
        }
        const history = url.pathname.match(/^\/ring\/v1\/history\/devices\/([^/]+)\/events$/);
        if (req.method === 'GET' && history) {
          const body = await ring.history(decodeURIComponent(history[1]),url.searchParams.get('page[key]'));
          record('/v1/history/devices/[redacted]/events',body.data.length); return json(res,200,body);
        }
        const video = url.pathname.match(/^\/ring\/v1\/devices\/([^/]+)\/media\/video\/download$/);
        if (req.method === 'POST' && video) {
          // The native safety guard supplies this only after checking fresh parking evidence.
          // This marker is not independent vehicle telemetry or hardware attestation.
          if (req.headers['x-ring-drive-parking'] !== 'confirmed') return json(res,423,{error:'Native parking confirmation required'});
          const body = JSON.parse(await readBody(req));
          const clip = await ring.clip(decodeURIComponent(video[1]),body);
          record('/v1/devices/[redacted]/media/video/download',1,clip.status);
          res.writeHead(clip.status,{'Content-Type':'video/mp4','Cache-Control':'no-store'}); return res.end(clip.bytes);
        }
        return json(res,404,{error:'Unsupported Ring endpoint'});
      } catch (error) {
        const status = error instanceof RingError ? error.status : error instanceof SyntaxError || error instanceof URIError ? 400 : 502;
        return json(res,status,{error:error instanceof RingError ? error.message : 'Ring backend request failed. No credentials or upstream payloads are logged.'});
      }
    }
    if (req.method === 'GET' && req.url === '/events') {
      if (!authorised(req)) return json(res, 401, {error:'Client token required'});
      // Retain bounded events; client deduplicates. An interrupted fetch cannot lose a delivery.
      return json(res, 200, {events:queue.filter(e => now() - e.data.attributes.timestamp <= 180000)});
    }
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (API_PREFIXES.some(prefix => path === prefix || path.startsWith(prefix + '/'))) {
      if (!authorised(req)) return json(res, 401, {error:'Client token required'});
      try {
        if (await handleApi(req, res, new URL(req.url, 'http://localhost'), {store, scheduler, incidents, simulation, now, json, readBody})) return;
      } catch (error) { return json(res, error instanceof RingError ? error.status : 500, {error:'Request failed'}); }
      return json(res, 404, {error:'Not found'});
    }
    if (req.method !== 'POST' || req.url !== '/webhooks/ring') return json(res, 404, {error:'Not found'});
    try {
      const account = expectedAccount || ring?.accountID;
      if (!signingKey || !account) return json(res,503,{error:'Signed webhooks need an HMAC key and a verified Ring account'});
      const raw = await readBody(req);
      if (!verifySignature(signingKey, raw, req.headers['x-signature'])) return json(res, 401, {error:'Invalid signature'});
      const event = JSON.parse(raw);
      if (event.meta?.account_id !== account) return json(res, 403, {error:'Account mismatch'});
      if (!event.meta?.request_id || !event.data?.id) return json(res, 400, {error:'Missing identity'});
      // Acknowledge lifecycle events too, without forwarding tokens or unsupported resources.
      if (!['motion_detected','button_press'].includes(event.data.type)) return json(res, 200, {accepted:true, ignored:true});
      const a = event.data.attributes;
      if (typeof a?.source !== 'string' || !Number.isFinite(a?.timestamp)) return json(res, 400, {error:'Invalid event attributes'});
      if (a.timestamp > now() + 5000 || now() - a.timestamp > 180000) return json(res, 200, {accepted:true, stale:true});
      const key = `${event.meta.account_id}|${event.data.id}`;
      for (const [id, time] of seen) if (now() - time > 600000) seen.delete(id);
      if (seen.has(key)) return json(res, 200, {accepted:true, duplicate:true});
      seen.set(key, now());
      // Allow-list fields so credential lifecycle payloads cannot leak to clients.
      queue.push({meta:{request_id:event.meta.request_id,account_id:event.meta.account_id},data:{id:event.data.id,type:event.data.type,attributes:{source:a.source,timestamp:a.timestamp,sub_type:a.sub_type,component_ids:a.component_ids}}});
      if (queue.length > 1000) queue.shift();
      // Positive evidence for absence rules. Storage failure must not turn into a Ring redelivery loop.
      await store.addObservation({id:key, deviceId:a.source, startMs:a.timestamp, source:'ringWebhook', simulated:false,
        eventType:event.data.type === 'button_press' ? 'ding' : (a.sub_type && a.sub_type !== 'motion' ? `motion.${a.sub_type}` : 'motion'),
        ...(Array.isArray(a.component_ids) ? {componentIds:a.component_ids.filter(c => typeof c === 'string').slice(0,8)} : {})}).catch(() => {});
      json(res, 200, {accepted:true});
    } catch (error) { json(res, error instanceof RingError ? error.status : 400, {error:'Malformed JSON or delivery'}); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = process.env.TOKEN_STORE_KEY ? new EncryptedTokenStore(new URL('./tokens.local.enc',import.meta.url).pathname,process.env.TOKEN_STORE_KEY) : undefined;
  const ring = new RingClient({accessToken:process.env.RING_ACCESS_TOKEN,refreshToken:process.env.RING_REFRESH_TOKEN,clientID:process.env.RING_CLIENT_ID,clientSecret:process.env.RING_CLIENT_SECRET,expectedAccount:process.env.RING_ACCOUNT_ID,store});
  const household = await Store.open(process.env.DATA_FILE || new URL('./data/household.local.json',import.meta.url).pathname);
  const log = message => console.log(message);
  const bedrock = bedrockClientFromEnv();
  const summarizer = new Summarizer({client:bedrock, model:process.env.BEDROCK_MODEL_ID || DEFAULT_MODEL, timeoutMs:Number(process.env.BEDROCK_TIMEOUT_MS) || 15000, log});
  const incidents = new IncidentService({store:household, summarizer, log});
  const scheduler = new AbsenceScheduler({store:household, ring:process.env.RING_ACCESS_TOKEN ? ring : null, log, onIncident:incident => incidents.refreshSummary(incident.id)});
  const server = createRelay({signingKey:process.env.RING_HMAC_KEY, clientToken:process.env.RELAY_CLIENT_TOKEN, expectedAccount:process.env.RING_ACCOUNT_ID,ring,
    store:household, incidents, scheduler, simulation:process.env.SIMULATION_ENABLED === '1'});
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, '127.0.0.1', () => {
    scheduler.start();
    console.log(`Ring Drive backend on http://127.0.0.1:${port}; Ring credentials stay on this backend. Absence rules: ${household.rules().length}. Summaries: ${bedrock ? `Bedrock ${summarizer.model}` : 'template only'}.`);
  });
}
