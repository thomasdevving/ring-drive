import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash, randomBytes} from 'node:crypto';
import {mkdtemp, rm, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StreamableHTTPClientTransport} from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import {createMcpHttpServer} from '../server.mjs';
import {OAuthServer} from '../oauth.mjs';

const CLIENT = {id:'alexa-plus', secret:'client-secret-0123456789abcdefghij', redirectUris:['https://alexa.example/callback']};
const OWNER = 'owner-password-123';
const fakeBackend = async path => path.startsWith('/incidents?') ? [] : {id:path.split('/')[2], type:'ABSENCE', createdAt:new Date().toISOString(), audit:[], summary:{text:'x'}};
const form = values => new URLSearchParams(values).toString();
const basic = (id, secret) => 'Basic ' + Buffer.from(`${encodeURIComponent(id)}:${encodeURIComponent(secret)}`).toString('base64');

async function setup(refreshStorePath = null) {
  const probe = createMcpHttpServer({call:fakeBackend, mcpToken:'unused-static-token-0123456789'});
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
  const issuer = `http://127.0.0.1:${port}`;
  const oauth = new OAuthServer({issuer, clients:[CLIENT], ownerPassword:OWNER, refreshStorePath}); await oauth.load();
  const server = createMcpHttpServer({call:fakeBackend, oauth});
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  const token = body => fetch(issuer + '/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded', Authorization:basic(CLIENT.id, CLIENT.secret)}, body:form(body)});
  return {issuer, oauth, token, close:() => new Promise(resolve => { server.closeAllConnections?.(); server.close(resolve); })};
}
async function connect(issuer, accessToken) {
  const client = new Client({name:'alexa-test', version:'1'});
  await client.connect(new StreamableHTTPClientTransport(new URL(issuer + '/mcp'), {requestInit:{headers:{Authorization:`Bearer ${accessToken}`}}}));
  return client;
}
async function authorize(issuer, verifier, {password = OWNER, decision = 'allow'} = {}) {
  const params = {client_id:CLIENT.id, redirect_uri:CLIENT.redirectUris[0], response_type:'code', scope:'mcp:tools', state:'xyz',
    code_challenge:createHash('sha256').update(verifier).digest('base64url'), code_challenge_method:'S256', resource:`${issuer}/mcp`};
  const page = await fetch(`${issuer}/authorize?${form(params)}`);
  assert.equal(page.status, 200); assert.match(await page.text(), /cannot view video/);
  return fetch(`${issuer}/authorize`, {method:'POST', redirect:'manual', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:form({...params, owner_password:password, decision})});
}

test('Publishes RFC 8414 and RFC 9728 metadata with S256 and client_credentials', async () => {
  const ctx = await setup();
  try {
    const as = await (await fetch(ctx.issuer + '/.well-known/oauth-authorization-server')).json();
    assert.equal(as.issuer, ctx.issuer); assert.equal(as.token_endpoint, `${ctx.issuer}/token`);
    assert.ok(as.grant_types_supported.includes('client_credentials')); assert.deepEqual(as.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(as.scopes_supported, ['mcp:service','mcp:tools']);
    const prm = await (await fetch(ctx.issuer + '/.well-known/oauth-protected-resource')).json();
    assert.equal(prm.resource, `${ctx.issuer}/mcp`); assert.deepEqual(prm.authorization_servers, [ctx.issuer]);
    const unauthorized = await fetch(ctx.issuer + '/mcp', {method:'POST', body:'{}'});
    assert.equal(unauthorized.status, 401);
    assert.equal(unauthorized.headers.get('www-authenticate'), `Bearer resource_metadata="${ctx.issuer}/.well-known/oauth-protected-resource"`);
  } finally { await ctx.close(); }
});

test('Tier 1 client_credentials: mcp:service only, no refresh token; it can list tools but not call them', async () => {
  const ctx = await setup();
  try {
    const issued = await (await ctx.token({grant_type:'client_credentials', scope:'mcp:service', resource:`${ctx.issuer}/mcp`})).json();
    assert.equal(issued.token_type, 'Bearer'); assert.equal(issued.scope, 'mcp:service'); assert.ok(issued.expires_in <= 3600); assert.equal(issued.refresh_token, undefined);
    const viaBody = await fetch(ctx.issuer + '/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'},
      body:form({grant_type:'client_credentials', client_id:CLIENT.id, client_secret:CLIENT.secret})});
    assert.equal(viaBody.status, 200, 'credentials in the POST body are accepted');
    const wrong = await fetch(ctx.issuer + '/token', {method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded', Authorization:basic(CLIENT.id, 'nope')}, body:form({grant_type:'client_credentials'})});
    assert.equal(wrong.status, 401); assert.equal((await wrong.json()).error, 'invalid_client'); assert.equal(wrong.headers.get('www-authenticate'), null);
    assert.equal((await fetch(`${ctx.issuer}/token?client_id=${CLIENT.id}&client_secret=${CLIENT.secret}`, {method:'POST', body:form({grant_type:'client_credentials'})})).status, 400);
    assert.equal((await (await ctx.token({grant_type:'client_credentials', scope:'mcp:tools'})).json()).error, 'invalid_scope');
    assert.equal((await (await ctx.token({grant_type:'client_credentials', resource:'https://other.example/mcp'})).json()).error, 'invalid_target');
    const client = await connect(ctx.issuer, issued.access_token);
    assert.equal((await client.listTools()).tools.length, 3);
    await assert.rejects(client.callTool({name:'get_recent_incidents', arguments:{}}), /403|insufficient_scope/);
    await client.close();
  } finally { await ctx.close(); }
});

test('Tier 2 authorization_code + PKCE after owner consent grants mcp:tools; codes are single-use; refresh rotates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'ring-drive-oauth-')), store = join(directory, 'refresh.json');
  const ctx = await setup(store);
  try {
    const verifier = randomBytes(32).toString('base64url');
    assert.equal((await authorize(ctx.issuer, verifier, {password:'wrong-password'})).status, 401);
    const denied = await authorize(ctx.issuer, verifier, {decision:'deny'});
    assert.equal(new URL(denied.headers.get('location')).searchParams.get('error'), 'access_denied');
    const allowed = await authorize(ctx.issuer, verifier);
    assert.equal(allowed.status, 302);
    const location = new URL(allowed.headers.get('location'));
    assert.equal(location.origin + location.pathname, CLIENT.redirectUris[0]); assert.equal(location.searchParams.get('state'), 'xyz');
    const code = location.searchParams.get('code');
    const exchange = verifierValue => ctx.token({grant_type:'authorization_code', code, redirect_uri:CLIENT.redirectUris[0], code_verifier:verifierValue, resource:`${ctx.issuer}/mcp`});
    assert.equal((await (await exchange('wrong-verifier')).json()).error, 'invalid_grant');
    // A failed attempt consumes the code, as with any single-use code.
    const second = new URL((await authorize(ctx.issuer, verifier)).headers.get('location')).searchParams.get('code');
    const tokens = await (await ctx.token({grant_type:'authorization_code', code:second, redirect_uri:CLIENT.redirectUris[0], code_verifier:verifier})).json();
    assert.equal(tokens.scope, 'mcp:tools'); assert.ok(tokens.refresh_token);
    assert.equal((await (await ctx.token({grant_type:'authorization_code', code:second, redirect_uri:CLIENT.redirectUris[0], code_verifier:verifier})).json()).error, 'invalid_grant');
    const client = await connect(ctx.issuer, tokens.access_token);
    const result = await client.callTool({name:'get_recent_incidents', arguments:{hours:24}});
    assert.match(result.content[0].text, /No incidents/);
    await client.close();
    const rotated = await (await ctx.token({grant_type:'refresh_token', refresh_token:tokens.refresh_token})).json();
    assert.ok(rotated.access_token && rotated.refresh_token !== tokens.refresh_token);
    assert.equal((await (await ctx.token({grant_type:'refresh_token', refresh_token:tokens.refresh_token})).json()).error, 'invalid_grant', 'old refresh token retired');
    assert.equal((await stat(store)).mode & 0o777, 0o600);
    await ctx.close();
    const restarted = await setup(store);
    try { assert.ok((await (await restarted.token({grant_type:'refresh_token', refresh_token:rotated.refresh_token})).json()).access_token, 'refresh survives a restart'); }
    finally { await restarted.close(); }
  } finally { await rm(directory, {recursive:true, force:true}); }
});

test('Consent page rejects unknown redirect URIs, plain PKCE and foreign scopes', async () => {
  const ctx = await setup();
  try {
    const base = {client_id:CLIENT.id, redirect_uri:CLIENT.redirectUris[0], response_type:'code', code_challenge:'a'.repeat(43), code_challenge_method:'S256'};
    for (const bad of [{redirect_uri:'https://evil.example/cb'}, {code_challenge_method:'plain'}, {scope:'admin'}, {client_id:'someone'}]) {
      assert.equal((await fetch(`${ctx.issuer}/authorize?${form({...base, ...bad})}`)).status, 400, JSON.stringify(bad));
    }
    assert.throws(() => new OAuthServer({issuer:ctx.issuer, clients:[CLIENT], ownerPassword:'short'}), /MCP_OWNER_PASSWORD/);
  } finally { await ctx.close(); }
});
