import {writeFile} from 'node:fs/promises';
import {loadEnvFile} from 'node:process';
import {RingClient,RingError,EncryptedTokenStore,RING_ORIGIN} from '../Relay/ring-client.mjs';

try { loadEnvFile(new URL('../Relay/.env.local',import.meta.url)); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!process.env.RING_ACCESS_TOKEN?.trim()) {
  console.error('Fill RING_ACCESS_TOKEN in Relay/.env.local. No credential values are displayed.'); process.exit(2);
}
const store = process.env.TOKEN_STORE_KEY ? new EncryptedTokenStore(new URL('../Relay/tokens.local.enc',import.meta.url).pathname,process.env.TOKEN_STORE_KEY) : undefined;
const ring = new RingClient({accessToken:process.env.RING_ACCESS_TOKEN,refreshToken:process.env.RING_REFRESH_TOKEN,
  clientID:process.env.RING_CLIENT_ID,clientSecret:process.env.RING_CLIENT_SECRET,expectedAccount:process.env.RING_ACCOUNT_ID,store});
const calls = []; let historyFailed = false;
try {
  await ring.profile(); calls.push({method:'GET',endpoint:'/v1/users/me',status:200,count:1});
  const devices = await ring.devices(); calls.push({method:'GET',endpoint:'/v1/devices',status:200,count:devices.data.length});
  for (const device of devices.data.slice(0,3)) {
    try {
      const history = await ring.history(device.id);
      calls.push({method:'GET',endpoint:'/v1/history/devices/[redacted]/events',status:200,count:history.data.length});
    } catch (error) {
      historyFailed = true;
      calls.push({method:'GET',endpoint:'/v1/history/devices/[redacted]/events',status:error instanceof RingError ? error.status : 502,count:0});
    }
  }
  await writeFile(new URL('../runtime-proof.local.json',import.meta.url),JSON.stringify({origin:RING_ORIGIN,at:new Date().toISOString(),
    calls,discoveryVerified:true,historyVerified:!historyFailed && devices.data.length>0,eventToDriverDemoVerified:false},null,2),{mode:0o600});
  console.log(`Official Ring runtime: user identity and ${devices.data.length} devices verified. History ${historyFailed?'needs attention':'checked'}. Redacted receipt saved; no identifiers or credentials printed.`);
  if (historyFailed) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof RingError ? error.message : 'Official Ring request failed. Check network access and local configuration. No upstream payload or credentials displayed.');
  process.exitCode = 1;
}
