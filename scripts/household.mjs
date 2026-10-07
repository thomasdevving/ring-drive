// Manage household contacts and inspect escalations on the local backend without printing credentials.
// Usage:
//   node scripts/household.mjs contacts
//   node scripts/household.mjs add-contact NAME ROLE [CHANNEL] [PHONE] [PRIORITY]   (ROLE: household|monitored|emergency|neighbour)
//   node scripts/household.mjs delete-contact ID
//   node scripts/household.mjs driving CONTACT_ID yes|no                            (simulated presence, for demos)
//   node scripts/household.mjs inbox CONTACT_ID
//   node scripts/household.mjs ack NOTIFICATION_ID [CONTACT_ID]
//   node scripts/household.mjs notifications INCIDENT_ID
import {loadEnvFile} from 'node:process';

try { loadEnvFile(new URL('../Relay/.env.local', import.meta.url)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
const base = process.env.BACKEND_URL ?? `http://127.0.0.1:${process.env.PORT || 8787}`;
const token = process.env.RELAY_CLIENT_TOKEN;
if (!token) { console.error('RELAY_CLIENT_TOKEN missing. Run node scripts/setup_ring.mjs first.'); process.exit(2); }
const [command, ...args] = process.argv.slice(2);
export async function call(path, method = 'GET', body) {
  const response = await fetch(base + path, {method, headers:{Authorization:`Bearer ${token}`, 'Content-Type':'application/json'}, body:body && JSON.stringify(body)});
  const text = await response.text();
  if (!response.ok) { console.error(`HTTP ${response.status}: ${text}`); process.exit(1); }
  return text ? JSON.parse(text) : {};
}
const print = value => console.log(JSON.stringify(value, null, 2));
switch (command) {
  case 'contacts': print((await call('/contacts')).data.map(({id, name, role, channel, priority, drivingState}) => ({id, name, role, channel, priority, drivingState}))); break;
  case 'add-contact': {
    const [name, role, channel = 'app', phone, priority] = args;
    print((await call('/contacts', 'POST', {name, role, channel, ...(phone ? {phone} : {}), ...(priority ? {priority:Number(priority)} : {})})).data); break;
  }
  case 'delete-contact': await call(`/contacts/${args[0]}`, 'DELETE'); console.log('Deleted.'); break;
  case 'driving': print((await call(`/members/${args[0]}/status`, 'POST', {driving:args[1] === 'yes', source:'simulated'})).data.drivingState); break;
  case 'inbox': print((await call(`/members/${args[0]}/inbox`)).data); break;
  case 'ack': print((await call(`/notifications/${args[0]}/ack`, 'POST', args[1] ? {contactId:args[1]} : {})).data); break;
  case 'notifications': print((await call(`/incidents/${args[0]}/notifications`)).data); break;
  default: console.error('Usage: see the header of scripts/household.mjs'); process.exit(2);
}
