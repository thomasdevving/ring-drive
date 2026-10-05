import {createHash,createPublicKey,privateDecrypt,createDecipheriv,constants} from 'node:crypto';
import {readFile,writeFile,chmod} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';

export function decryptTokenBox(text, privateKey) {
  const value = text.trim();
  if (!value.startsWith('RINGDRIVE-TOKEN-BOX:') || value.length > 50000) throw new Error('Invalid encrypted token envelope.');
  const envelope = JSON.parse(Buffer.from(value.slice('RINGDRIVE-TOKEN-BOX:'.length),'base64').toString('utf8'));
  const publicDER = createPublicKey(privateKey).export({type:'spki',format:'der'});
  const keyID = createHash('sha256').update(publicDER).digest('hex').slice(0,24);
  if (envelope.v !== 1 || envelope.kid !== keyID) throw new Error('This envelope belongs to a different local key.');
  const key = privateDecrypt({key:privateKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(envelope.key,'base64'));
  const iv = Buffer.from(envelope.iv,'base64'), cipher = Buffer.from(envelope.ciphertext,'base64');
  if (key.length !== 32 || iv.length !== 12 || cipher.length < 17) throw new Error('Invalid encrypted token lengths.');
  const decipher = createDecipheriv('aes-256-gcm',key,iv);
  decipher.setAAD(Buffer.from(`ring-drive-token-v1:${keyID}`)); decipher.setAuthTag(cipher.subarray(-16));
  let clear;
  try { clear = Buffer.concat([decipher.update(cipher.subarray(0,-16)),decipher.final()]); }
  finally { key.fill(0); }
  const token = clear.toString('utf8').trim().replace(/^Bearer\s+/i,''); clear.fill(0);
  if (!/^[A-Za-z0-9._~+/=-]{16,16000}$/.test(token)) throw new Error('Invalid access-token format.');
  return token;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const inbox = new URL('../Relay/.secrets/',import.meta.url);
    const privateKey = await readFile(new URL('token-inbox.local.pem',inbox));
    const envelope = await readFile(process.argv[2] || new URL('incoming.local.txt',inbox),'utf8');
    const token = decryptTokenBox(envelope,privateKey);
    const config = new URL('../Relay/.env.local',import.meta.url);
    const existing = await readFile(config,'utf8');
    if (!/^RING_ACCESS_TOKEN=.*$/m.test(existing)) throw new Error('Create the local configuration first.');
    await writeFile(config,existing.replace(/^RING_ACCESS_TOKEN=.*$/m,`RING_ACCESS_TOKEN=${token}`),{mode:0o600});
    await chmod(config,0o600);
    console.log('Encrypted simulator token imported into private local configuration. No credential values displayed.');
  } catch { console.error('Token import failed. Check the envelope and its matching local key. No decrypted data displayed.'); process.exitCode = 1; }
}
