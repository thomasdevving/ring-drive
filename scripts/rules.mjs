// Manage absence rules on the local backend without printing credentials.
// Usage: node scripts/rules.mjs <list|add FILE|delete ID|evaluate ID [YYYY-MM-DD]|runs ID|incidents|simulate DEVICE_ID [EVENT_TYPE] [ISO_TIME]>
import {readFile} from 'node:fs/promises';
import {loadEnvFile} from 'node:process';

try { loadEnvFile(new URL('../Relay/.env.local', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const base = process.env.BACKEND_URL ?? `http://127.0.0.1:${process.env.PORT || 8787}`;
const token = process.env.RELAY_CLIENT_TOKEN;
if (!token) { console.error('RELAY_CLIENT_TOKEN missing. Run node scripts/setup_ring.mjs first.'); process.exit(2); }
const [command, ...args] = process.argv.slice(2);
async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, {method, headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body:body && JSON.stringify(body)});
  const text = await response.text();
  if (!response.ok) { console.error(`HTTP ${response.status}: ${text}`); process.exit(1); }
  return text ? JSON.parse(text) : {};
}
const print = value => console.log(JSON.stringify(value, null, 2));
switch (command) {
  case 'list': print((await call('/rules')).data); break;
  case 'add': print((await call('/rules', 'POST', JSON.parse(await readFile(args[0], 'utf8')))).data); break;
  case 'delete': await call(`/rules/${args[0]}`, 'DELETE'); console.log('Deleted.'); break;
  case 'evaluate': print(await call(`/rules/${args[0]}/evaluate`, 'POST', args[1] ? {date:args[1]} : {})); break;
  case 'runs': print((await call(`/rules/${args[0]}/runs`)).data); break;
  case 'incidents': print((await call('/incidents')).data); break;
  case 'simulate': print((await call('/simulate/observations', 'POST', {deviceId:args[0], eventType:args[1] ?? 'motion.human', ...(args[2] ? {startMs:Date.parse(args[2])} : {})})).data); break;
  default: console.error('Usage: node scripts/rules.mjs <list|add FILE|delete ID|evaluate ID [YYYY-MM-DD]|runs ID|incidents|simulate DEVICE_ID [EVENT_TYPE] [ISO_TIME]>'); process.exit(2);
}
