import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,stat,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {RingClient,EncryptedTokenStore,RING_ORIGIN,OAUTH_URL} from '../ring-client.mjs';
import {createRelay} from '../server.mjs';

const profile = {data:{id:'account',type:'users',attributes:{email:'private@example.com',first_name:'Private'}}};
const devices = {data:[{id:'camera',type:'devices',attributes:{name:'Rear camera',secret:'never-forward'}}]};
const json = (value,status=200) => new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const headers = {Authorization:'Bearer client-key'};
async function withBackend(fetchImpl, task, config={}) {
  const ring = new RingClient({accessToken:'ring-access-secret',fetchImpl,...config});
  const server = createRelay({clientToken:'client-key',ring});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try { await task(`http://127.0.0.1:${server.address().port}`,ring); }
  finally { await new Promise(resolve=>server.close(resolve)); }
}

test('Backend authenticates native calls, strips user PII and never exports Ring secrets or test proof', async () => {
  const calls = [];
  await withBackend(async (url,options) => {
    calls.push(url); assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer ring-access-secret');
    return json(url.endsWith('/users/me') ? profile : devices);
  },async base => {
    assert.equal((await fetch(base+'/ring/v1/devices')).status,401); assert.equal(calls.length,0);
    const user = await (await fetch(base+'/ring/v1/users/me',{headers})).json();
    assert.deepEqual(user,{data:{type:'users',id:'account',attributes:{}}});
    const discovery = await (await fetch(base+'/ring/v1/devices',{headers})).json();
    assert.equal(discovery.data[0].attributes.name,'Rear camera');
    assert.ok(!JSON.stringify(discovery).includes('never-forward'));
    const proof = await (await fetch(base+'/ring/proof',{headers})).json(); assert.equal(proof.verified,false); assert.equal(proof.calls.length,0);
    assert.equal((await fetch(base+'/ring/oauth/token',{method:'POST',headers})).status,404);
    assert.equal((await fetch(base+'/ring/v1/devices/camera/configuration',{headers})).status,404);
  });
  assert.deepEqual(calls,[RING_ORIGIN+'/v1/users/me',RING_ORIGIN+'/v1/devices']);
});

test('History uses only consented devices and fixed human/ding filter, rejects account mismatch', async () => {
  const calls = [];
  await withBackend(async url => { calls.push(url); return json(url.endsWith('/users/me') ? profile : url.endsWith('/devices') ? devices : {data:[{id:'event',attributes:{event_type:'motion.human',start:'1780000000000',private:'removed'}}]}); },async base => {
    assert.equal((await fetch(base+'/ring/v1/history/devices/unknown/events',{headers})).status,403);
    const result = await (await fetch(base+'/ring/v1/history/devices/camera/events?event_types=anything&page[key]=next',{headers})).json();
    assert.equal(result.data[0].attributes.event_type,'motion.human'); assert.ok(!JSON.stringify(result).includes('removed'));
  });
  const query = new URL(calls.at(-1)).searchParams; assert.equal(query.get('event_types'),'motion.human,ding'); assert.equal(query.get('page[key]'),'next');
  await withBackend(async()=>json(profile),async base => {
    const r = await fetch(base+'/ring/v1/users/me',{headers}); assert.equal(r.status,403);
  },{expectedAccount:'different-account'});
});

test('Media requires native parking marker, validates request, forwards MP4/416 and never relays caller fields', async () => {
  let mediaCalls = 0; let available = false;
  await withBackend(async (url,options) => {
    if (url.endsWith('/users/me')) return json(profile);
    if (url.endsWith('/devices')) return json(devices);
    mediaCalls++; const body = JSON.parse(options.body); assert.equal(body.duration,5000); assert.equal(body.injected_secret,undefined);
    assert.equal(options.headers['X-Ring-Drive-Parking'],undefined);
    return available ? new Response(new Uint8Array([1,2,3]),{status:206,headers:{'Content-Type':'video/mp4'}}) : json({error:'no recording'},416);
  },async base => {
    const url = base+'/ring/v1/devices/camera/media/video/download';
    const body = {timestamp:Date.now()-1000,duration:5000,video_options:{codec:'avc'},audio_options:{audio_enabled:false},injected_secret:'do-not-forward'};
    assert.equal((await fetch(url,{method:'POST',headers,body:JSON.stringify(body)})).status,423); assert.equal(mediaCalls,0);
    const parkedHeaders = {...headers,'X-Ring-Drive-Parking':'confirmed'};
    assert.equal((await fetch(url,{method:'POST',headers:parkedHeaders,body:JSON.stringify({...body,duration:999999})})).status,400); assert.equal(mediaCalls,0);
    assert.equal((await fetch(url,{method:'POST',headers:parkedHeaders,body:JSON.stringify(body)})).status,416);
    available = true;
    const response = await fetch(url,{method:'POST',headers:parkedHeaders,body:JSON.stringify(body)});
    assert.equal(response.status,206); assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array([1,2,3]));
  });
});

test('Missing token and expired simulator token produce actionable errors without echoing upstream secrets', async () => {
  await withBackend(async()=>{throw new Error('should not call');},async base => {
    assert.equal((await fetch(base+'/ring/v1/users/me',{headers})).status,503);
  },{accessToken:''});
  await withBackend(async()=>json({secret:'upstream-secret'},401),async base => {
    const response = await fetch(base+'/ring/v1/users/me',{headers}); assert.equal(response.status,424);
    const body = await response.text(); assert.ok(!body.includes('upstream-secret')); assert.ok(!body.includes('ring-access-secret'));
  });
});

test('Concurrent expired requests refresh once using backend credentials and verify account binding', async () => {
  let refreshes = 0; let saves = 0;
  const ring = new RingClient({accessToken:'old-access',refreshToken:'refresh-secret',clientID:'client-id',clientSecret:'client-secret',expectedAccount:'account',
    store:{load:async()=>null,save:async value=>{saves++;assert.equal(value.accessToken,'new-access');}},
    fetchImpl:async (url,options) => {
      if (url === OAUTH_URL) {
        refreshes++; const body = new URLSearchParams(options.body); assert.equal(body.get('grant_type'),'refresh_token');
        assert.equal(body.get('client_secret'),'client-secret'); assert.equal(body.get('refresh_token'),'refresh-secret');
        await new Promise(resolve=>setTimeout(resolve,10));
        return json({access_token:'new-access',refresh_token:'rotated-refresh',token_type:'Bearer',expires_in:14400});
      }
      if (options.headers.Authorization === 'Bearer old-access') return json({},401);
      return json(profile);
    }});
  await Promise.all([ring.profile(),ring.profile()]); assert.equal(refreshes,1); assert.equal(saves,1); assert.equal(ring.refreshToken,'rotated-refresh');
});

test('Refresh cannot change household or store mismatched tokens', async () => {
  const ring = new RingClient({accessToken:'old',refreshToken:'refresh',clientID:'id',clientSecret:'secret',expectedAccount:'different',
    store:{load:async()=>null,save:async()=>assert.fail('Must not persist wrong-account token')},
    fetchImpl:async url=>json(url===OAUTH_URL ? {access_token:'wrong',refresh_token:'wrong-refresh',token_type:'Bearer',expires_in:14400} : profile)});
  await assert.rejects(ring.refresh(),error=>error.status===403); assert.equal(ring.accessToken,'old');
});

test('Rotated credentials are encrypted, authenticated, private and invalidated by a replacement seed', async () => {
  const directory = await mkdtemp(join(tmpdir(),'ring-drive-token-test-')); const path = join(directory,'tokens.local.enc');
  try {
    const store = new EncryptedTokenStore(path,'a'.repeat(64)); const value = {accessToken:'private-access',refreshToken:'private-refresh',accountID:'account',expiresAt:1000};
    assert.equal(await store.load('seed'),null); await store.save(value,'seed');
    const bytes = await readFile(path); assert.ok(!bytes.includes(Buffer.from('private-access'))); assert.ok(!bytes.includes(Buffer.from('private-refresh')));
    assert.equal((await stat(path)).mode & 0o777,0o600); assert.equal((await store.load('seed')).accountID,'account');
    assert.equal(await store.load('replacement-seed'),null);
    bytes[30] ^= 1; await writeFile(path,bytes); await assert.rejects(store.load('seed'),/Cannot decrypt/);
  } finally { await rm(directory,{recursive:true,force:true}); }
});
