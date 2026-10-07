// Minimal single-household OAuth 2.1 authorization server for the Alexa+ MCP add-on.
//   Tier 1  client_credentials → scope mcp:service: initialize, tools/list, health checks. No household data.
//   Tier 2  authorization_code + PKCE (S256) → scope mcp:tools: tool calls with household data, after the owner consents.
// Metadata: RFC 8414 (/.well-known/oauth-authorization-server) and RFC 9728 (/.well-known/oauth-protected-resource).
import {createHash, randomBytes, timingSafeEqual} from 'node:crypto';
import {readFile, writeFile, rename, mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';

export const SERVICE_SCOPE = 'mcp:service', TOOLS_SCOPE = 'mcp:tools';
const ACCESS_TTL_S = 3600, CODE_TTL_MS = 5 * 60000, REFRESH_TTL_MS = 180 * 86400000;
const random = () => randomBytes(32).toString('base64url');
const sha256 = value => createHash('sha256').update(value).digest('base64url');
const same = (a = '', b = '') => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export class OAuthServer {
  /**
   * issuer: public HTTPS base URL (e.g. the tunnel URL); resource: canonical MCP URL (issuer + /mcp).
   * clients: [{id, secret, redirectUris}]; ownerPassword guards the consent page; refreshStorePath persists hashed refresh tokens.
   */
  constructor({issuer, clients, ownerPassword, refreshStorePath = null, now = () => Date.now()}) {
    if (!ownerPassword || ownerPassword.length < 12) throw new Error('Set MCP_OWNER_PASSWORD (at least 12 characters) to protect the consent page.');
    Object.assign(this, {issuer:issuer.replace(/\/$/, ''), clients, ownerPassword, refreshStorePath, now});
    this.resource = `${this.issuer}/mcp`;
    this.access = new Map(); this.codes = new Map(); this.refresh = new Map();
  }
  async load() {
    if (!this.refreshStorePath) return;
    try { for (const [hash, value] of Object.entries(JSON.parse(await readFile(this.refreshStorePath, 'utf8')))) this.refresh.set(hash, value); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  async #persist() {
    if (!this.refreshStorePath) return;
    await mkdir(dirname(this.refreshStorePath), {recursive:true});
    await writeFile(this.refreshStorePath + '.tmp', JSON.stringify(Object.fromEntries(this.refresh)), {mode:0o600});
    await rename(this.refreshStorePath + '.tmp', this.refreshStorePath);
  }

  authorizationServerMetadata() {
    return {issuer:this.issuer, authorization_endpoint:`${this.issuer}/authorize`, token_endpoint:`${this.issuer}/token`,
      response_types_supported:['code'], grant_types_supported:['client_credentials','authorization_code','refresh_token'],
      code_challenge_methods_supported:['S256'], scopes_supported:[SERVICE_SCOPE, TOOLS_SCOPE],
      token_endpoint_auth_methods_supported:['client_secret_basic','client_secret_post']};
  }
  protectedResourceMetadata() {
    return {resource:this.resource, authorization_servers:[this.issuer], scopes_supported:[SERVICE_SCOPE, TOOLS_SCOPE], bearer_methods_supported:['header']};
  }

  #client(id, secret) { const c = this.clients.find(c => c.id === id); return c && same(secret, c.secret) ? c : null; }
  #issue(clientId, scope) {
    const token = random();
    this.access.set(sha256(token), {clientId, scope, expiresAt:this.now() + ACCESS_TTL_S * 1000});
    return {access_token:token, token_type:'Bearer', expires_in:ACCESS_TTL_S, scope};
  }
  /** Resolves a bearer token to its grant, or null. */
  verify(token) {
    const grant = token && this.access.get(sha256(token));
    if (!grant || grant.expiresAt <= this.now()) return null;
    return grant;
  }

  /** POST /token. Returns {status, body}. Client credentials via HTTP Basic or the form body; never the query string. */
  async token(headers, form, query) {
    if (query.has('client_secret') || query.has('client_id')) return {status:400, body:{error:'invalid_request', error_description:'Credentials are not accepted in the query string.'}};
    let id = form.get('client_id'), secret = form.get('client_secret');
    const basic = /^Basic (.+)$/i.exec(headers.authorization ?? '');
    if (basic) [id, secret] = Buffer.from(basic[1], 'base64').toString().split(/:(.*)/s).map(decodeURIComponent);
    const client = this.#client(id, secret);
    if (!client) return {status:401, body:{error:'invalid_client'}};
    const resource = form.get('resource');
    if (resource && resource.replace(/\/$/, '') !== this.resource) return {status:400, body:{error:'invalid_target'}};
    switch (form.get('grant_type')) {
      case 'client_credentials': {
        const requested = (form.get('scope') ?? SERVICE_SCOPE).split(' ').filter(Boolean);
        if (requested.some(s => s !== SERVICE_SCOPE)) return {status:400, body:{error:'invalid_scope', error_description:'client_credentials grants only mcp:service.'}};
        return {status:200, body:this.#issue(client.id, SERVICE_SCOPE)};
      }
      case 'authorization_code': {
        const code = this.codes.get(form.get('code') ?? ''); this.codes.delete(form.get('code') ?? '');
        if (!code || code.clientId !== client.id || code.expiresAt <= this.now() || code.redirectUri !== form.get('redirect_uri')
          || sha256(form.get('code_verifier') ?? '') !== code.challenge) return {status:400, body:{error:'invalid_grant'}};
        const refreshToken = random();
        this.refresh.set(sha256(refreshToken), {clientId:client.id, scope:code.scope, expiresAt:this.now() + REFRESH_TTL_MS}); await this.#persist();
        return {status:200, body:{...this.#issue(client.id, code.scope), refresh_token:refreshToken}};
      }
      case 'refresh_token': {
        const hash = sha256(form.get('refresh_token') ?? ''), grant = this.refresh.get(hash);
        if (!grant || grant.clientId !== client.id || grant.expiresAt <= this.now()) return {status:400, body:{error:'invalid_grant'}};
        // Rotation: the old refresh token is retired.
        this.refresh.delete(hash); const next = random();
        this.refresh.set(sha256(next), {...grant, expiresAt:this.now() + REFRESH_TTL_MS}); await this.#persist();
        return {status:200, body:{...this.#issue(client.id, grant.scope), refresh_token:next}};
      }
      default: return {status:400, body:{error:'unsupported_grant_type'}};
    }
  }

  #authorizeParams(params) {
    const client = this.clients.find(c => c.id === params.get('client_id'));
    const redirectUri = params.get('redirect_uri');
    if (!client || !client.redirectUris.includes(redirectUri)) return {error:'Unknown client or redirect URI.'};
    if (params.get('response_type') !== 'code') return {error:'response_type must be code.'};
    if (params.get('code_challenge_method') !== 'S256' || !/^[A-Za-z0-9_-]{43,128}$/.test(params.get('code_challenge') ?? '')) return {error:'PKCE with S256 is required.'};
    const scope = (params.get('scope') ?? TOOLS_SCOPE).split(' ').filter(Boolean);
    if (scope.some(s => s !== TOOLS_SCOPE)) return {error:'Only the mcp:tools scope can be granted here.'};
    const resource = params.get('resource');
    if (resource && resource.replace(/\/$/, '') !== this.resource) return {error:'Unknown resource.'};
    return {client, redirectUri, scope:TOOLS_SCOPE, challenge:params.get('code_challenge'), state:params.get('state')};
  }
  /** GET /authorize: owner consent page. */
  consentPage(params) {
    const checked = this.#authorizeParams(params);
    if (checked.error) return {status:400, html:`<p>${escapeHtml(checked.error)}</p>`};
    const hidden = [...params].map(([k, v]) => `<input type="hidden" name="${escapeHtml(k)}" value="${escapeHtml(v)}">`).join('');
    return {status:200, html:`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ring Drive · allow access</title>
<main style="font-family:system-ui;max-width:28rem;margin:2rem auto;padding:0 1rem;line-height:1.5"><h1>Allow ${escapeHtml(checked.client.id)} to read Ring Drive?</h1>
<p>It can list recent home incidents, read their timelines and mark them as seen. It cannot view video or change what the driver sees.</p>
<form method="post" action="/authorize">${hidden}<label>Household owner password<br><input type="password" name="owner_password" autocomplete="current-password" required style="width:100%;font:inherit;padding:.5rem"></label>
<p><button type="submit" name="decision" value="allow" style="font:inherit;padding:.5rem 1rem">Allow</button> <button type="submit" name="decision" value="deny" style="font:inherit;padding:.5rem 1rem">Deny</button></p></form></main>`};
  }
  /** POST /authorize: returns a redirect location or an error page. */
  decide(form) {
    const checked = this.#authorizeParams(form);
    if (checked.error) return {status:400, html:`<p>${escapeHtml(checked.error)}</p>`};
    const target = new URL(checked.redirectUri);
    if (checked.state) target.searchParams.set('state', checked.state);
    if (form.get('decision') !== 'allow') { target.searchParams.set('error', 'access_denied'); return {status:302, location:target.href}; }
    if (!same(form.get('owner_password') ?? '', this.ownerPassword)) return {status:401, html:'<p>Wrong household owner password.</p>'};
    const code = random();
    this.codes.set(code, {clientId:checked.client.id, redirectUri:checked.redirectUri, challenge:checked.challenge, scope:checked.scope, expiresAt:this.now() + CODE_TTL_MS});
    target.searchParams.set('code', code);
    return {status:302, location:target.href};
  }
}
