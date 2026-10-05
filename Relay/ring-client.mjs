import {createHash, createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';
import {readFile, writeFile, rename} from 'node:fs/promises';

export const RING_ORIGIN = 'https://api.amazonvision.com';
export const OAUTH_URL = 'https://oauth.ring.com/oauth/token';
export class RingError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const fingerprint = value => createHash('sha256').update(value).digest('hex');

// Single-account local demo storage. A replacement .env token invalidates old rotations.
export class EncryptedTokenStore {
  constructor(path, key) {
    if (!/^[a-f0-9]{64}$/i.test(key ?? '')) throw new Error('TOKEN_STORE_KEY must be a generated 32-byte hex key.');
    this.path = path; this.key = Buffer.from(key, 'hex');
  }
  async load(seed) {
    try {
      const bytes = await readFile(this.path);
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
      decipher.setAuthTag(bytes.subarray(12, 28));
      const value = JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]));
      return value.seed === fingerprint(seed) ? value : null;
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw new Error('Cannot decrypt local Ring token storage. Restore its key or remove only the local encrypted token file.');
    }
  }
  async save(value, seed) {
    const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify({...value, seed: fingerprint(seed)})), cipher.final()]);
    await writeFile(this.path + '.tmp', Buffer.concat([iv, cipher.getAuthTag(), ciphertext]), {mode: 0o600});
    await rename(this.path + '.tmp', this.path);
  }
}

export class RingClient {
  constructor({accessToken = '', refreshToken = '', clientID = '', clientSecret = '', expectedAccount = '', store, fetchImpl = fetch, now = () => Date.now()}) {
    this.seed = accessToken.trim(); this.accessToken = this.seed; this.refreshToken = refreshToken.trim();
    this.clientID = clientID; this.clientSecret = clientSecret; this.expectedAccount = expectedAccount;
    this.store = store; this.fetch = fetchImpl; this.now = now; this.accountID = null; this.deviceIDs = new Set();
    this.refreshing = null; this.initializing = null; this.expiresAt = null; this.devicesAt = null;
  }
  async initialize() {
    this.initializing ??= (async () => {
      if (!this.seed) throw new RingError(503, 'Set RING_ACCESS_TOKEN in Relay/.env.local, then restart the backend.');
      const saved = await this.store?.load(this.seed);
      if (saved) {
        this.accessToken = saved.accessToken; this.refreshToken = saved.refreshToken;
        this.expiresAt = saved.expiresAt; this.expectedAccount ||= saved.accountID;
      }
    })();
    return this.initializing;
  }
  async refresh() {
    if (!this.refreshToken || !this.clientID || !this.clientSecret) throw new RingError(424, 'Ring token expired. Replace RING_ACCESS_TOKEN locally and restart the backend.');
    if (this.refreshing) return this.refreshing;
    this.refreshing = (async () => {
      const response = await this.fetch(OAUTH_URL, {method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
        headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({grant_type:'refresh_token',refresh_token:this.refreshToken,client_id:this.clientID,client_secret:this.clientSecret}).toString()});
      if (!response.ok) throw new RingError(424, 'Ring refresh failed. Check the local app credentials or replace the simulator token.');
      const body = await response.json();
      if (typeof body.access_token !== 'string' || !body.access_token || body.token_type?.toLowerCase() !== 'bearer' || !Number.isFinite(body.expires_in) || body.expires_in <= 0) throw new RingError(502, 'Invalid Ring OAuth response.');
      // Bind rotated credentials to the same account before saving or using them.
      const profileResponse = await this.fetch(RING_ORIGIN + '/v1/users/me', {redirect:'error',signal:AbortSignal.timeout(15000),headers:{Authorization:`Bearer ${body.access_token}`}});
      if (!profileResponse.ok) throw new RingError(424, 'Cannot verify the refreshed Ring account.');
      const profile = await profileResponse.json(); const account = profile.data?.id;
      if (typeof account !== 'string' || profile.data?.type !== 'users') throw new RingError(502, 'Invalid Ring user identity.');
      if ((this.accountID && account !== this.accountID) || (this.expectedAccount && account !== this.expectedAccount)) throw new RingError(403, 'Ring account mismatch. Relink explicitly.');
      const update = {accessToken:body.access_token,refreshToken:body.refresh_token || this.refreshToken,expiresAt:this.now() + body.expires_in * 1000,accountID:account};
      await this.store?.save(update, this.seed);
      Object.assign(this, update); this.deviceIDs.clear(); this.devicesAt = null;
    })();
    try { await this.refreshing; } finally { this.refreshing = null; }
  }
  async request(path, options = {}, retry = true) {
    await this.initialize();
    if (retry && this.expiresAt && this.expiresAt - this.now() < 30000) await this.refresh();
    const tokenUsed = this.accessToken;
    const response = await this.fetch(RING_ORIGIN + path, {...options,redirect:'error',signal:AbortSignal.timeout(15000),headers:{...options.headers,Authorization:`Bearer ${tokenUsed}`}});
    if (response.status === 401 || (path === '/v1/users/me' && response.status === 403)) {
      if (!retry) throw new RingError(424, 'Ring rejected the backend token. Replace it locally.');
      if (tokenUsed === this.accessToken) await this.refresh();
      return this.request(path, options, false);
    }
    if (!response.ok) throw new RingError(response.status, `Ring API returned HTTP ${response.status}.`);
    return response;
  }
  async profile() {
    const profile = await (await this.request('/v1/users/me')).json();
    const id = profile.data?.id;
    if (typeof id !== 'string' || !id || profile.data?.type !== 'users') throw new RingError(502, 'Invalid Ring user identity.');
    if ((this.expectedAccount && id !== this.expectedAccount) || (this.accountID && id !== this.accountID)) throw new RingError(403, 'Ring account mismatch. Relink explicitly.');
    this.accountID = id;
    // Do not forward name, email, phone number or tokens to the native client.
    return {data:{type:'users',id,attributes:{}}};
  }
  async devices() {
    if (!this.accountID) await this.profile();
    const body = await (await this.request('/v1/devices')).json();
    if (!Array.isArray(body.data) || body.data.some(d => typeof d.id !== 'string')) throw new RingError(502, 'Invalid Ring device list.');
    this.deviceIDs = new Set(body.data.map(d => d.id)); this.devicesAt = this.now();
    return {data:body.data.map(d => ({id:d.id,type:d.type,attributes:{name:d.attributes?.name,description:d.attributes?.description}}))};
  }
  async requireDevice(id) {
    if (this.devicesAt === null || this.now() - this.devicesAt > 60000) await this.devices();
    if (!this.deviceIDs.has(id)) throw new RingError(403, 'Device is not in the consented Ring device list.');
  }
  async history(id, cursor) {
    await this.requireDevice(id);
    const query = new URLSearchParams({event_types:'motion.human,ding'});
    if (cursor) { if (cursor.length > 512) throw new RingError(400, 'Invalid event cursor.'); query.set('page[key]',cursor); }
    const body = await (await this.request(`/v1/history/devices/${encodeURIComponent(id)}/events?${query}`)).json();
    if (!Array.isArray(body.data)) throw new RingError(502, 'Invalid Ring event history.');
    return {data:body.data.map(e => ({id:e.id,type:e.type,attributes:{event_type:e.attributes?.event_type,start:e.attributes?.start,end:e.attributes?.end}}))};
  }
  async clip(id, body) {
    await this.requireDevice(id);
    if (!Number.isSafeInteger(body.timestamp) || body.timestamp <= 0 || body.timestamp > this.now() + 5000 || body.duration !== 5000 || body.video_options?.codec !== 'avc' || body.audio_options?.audio_enabled !== false) throw new RingError(400, 'Invalid recorded-video request.');
    const clean = {timestamp:body.timestamp,duration:5000,video_options:{codec:'avc'},audio_options:{audio_enabled:false}};
    if (body.components !== undefined) {
      if (!Array.isArray(body.components) || !body.components.length || body.components.length > 8 || body.components.some(c => typeof c.component_id !== 'string' || !c.component_id || c.component_id.length > 128)) throw new RingError(400, 'Invalid camera component selection.');
      clean.components = body.components.map(c => ({component_id:c.component_id}));
    }
    const response = await this.request(`/v1/devices/${encodeURIComponent(id)}/media/video/download`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(clean)});
    if (!/^video\/mp4(?:;|$)/i.test(response.headers.get('content-type') ?? '')) throw new RingError(502, 'Ring did not return MP4 video.');
    const chunks = []; let length = 0;
    for await (const chunk of response.body) { length += chunk.length; if (length > 20000000) throw new RingError(502, 'Ring recording exceeded the demo download limit.'); chunks.push(Buffer.from(chunk)); }
    return {status:response.status,bytes:Buffer.concat(chunks)};
  }
}
