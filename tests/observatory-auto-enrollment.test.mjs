import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const code=readFileSync(new URL('../src/observatory-completion.js',import.meta.url),'utf8');
const chat='abcdefgh-01234567',sid='rs_'+'a'.repeat(32);
const initial='https://chatgpt.com/c/'+chat;
function harness(storage=new Map(),notices=[]){
  const requests=[],context={
    location:{href:initial},URL,
    GM_getValue:(key,defaultValue)=>storage.has(key)?storage.get(key):defaultValue,
    GM_setValue:(key,value)=>storage.set(key,value),
    GM_deleteValue:key=>storage.delete(key),
    GM_xmlhttpRequest:args=>requests.push(args),
    crypto:{getRandomValues:array=>{array.fill(0x31);return array}},
    Uint8Array,Date,JSON,
    alert:()=>{throw Error('No popups for automatic pairing')},
    console:{warn(){},info(){}}
  };
  vm.createContext(context);vm.runInContext(code,context);
  const bridge=context.ChatGPTTabNotifier.createObservatoryCompletionBridge({
    isEnabled:()=>true,notify:message=>notices.push(message),
    tabState:{getState:()=>''},responseMonitor:{}
  });
  return {bridge,requests,context,storage};
}
const pairing=dispatch=>({version:1,origin:'http://127.0.0.1:18755',
  conversation_id:chat,reporting_session_id:sid,
  observer_key:'o'.repeat(48),message_writer_key:'w'.repeat(48),
  dispatch_key:dispatch});
const prefix='fortis-observatory-v1-pair-'+chat;
const proofKey='fortis-observatory-v1-client-proof-'+chat;
test('automatic claimant announces URL but no observer/dispatch keys until owner approval',()=>{
  const t=harness();
  assert.equal(t.requests.length,0);
  t.bridge.check();
  assert.equal(t.requests.length,1);
  const hello=t.requests[0];
  assert.equal(hello.method,'POST');
  assert.equal(hello.url,'http://127.0.0.1:18755/api/notifier/enroll');
  assert.equal(JSON.parse(hello.data).chat,chat);
  assert.match(JSON.parse(hello.data).proof,/^[a-f0-9]{64}$/);
  assert.equal(t.storage.has(prefix),false);
  hello.onload({status:200,responseText:JSON.stringify({ok:true,status:'awaiting_owner'})});
  assert.equal(t.storage.has(prefix),false,'never auto grant by URL alone');
  assert.equal(t.bridge.getPairing(),null);
  assert.equal(t.storage.has(proofKey),true,'per-chat client proof saved for reboot');
});

test('approval installs pairing once and reboot refreshes transient dispatch key',()=>{
  const storage=new Map();
  const a=harness(storage);
  a.bridge.check();
  a.requests[0].onload({status:200,responseText:JSON.stringify({
    ok:true,status:'approved',pairing:pairing('d'.repeat(48))
  })});
  assert.equal(storage.get(prefix).dispatch_key,'d'.repeat(48));
  assert.equal(a.bridge.getPairing().reporting_session_id,sid);
  assert.ok(a.requests.some(req=>req.url.includes('/api/observer-status?session=')));
  const second=harness(storage);
  second.bridge.check();
  assert.equal(second.requests[0].url,'http://127.0.0.1:18755/api/notifier/enroll');
  assert.equal(JSON.parse(second.requests[0].data).proof,storage.get(proofKey));
  second.requests[0].onload({status:200,responseText:JSON.stringify({
    ok:true,status:'approved',pairing:pairing('e'.repeat(48))
  })});
  assert.equal(second.bridge.getPairing().dispatch_key,'e'.repeat(48));
  assert.equal(storage.get(prefix).dispatch_key,'e'.repeat(48));
});

test('invalid approval, wrong chat and server errors do not change pairing or send',()=>{
  const t=harness();
  t.bridge.check();
  t.requests[0].onload({status:200,responseText:JSON.stringify({
    ok:true,status:'approved',
    pairing:{...pairing('d'.repeat(48)),conversation_id:'other-chat'}
  })});
  assert.equal(t.bridge.getPairing(),null);
  assert.equal(t.storage.has(prefix),false);
  const wrongOrigin=harness();
  wrongOrigin.bridge.check();
  wrongOrigin.requests[0].onload({status:200,responseText:JSON.stringify({
    ok:true,status:'approved',
    pairing:{...pairing('d'.repeat(48)),origin:'https://evil.example'}
  })});
  assert.equal(wrongOrigin.bridge.getPairing(),null);
  assert.equal(wrongOrigin.requests.length,1);
});

test('client proof stays per Chat ID and no enrollment outside /c/ URL',()=>{
  const t=harness();
  t.context.location.href='https://chatgpt.com/';
  t.bridge.check();
  assert.equal(t.requests.length,0);
  t.context.location.href='https://chatgpt.com/c/'+chat;
  t.bridge.check();
  assert.equal(t.requests.length,1);
  t.context.location.href='https://chatgpt.com/c/some-other-chat';
  t.requests[0].onload({status:200,responseText:JSON.stringify({
    ok:true,status:'approved',pairing:pairing('d'.repeat(48))
  })});
  assert.equal(t.bridge.getPairing(),null,'late reply must not cross chats');
});
