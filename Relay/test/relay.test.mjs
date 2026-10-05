import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createRelay, verifySignature} from '../server.mjs';

test('Signature checks original bytes; modified JSON is rejected', () => {
  const raw = Buffer.from('{"a": 1}'); const signature = 'sha256=' + createHmac('sha256','test-key').update(raw).digest('hex');
  assert.equal(verifySignature('test-key', raw, signature), true);
  assert.equal(verifySignature('test-key', Buffer.from('{"a":1}'), signature), false);
  assert.equal(verifySignature('test-key', raw, ''), false);
});
test('Signed events, duplicate retries, stale data, account isolation and client auth', async () => {
  const now = Date.now(); const server = createRelay({signingKey:'test-key',clientToken:'client-key',expectedAccount:'home',now:()=>now});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const e = {meta:{request_id:'req',account_id:'home'},data:{id:'event',type:'motion_detected',attributes:{source:'camera',timestamp:now,sub_type:'human'}}};
    async function send(event, signed=true) {
      const raw = JSON.stringify(event); const sig = 'sha256=' + createHmac('sha256','test-key').update(raw).digest('hex');
      return fetch(base+'/webhooks/ring',{method:'POST',body:raw,headers:{'X-Signature':signed?sig:'invalid'}});
    }
    assert.equal((await send(e,false)).status,401);
    assert.equal((await send(e)).status,200);
    assert.equal((await (await send(e)).json()).duplicate,true);
    const wrong = structuredClone(e); wrong.meta.account_id='other'; assert.equal((await send(wrong)).status,403);
    const stale = structuredClone(e); stale.data.id='old'; stale.data.attributes.timestamp-=181000; assert.equal((await (await send(stale)).json()).stale,true);
    assert.equal((await fetch(base+'/events')).status,401);
    const get = await fetch(base+'/events',{headers:{Authorization:'Bearer client-key'}});
    const body = await get.json(); assert.equal(body.events.length,1); assert.equal(body.events[0].data.attributes.source,'camera');
    const retry = await fetch(base+'/events',{headers:{Authorization:'Bearer client-key'}}); assert.equal((await retry.json()).events.length,1);
  } finally { await new Promise(resolve=>server.close(resolve)); }
});
