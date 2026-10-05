import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export function verifySignature(key, raw, received = '') {
  const hex = received.replace(/^sha256=/, '');
  if (!key || !/^[a-fA-F0-9]{64}$/.test(hex)) return false;
  return timingSafeEqual(createHmac('sha256', key).update(raw).digest(), Buffer.from(hex, 'hex'));
}
export function createRelay({ signingKey, clientToken, expectedAccount, now = () => Date.now() }) {
  if (!signingKey || !clientToken || !expectedAccount) throw new Error('Configure RING_HMAC_KEY, RELAY_CLIENT_TOKEN and RING_ACCOUNT_ID.');
  const queue = [], seen = new Map();
  function json(res, code, body) { res.writeHead(code, {'Content-Type':'application/json','Cache-Control':'no-store'}); res.end(JSON.stringify(body)); }
  function authorised(req) {
    const received = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${clientToken}`);
    return received.length === expected.length && timingSafeEqual(received, expected);
  }
  return http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') return json(res, 200, {status:'ready', mode:'signed-webhook-relay'});
    if (req.method === 'GET' && req.url === '/events') {
      if (!authorised(req)) return json(res, 401, {error:'Client token required'});
      // Retain bounded events; client deduplicates. An interrupted fetch cannot lose a delivery.
      return json(res, 200, {events:queue.filter(e => now() - e.data.attributes.timestamp <= 180000)});
    }
    if (req.method !== 'POST' || req.url !== '/webhooks/ring') return json(res, 404, {error:'Not found'});
    try {
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 65536) return json(res, 413, {error:'Payload too large'}); chunks.push(chunk); }
      const raw = Buffer.concat(chunks);
      if (!verifySignature(signingKey, raw, req.headers['x-signature'])) return json(res, 401, {error:'Invalid signature'});
      const event = JSON.parse(raw);
      if (event.meta?.account_id !== expectedAccount) return json(res, 403, {error:'Account mismatch'});
      if (!event.meta?.request_id || !event.data?.id) return json(res, 400, {error:'Missing identity'});
      // Acknowledge lifecycle events too, without forwarding tokens or unsupported resources.
      if (!['motion_detected','button_pressed'].includes(event.data.type)) return json(res, 200, {accepted:true, ignored:true});
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
      json(res, 200, {accepted:true});
    } catch { json(res, 400, {error:'Malformed JSON or delivery'}); }
  });
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const server = createRelay({signingKey:process.env.RING_HMAC_KEY, clientToken:process.env.RELAY_CLIENT_TOKEN, expectedAccount:process.env.RING_ACCOUNT_ID});
  const port = Number(process.env.PORT ?? 8787);
  server.listen(port, '127.0.0.1', () => console.log(`Ring Drive relay on http://127.0.0.1:${port}; expose only /webhooks/ring through an HTTPS tunnel.`));
}
