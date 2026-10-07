import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createMcpHttpServer, backendClient} from '../server.mjs';
import {createRelay} from '../../Relay/server.mjs';
import {Store} from '../../Relay/store.mjs';
import {IncidentService} from '../../Relay/incidents.mjs';
import {Escalation} from '../../Relay/escalation.mjs';
import {validateContact} from '../../Relay/contacts.mjs';

const MCP_TOKEN = 'mcp-test-token-0123456789abcdef';
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = server => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); });

async function setup() {
  const store = new Store(null), escalation = new Escalation({store}), incidents = new IncidentService({store, escalation});
  const backend = createRelay({clientToken:'backend-key', store, incidents, escalation});
  const backendURL = await listen(backend);
  await store.createContact(validateContact({name:'Sanne', role:'monitored'}));
  // Same path as the scheduler: create, then absenceCreated() stores the summary and starts the ladder.
  const absence = await store.createIncident({type:'ABSENCE', status:'active', state:'DETECTED', simulated:true, ruleName:'School run (simulated)', expectedEventType:'motion.human',
    window:{start:'07:30', end:'08:15', timeZone:'Europe/Amsterdam'}, cameras:[{deviceId:'f', label:'front door'}], audit:[{at:new Date().toISOString(), state:'DETECTED', note:'Absence rule fired'}]});
  await incidents.absenceCreated(absence);
  const now = Date.now();
  await incidents.upsertIntrusion({id:'7b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d', priority:'urgent', simulated:true, timeZone:'Europe/Amsterdam', observations:[
    {id:'a', deviceId:'side', zone:'side', kind:'person', atMs:now - 100000, confidence:0.94, cameraName:'side camera'},
    {id:'b', deviceId:'back', zone:'rear', kind:'person', atMs:now - 86000, confidence:0.94, cameraName:'back door'},
    {id:'c', deviceId:'back', zone:'rear', kind:'person', atMs:now - 1000, confidence:0.94, cameraName:'back door'}]});
  await incidents.idle();
  const mcp = createMcpHttpServer({call:backendClient({backendURL, clientToken:'backend-key'}), mcpToken:MCP_TOKEN});
  const mcpURL = await listen(mcp);
  return {store, absence, backend, mcp, mcpURL, async teardown() { await close(mcp); await close(backend); }};
}
async function connect(mcpURL) {
  const transport = new StreamableHTTPClientTransport(new URL(mcpURL + '/mcp'), {requestInit:{headers:{Authorization:`Bearer ${MCP_TOKEN}`}}});
  const client = new Client({name:'ring-drive-test', version:'1.0.0'});
  await client.connect(transport);
  return {client, transport};
}

test('Negotiates MCP 2025-11-25 over Streamable HTTP and lists the three tools with honest annotations', async () => {
  const ctx = await setup();
  try {
    const {client, transport} = await connect(ctx.mcpURL);
    assert.equal(transport.protocolVersion, '2025-11-25');
    assert.equal(client.getServerVersion().name, 'ring-drive');
    const {tools} = await client.listTools();
    assert.deepEqual(tools.map(t => t.name).sort(), ['acknowledge_incident','get_incident_timeline','get_recent_incidents']);
    assert.equal(tools.find(t => t.name === 'get_recent_incidents').annotations.readOnlyHint, true);
    assert.equal(tools.find(t => t.name === 'acknowledge_incident').annotations.destructiveHint, false);
    await client.close();
  } finally { await ctx.teardown(); }
});

test('"What happened while I was away?" returns stored summaries without speculation', async () => {
  const ctx = await setup();
  try {
    const {client} = await connect(ctx.mcpURL);
    const result = await client.callTool({name:'get_recent_incidents', arguments:{hours:24}});
    const text = result.content[0].text;
    assert.match(text, /^2 incidents in the last 24 hours\./);
    assert.match(text, /Expected activity not seen \(simulated\)\. School run \(simulated\): No person was detected at the front door between 07:30 and 08:15\./);
    assert.match(text, /Camera activity needing attention \(simulated\)\. Person activity at the side camera/);
    assert.doesNotMatch(text, /burglar|intruder|suspicious|still at home|video/i);
    assert.equal(result.structuredContent.incidents.length, 2);
    await client.close();
  } finally { await ctx.teardown(); }
});

test('Timeline lists camera observations and escalation steps in order', async () => {
  const ctx = await setup();
  try {
    const {client} = await connect(ctx.mcpURL);
    const camera = await client.callTool({name:'get_incident_timeline', arguments:{incident_id:'7b1e2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d'}});
    const kinds = camera.structuredContent.timeline.filter(t => t.kind).map(t => t.camera);
    assert.deepEqual(kinds, ['side camera','back door','back door']);
    const absence = await client.callTool({name:'get_incident_timeline', arguments:{incident_id:ctx.absence.id}});
    assert.match(absence.content[0].text, /Escalation step 1: monitored person: Sanne/);
    const missing = await client.callTool({name:'get_incident_timeline', arguments:{incident_id:'00000000-0000-4000-8000-000000000000'}});
    assert.equal(missing.isError, true); assert.match(missing.content[0].text, /not found/);
    const invalid = await client.callTool({name:'get_incident_timeline', arguments:{incident_id:'../rules'}});
    assert.equal(invalid.isError, true);
    await client.close();
  } finally { await ctx.teardown(); }
});

test('Acknowledging at home stops escalation, is idempotent and leaves the driver state unchanged', async () => {
  const ctx = await setup();
  try {
    const {client} = await connect(ctx.mcpURL);
    const before = ctx.store.incident(ctx.absence.id).state;
    const result = await client.callTool({name:'acknowledge_incident', arguments:{incident_id:ctx.absence.id, note:'I checked the front door'}});
    assert.match(result.content[0].text, /^Acknowledged\./);
    const stored = ctx.store.incident(ctx.absence.id);
    assert.equal(stored.state, before); assert.equal(stored.escalation.status, 'acknowledged');
    assert.ok(stored.audit.some(e => e.source === 'alexa' && e.note === 'Acknowledged via Alexa (at home): I checked the front door'));
    await client.callTool({name:'acknowledge_incident', arguments:{incident_id:ctx.absence.id}});
    assert.equal(ctx.store.incident(ctx.absence.id).acknowledgedBy.filter(a => a.via === 'alexa').length, 1);
    await client.close();
  } finally { await ctx.teardown(); }
});

test('Rejects missing tokens, foreign hosts and non-POST requests; refuses weak tokens at startup', async () => {
  const ctx = await setup();
  try {
    assert.equal((await fetch(ctx.mcpURL + '/mcp', {method:'POST', body:'{}'})).status, 401);
    assert.equal((await fetch(ctx.mcpURL + '/mcp', {headers:{Authorization:`Bearer ${MCP_TOKEN}`}})).status, 405);
    assert.equal((await fetch(ctx.mcpURL + '/health')).status, 200);
    assert.throws(() => createMcpHttpServer({call:async () => {}, mcpToken:'short'}), /MCP_TOKEN/);
    const guarded = createMcpHttpServer({call:async () => [], mcpToken:MCP_TOKEN, allowedHosts:['127.0.0.1:1']});
    const guardedURL = new URL(await listen(guarded));
    const status = await new Promise((resolve, reject) => {
      const req = http.request({host:guardedURL.hostname, port:guardedURL.port, path:'/mcp', method:'POST',
        headers:{Host:'attacker.example', Authorization:`Bearer ${MCP_TOKEN}`, 'Content-Type':'application/json', Accept:'application/json, text/event-stream'}}, res => { res.resume(); resolve(res.statusCode); });
      req.on('error', reject);
      req.end(JSON.stringify({jsonrpc:'2.0', id:1, method:'initialize', params:{protocolVersion:'2025-11-25', capabilities:{}, clientInfo:{name:'x', version:'1'}}}));
    });
    assert.equal(status, 403, 'DNS rebinding protection rejects foreign Host headers');
    await close(guarded);
  } finally { await ctx.teardown(); }
});
