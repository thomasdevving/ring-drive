import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,createHash,webcrypto} from 'node:crypto';
import {decryptTokenBox} from '../../scripts/import_ring_token.mjs';

test('Browser WebCrypto envelope decrypts locally and rejects corrupted ciphertext and wrong key', async () => {
  const pair = generateKeyPairSync('rsa',{modulusLength:3072});
  const pem = pair.privateKey.export({type:'pkcs8',format:'pem'});
  const kid = createHash('sha256').update(pair.publicKey.export({type:'spki',format:'der'})).digest('hex').slice(0,24);
  const rsa = await webcrypto.subtle.importKey('jwk',pair.publicKey.export({format:'jwk'}),{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
  const aes = await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']); const iv = webcrypto.getRandomValues(new Uint8Array(12));
  const bytes = await webcrypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:Buffer.from(`ring-drive-token-v1:${kid}`),tagLength:128},aes,Buffer.from('fake-simulator-token-for-testing'));
  const key = await webcrypto.subtle.encrypt({name:'RSA-OAEP'},rsa,await webcrypto.subtle.exportKey('raw',aes));
  const envelope = {v:1,kid,key:Buffer.from(key).toString('base64'),iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(bytes).toString('base64')};
  const pack = e => 'RINGDRIVE-TOKEN-BOX:'+Buffer.from(JSON.stringify(e)).toString('base64');
  assert.equal(decryptTokenBox(pack(envelope),pem),'fake-simulator-token-for-testing');
  const corrupted = Buffer.from(bytes); corrupted[0] ^= 1;
  assert.throws(()=>decryptTokenBox(pack({...envelope,ciphertext:corrupted.toString('base64')}),pem));
  assert.throws(()=>decryptTokenBox(pack({...envelope,kid:'wrong-key'}),pem),/different local key/);
  assert.throws(()=>decryptTokenBox('ordinary plaintext token',pem),/Invalid encrypted/);
});
