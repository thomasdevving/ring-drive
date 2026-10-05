import {writeFile} from 'node:fs/promises';
const token = process.env.RING_ACCESS_TOKEN;
if (!token) { console.error('Set RING_ACCESS_TOKEN locally using a fresh official Playground token. No token is printed.'); process.exit(2); }
const base = 'https://api.amazonvision.com';
const response = await fetch(base+'/v1/devices',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
if (!response.ok) { console.error(`Official Ring API returned ${response.status}; runtime proof not created.`); process.exit(1); }
const devices = await response.json();
const calls = [{method:'GET',endpoint:'/v1/devices',status:response.status,count:devices.data?.length ?? 0}];
for (const device of (devices.data ?? []).slice(0,3)) {
  const path = `/v1/history/devices/${encodeURIComponent(device.id)}/events?event_types=motion.human,ding`;
  const r = await fetch(base+path,{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
  calls.push({method:'GET',endpoint:'/v1/history/devices/[redacted]/events',status:r.status,count:r.ok?(await r.json()).data?.length ?? 0:0});
}
await writeFile('runtime-proof.local.json', JSON.stringify({origin:base,at:new Date().toISOString(),calls},null,2));
console.log('Successful official Ring discovery recorded in runtime-proof.local.json. No credentials or device identifiers included. Trigger and show an event in the app for the submission.');
