// Ring Drive MCP server for use at home ("Alexa, what happened while I was away?").
// Self-hosted, Streamable HTTP, MCP protocol 2025-11-25 (via @modelcontextprotocol/sdk). It reads the household
// backend over its authenticated HTTP API and is separate from the in-car flow: it never changes the driver's
// incident state and never exposes video.
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {loadEnvFile} from 'node:process';
import {pathToFileURL} from 'node:url';
import {McpServer} from '@modelcontextprotocol/sdk/server/mcp.js';
import {StreamableHTTPServerTransport} from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import {z} from 'zod';
import {OAuthServer, TOOLS_SCOPE} from './oauth.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATE_LABELS = {DETECTED:'detected', TRIAGED:'checked', NOTIFIED:'driver alerted', EXPLAINED:'explanation heard', HOUSEHOLD_NOTIFIED:'household notified',
  CONTACT_CALLED:'contact called', STOP_REQUESTED:'looking for a stop', NAVIGATING:'navigating to a stop', PARKED_CONFIRMED:'parked',
  VIDEO_UNLOCKED:'video reviewed after parking', DISMISSED:'dismissed'};

export function backendClient({backendURL, clientToken}) {
  return async function call(path, method = 'GET', body) {
    const response = await fetch(new URL(path, backendURL), {method, signal:AbortSignal.timeout(10000),
      headers:{Authorization:`Bearer ${clientToken}`, 'Content-Type':'application/json'}, body:body && JSON.stringify(body)});
    if (response.status === 404) throw new Error('That incident was not found.');
    if (!response.ok) throw new Error(`The Ring Drive backend returned HTTP ${response.status}.`);
    return (await response.json()).data;
  };
}

const clock = (iso, timeZone) => new Intl.DateTimeFormat('en-GB', {timeZone, weekday:'short', hour:'2-digit', minute:'2-digit', hourCycle:'h23'}).format(new Date(iso));
// Stored summaries are written for the driver; at home the sentence about the in-car video lock does not apply.
const homeSummary = text => (text ?? '').replace(/[^.]*\bvideo\b[^.]*\.\s*/gi, '').trim();
const kindLabel = i => i.type === 'ABSENCE' ? 'Expected activity not seen' : ({urgent:'Camera activity needing attention', review:'Camera activity', passive:'Home update'}[i.priority] ?? 'Camera activity');
function brief(incident, timeZone) {
  return {id:incident.id, type:incident.type, title:kindLabel(incident), at:incident.createdAt, when:clock(incident.createdAt, timeZone),
    summary:homeSummary(incident.summary?.text), summarySource:incident.summary?.source ?? 'template', status:incident.status, driverState:STATE_LABELS[incident.state] ?? incident.state,
    simulated:!!incident.simulated, acknowledgedBy:(incident.acknowledgedBy ?? []).map(a => a.name)};
}

/** One MCP server per request (stateless Streamable HTTP). */
export function buildMcpServer({call, timeZone, now = () => Date.now()}) {
  const server = new McpServer({name:'ring-drive', title:'Ring Drive', version:'0.1.0'},
    {instructions:'Ring Drive reports what home cameras observed and what the household did about it. Describe only observations; never guess identity or intent. Video is never available through this server.'});

  server.registerTool('get_recent_incidents', {
    title:'Get recent home incidents',
    description:'Lists Ring Drive incidents from the last hours with their stored spoken summary, what the driver chose and who acknowledged them. Use for "what happened while I was away?".',
    inputSchema:{hours:z.number().int().min(1).max(168).default(24).describe('Look-back window in hours'), limit:z.number().int().min(1).max(20).default(5)},
    annotations:{readOnlyHint:true, openWorldHint:false}
  }, async ({hours, limit}) => {
    const since = now() - hours * 3600000;
    const items = (await call(`/incidents?since=${since}`)).slice(0, limit).map(i => brief(i, timeZone));
    const text = items.length
      ? `${items.length} incident${items.length > 1 ? 's' : ''} in the last ${hours} hours. ` + items.map(i =>
        `${i.when}: ${i.title}${i.simulated ? ' (simulated)' : ''}. ${i.summary} Status: ${i.driverState}${i.acknowledgedBy.length ? `, acknowledged by ${i.acknowledgedBy.join(' and ')}` : ''}.`).join(' ')
      : `No incidents in the last ${hours} hours.`;
    return {content:[{type:'text', text}], structuredContent:{incidents:items}};
  });

  server.registerTool('get_incident_timeline', {
    title:'Get incident timeline',
    description:'Returns the chronological timeline of one incident: camera observations (per camera, with times and durations), household messages and acknowledgements, and the driver\'s choices.',
    inputSchema:{incident_id:z.string().regex(UUID).describe('Incident id from get_recent_incidents')},
    annotations:{readOnlyHint:true, openWorldHint:false}
  }, async ({incident_id}) => {
    const incident = await call(`/incidents/${incident_id}`);
    const observations = (incident.observations ?? []).map(o => ({at:new Date(o.atMs).toISOString(), camera:o.cameraName ?? `${o.zone} camera`, kind:o.kind}));
    const entries = (incident.audit ?? []).map(e => ({at:e.at, state:e.state, note:e.note, choice:e.choice ?? null, source:e.source ?? null}));
    const timeline = [...observations.map(o => ({...o, what:`${o.kind} observed at the ${o.camera}`})), ...entries.map(e => ({...e, what:e.note}))]
      .sort((a, b) => a.at.localeCompare(b.at));
    const text = `${kindLabel(incident)}${incident.simulated ? ' (simulated)' : ''}. ${homeSummary(incident.summary?.text)} Timeline: ` +
      timeline.map(t => `${clock(t.at, timeZone).split(' ').pop()} ${t.what}`).join('; ') + '.';
    return {content:[{type:'text', text}], structuredContent:{incident:brief(incident, timeZone), timeline}};
  });

  server.registerTool('acknowledge_incident', {
    title:'Acknowledge an incident',
    description:'Records that someone at home has seen this incident. Stops any household escalation that is still running. Does not change what the driver sees and never unlocks video.',
    inputSchema:{incident_id:z.string().regex(UUID), note:z.string().max(120).optional().describe('Optional short note, for example "I checked the back door"')},
    annotations:{readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:false}
  }, async ({incident_id, note}) => {
    const incident = await call(`/incidents/${incident_id}/acknowledge`, 'POST', {by:'alexa', ...(note ? {note} : {})});
    return {content:[{type:'text', text:`Acknowledged. ${kindLabel(incident)} from ${clock(incident.createdAt, timeZone)} is marked as seen at home.`}],
      structuredContent:{incident:brief(incident, timeZone)}};
  });
  return server;
}

const sameSecret = (received, expected) => {
  if (!expected) return false;
  const a = Buffer.from(received ?? ''), b = Buffer.from(`Bearer ${expected}`);
  return a.length === b.length && timingSafeEqual(a, b);
};
async function readBody(req, limit = 1048576) {
  const chunks = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length > limit) throw Object.assign(new Error('too large'), {status:413}); chunks.push(chunk); }
  return Buffer.concat(chunks).toString('utf8');
}
// Methods that read or act on household data need a user-consented token (mcp:tools).
const USER_METHODS = new Set(['tools/call', 'resources/read', 'prompts/get']);

/**
 * mcpToken: static bearer for local MCP clients (full access). oauth: OAuthServer for Alexa+ (Tier 1 + Tier 2).
 * At least one is required.
 */
export function createMcpHttpServer({call, mcpToken, oauth = null, timeZone = 'Europe/Amsterdam', allowedHosts, now}) {
  if (mcpToken !== undefined && mcpToken !== '' && mcpToken.length < 24) throw new Error('Set MCP_TOKEN to a random value of at least 24 characters.');
  if (!mcpToken && !oauth) throw new Error('Set MCP_TOKEN (at least 24 characters) or configure OAuth (MCP_CLIENT_ID, MCP_CLIENT_SECRET, MCP_OWNER_PASSWORD).');
  return http.createServer(async (req, res) => {
    const reply = (code, body, headers = {}) => { res.writeHead(code, {'Content-Type':'application/json', 'Cache-Control':'no-store', ...headers}); res.end(JSON.stringify(body)); };
    const html = (code, body) => { res.writeHead(code, {'Content-Type':'text/html; charset=utf-8', 'Cache-Control':'no-store', 'Content-Security-Policy':"default-src 'none'; style-src 'unsafe-inline'; form-action 'self'"}); res.end(body); };
    const url = new URL(req.url ?? '/', 'http://localhost'), path = url.pathname;
    try {
      if (req.method === 'GET' && path === '/health') return reply(200, {status:'ready', mode:'ring-drive-mcp'});
      if (oauth) {
        if (req.method === 'GET' && path === '/.well-known/oauth-authorization-server') return reply(200, oauth.authorizationServerMetadata());
        if (req.method === 'GET' && path.startsWith('/.well-known/oauth-protected-resource')) return reply(200, oauth.protectedResourceMetadata());
        if (req.method === 'POST' && path === '/token') {
          const result = await oauth.token(req.headers, new URLSearchParams(await readBody(req, 16384)), url.searchParams);
          return reply(result.status, result.body);
        }
        if (path === '/authorize' && req.method === 'GET') { const page = oauth.consentPage(url.searchParams); return html(page.status, page.html); }
        if (path === '/authorize' && req.method === 'POST') {
          const result = oauth.decide(new URLSearchParams(await readBody(req, 16384)));
          if (result.location) { res.writeHead(302, {Location:result.location, 'Cache-Control':'no-store'}); return res.end(); }
          return html(result.status, result.html);
        }
      }
      if (path !== '/mcp') return reply(404, {error:'Not found'});
      const bearer = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1];
      const scope = sameSecret(req.headers.authorization, mcpToken) ? TOOLS_SCOPE : oauth?.verify(bearer)?.scope;
      if (!scope) {
        const challenge = oauth ? {'WWW-Authenticate':`Bearer resource_metadata="${oauth.issuer}/.well-known/oauth-protected-resource"`} : {'WWW-Authenticate':'Bearer'};
        return reply(401, {jsonrpc:'2.0', error:{code:-32001, message:'Unauthorized'}, id:null}, challenge);
      }
      // Stateless: no sessions, no server-initiated streams. GET/DELETE are not offered.
      if (req.method !== 'POST') return reply(405, {jsonrpc:'2.0', error:{code:-32000, message:'Method not allowed'}, id:null});
      let message;
      try { message = JSON.parse(await readBody(req)); } catch (error) { return reply(error.status ?? 400, {jsonrpc:'2.0', error:{code:-32700, message:'Parse error'}, id:null}); }
      const methods = (Array.isArray(message) ? message : [message]).map(m => m?.method);
      if (scope !== TOOLS_SCOPE && methods.some(m => USER_METHODS.has(m))) {
        return reply(403, {jsonrpc:'2.0', error:{code:-32001, message:'insufficient_scope: link your account to use Ring Drive tools'}, id:message?.id ?? null},
          {'WWW-Authenticate':`Bearer error="insufficient_scope", scope="${TOOLS_SCOPE}"`});
      }
      const server = buildMcpServer({call, timeZone, now});
      const transport = new StreamableHTTPServerTransport({sessionIdGenerator:undefined, enableJsonResponse:true,
        ...(allowedHosts?.length ? {enableDnsRebindingProtection:true, allowedHosts} : {})});
      res.on('close', () => { transport.close(); server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, message);
    } catch {
      if (!res.headersSent) reply(500, {jsonrpc:'2.0', error:{code:-32603, message:'Internal error'}, id:null});
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { loadEnvFile(new URL('../Relay/.env.local', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const port = Number(process.env.MCP_PORT || 8790), host = process.env.MCP_HOST || '127.0.0.1';
  const backendURL = process.env.BACKEND_URL || `http://127.0.0.1:${process.env.PORT || 8787}`;
  const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, ...(process.env.MCP_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim()).filter(Boolean)];
  let oauth = null;
  if (process.env.MCP_CLIENT_ID) {
    // OAuth for Alexa+: the issuer is the public HTTPS URL that Alexa+ reaches (for example a tunnel).
    oauth = new OAuthServer({issuer:process.env.MCP_PUBLIC_URL || `http://${host}:${port}`, ownerPassword:process.env.MCP_OWNER_PASSWORD,
      clients:[{id:process.env.MCP_CLIENT_ID, secret:process.env.MCP_CLIENT_SECRET ?? '', redirectUris:(process.env.MCP_REDIRECT_URIS ?? '').split(',').map(u => u.trim()).filter(Boolean)}],
      refreshStorePath:new URL('./data/oauth-refresh.local.json', import.meta.url).pathname});
    if (!process.env.MCP_CLIENT_SECRET || process.env.MCP_CLIENT_SECRET.length < 24) throw new Error('Set MCP_CLIENT_SECRET to at least 24 random characters.');
    await oauth.load();
    if (process.env.MCP_PUBLIC_URL) allowedHosts.push(new URL(process.env.MCP_PUBLIC_URL).host);
  }
  const server = createMcpHttpServer({call:backendClient({backendURL, clientToken:process.env.RELAY_CLIENT_TOKEN}), mcpToken:process.env.MCP_TOKEN || undefined,
    oauth, timeZone:process.env.MCP_TIME_ZONE || 'Europe/Amsterdam', allowedHosts});
  server.listen(port, host, () => console.log(`Ring Drive MCP server (Streamable HTTP, protocol 2025-11-25) on http://${host}:${port}/mcp → backend ${backendURL}; OAuth ${oauth ? 'on' : 'off'}`));
}
