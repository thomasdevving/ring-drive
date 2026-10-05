import {generateKeyPairSync,createPublicKey,createHash} from 'node:crypto';
import {mkdir,readFile,writeFile,chmod} from 'node:fs/promises';

const secrets = new URL('../Relay/.secrets/',import.meta.url); await mkdir(secrets,{recursive:true,mode:0o700});
const privatePath = new URL('token-inbox.local.pem',secrets);
let privateKey;
try { privateKey = await readFile(privatePath); }
catch (error) {
  if (error.code !== 'ENOENT') throw error;
  privateKey = generateKeyPairSync('rsa',{modulusLength:3072,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}}).privateKey;
  await writeFile(privatePath,privateKey,{mode:0o600,flag:'wx'});
}
await chmod(privatePath,0o600);
const publicKey = createPublicKey(privateKey), keyID = createHash('sha256').update(publicKey.export({type:'spki',format:'der'})).digest('hex').slice(0,24);
const jwk = publicKey.export({format:'jwk'});
const script = `
const publicKey = ${JSON.stringify(jwk)};
const keyID = ${JSON.stringify(keyID)};
const tokenInput = document.getElementById('token');
const output = document.getElementById('output');
const status = document.getElementById('status');
const encrypt = document.getElementById('encrypt');
function base64(bytes) { return btoa(Array.from(new Uint8Array(bytes),b=>String.fromCharCode(b)).join('')); }
encrypt.addEventListener('click',async()=>{
  encrypt.disabled = true; output.value = ''; document.getElementById('copy').disabled = true;
  try {
    if (!globalThis.crypto?.subtle) throw new Error('Open dit gedownloade bestand in een actuele browser, buiten de bestandsvoorvertoning.');
    const token = tokenInput.value.trim().replace(/^Bearer\\s+/i,'');
    if (!/^[A-Za-z0-9._~+/=-]{16,16000}$/.test(token)) throw new Error('Plak alleen de access-tokenwaarde; geen curl-commando of JSON-response.');
    const rsa = await crypto.subtle.importKey('jwk',publicKey,{name:'RSA-OAEP',hash:'SHA-256'},false,['encrypt']);
    const aes = await crypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('ring-drive-token-v1:'+keyID),tagLength:128},aes,new TextEncoder().encode(token));
    const wrapped = await crypto.subtle.encrypt({name:'RSA-OAEP'},rsa,await crypto.subtle.exportKey('raw',aes));
    const envelope = {v:1,kid:keyID,key:base64(wrapped),iv:base64(iv),ciphertext:base64(ciphertext)};
    output.value = 'RINGDRIVE-TOKEN-BOX:'+btoa(JSON.stringify(envelope));
    tokenInput.value = ''; document.getElementById('copy').disabled = false;
    status.textContent = 'Versleuteld. Kopieer de onderstaande tekst en stuur die terug in de Codex-chat.';
  } catch (error) { status.textContent = error.message; }
  finally { encrypt.disabled = false; }
});
document.getElementById('copy').addEventListener('click',async()=>{
  try { await navigator.clipboard.writeText(output.value); status.textContent = 'Versleutelde tekst gekopieerd. Stuur deze terug in de chat.'; }
  catch { output.focus(); output.select(); status.textContent = 'De versleutelde tekst is geselecteerd. Kopieer deze handmatig en stuur hem terug.'; }
});
`;
const style = `
:root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.5;color:light-dark(#17242c,#eaf3f7);background:light-dark(#f6f8f9,#111c24)}
body{margin:0}main{max-width:600px;padding:36px 24px 48px;margin:auto}h1{font-size:28px;line-height:1.2;margin:0 0 16px}p{margin:0 0 20px}label{display:block;font-weight:600;margin:28px 0 8px}input,textarea{box-sizing:border-box;width:100%;font:inherit;border:1px solid light-dark(#758792,#8ea5b3);border-radius:8px;background:light-dark(#fff,#172b38);color:inherit;padding:12px;min-height:48px}textarea{font-size:13px;min-height:145px;resize:vertical;overflow-wrap:anywhere}button{font:inherit;font-weight:600;min-height:48px;padding:12px 20px;border:0;border-radius:8px;background:#53bbfa;color:#061723;margin:16px 0;cursor:pointer}button:disabled{opacity:.5;cursor:default}#copy{background:light-dark(#dae7ee,#304c5d);color:inherit;margin-top:12px}input:focus-visible,textarea:focus-visible,button:focus-visible{outline:3px solid light-dark(#176da6,#b1ddff);outline-offset:3px}.note{font-size:14px;color:light-dark(#415b6b,#b5ccd9)}#status{min-height:48px;margin:8px 0 0}footer{font-size:12px;margin-top:28px;overflow-wrap:anywhere}
`;
const hash = text => createHash('sha256').update(text).digest('base64');
const html = `<!doctype html>
<html lang="nl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'sha256-${hash(script)}'; style-src 'sha256-${hash(style)}'; connect-src 'none'; form-action 'none'; base-uri 'none'">
<title>Ring Drive · versleutelde tokeninvoer</title><style>${style}</style></head><body><main>
<h1>Ring Drive verbinden</h1><p>Versleutel je simulator-access-token op dit apparaat. Deze pagina doet geen netwerkverzoeken en bewaart het token niet.</p>
<p class="note">Download dit bestand en open het in je browser. Alleen de lokale Ring Drive-werkmap met de bijbehorende privésleutel kan de tekst ontsleutelen. Sluit de pagina na gebruik.</p>
<label for="token">OAuth-access-token uit de Ring Simulator</label><input id="token" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Plak het token hier lokaal">
<button id="encrypt" type="button">Versleutel token</button><p id="status" role="status" aria-live="polite">Je token verschijnt niet in de versleutelde tekst hieronder.</p>
<label for="output">Versleutelde tekst voor de chat</label><textarea id="output" readonly spellcheck="false" placeholder="Begint met RINGDRIVE-TOKEN-BOX:"></textarea><button id="copy" type="button" disabled>Kopieer versleutelde tekst</button>
<p class="note">Stuur uitsluitend de tekst die begint met RINGDRIVE-TOKEN-BOX:. Deel je oorspronkelijke token niet.</p><footer>RSA-OAEP SHA-256 + AES-256-GCM · sleutel ${keyID}</footer>
</main><script>${script}</script></body></html>`;
await writeFile(new URL('../../Ring-token-invoer.html',import.meta.url),html);
console.log('Created outputs/Ring-token-invoer.html with public encryption key only. Private key remains local and ignored.');
