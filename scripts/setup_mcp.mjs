// Adds MCP server secrets to Relay/.env.local (static token, OAuth client secret, owner password) without printing them.
// Existing values are kept. Fill MCP_PUBLIC_URL and MCP_REDIRECT_URIS yourself when connecting Alexa+.
import {readFile, writeFile, chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

const target = new URL('../Relay/.env.local', import.meta.url);
let text;
try { text = await readFile(target, 'utf8'); } catch { console.error('Run node scripts/setup_ring.mjs first.'); process.exit(2); }
const generated = {MCP_TOKEN:randomBytes(32).toString('hex'), MCP_CLIENT_ID:'alexa-plus', MCP_CLIENT_SECRET:randomBytes(32).toString('hex'),
  MCP_OWNER_PASSWORD:randomBytes(12).toString('base64url'), MCP_PUBLIC_URL:'', MCP_REDIRECT_URIS:'', MCP_ALLOWED_HOSTS:''};
const added = [];
for (const [key, value] of Object.entries(generated)) {
  const line = new RegExp(`^${key}=(.*)$`, 'm').exec(text);
  if (line && line[1]) continue;
  text = line ? text.replace(line[0], `${key}=${value}`) : `${text.replace(/\n?$/, '\n')}${key}=${value}\n`;
  if (value) added.push(key);
}
await writeFile(target, text, {mode:0o600}); await chmod(target, 0o600);
console.log(added.length ? `Added ${added.join(', ')} to Relay/.env.local. No values displayed; open the file to read the owner password.` : 'MCP settings already present. Nothing changed.');
