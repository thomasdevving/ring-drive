import {readFile, writeFile, chmod} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';

const target = new URL('../Relay/.env.local', import.meta.url);
try {
  await readFile(target);
  console.log('Existing private Ring configuration preserved. No values displayed.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  let template = await readFile(new URL('../Relay/.env.example', import.meta.url), 'utf8');
  template = template.replace('RELAY_CLIENT_TOKEN=\n', `RELAY_CLIENT_TOKEN=${randomBytes(32).toString('hex')}\n`)
    .replace('TOKEN_STORE_KEY=\n', `TOKEN_STORE_KEY=${randomBytes(32).toString('hex')}\n`);
  await writeFile(target, template, {mode: 0o600, flag: 'wx'});
  console.log('Created Relay/.env.local with private permissions. Fill RING_ACCESS_TOKEN locally. No credentials displayed.');
}
await chmod(target, 0o600);
