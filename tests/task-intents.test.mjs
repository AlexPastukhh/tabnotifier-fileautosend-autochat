import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createTaskIntentMonitor } = require('../src/task-intents.js');
const { createPersistentMessageController, createTaskIdBehavior } = require('../src/persisted-messages.js');
const { validatePairing } = require('../src/observatory-completion.js');
const CHAT='12345678-abcd', SID='rs_'+'a'.repeat(32), KEY='i'.repeat(48);
function fixture() {
  const state={time:1792530000000,chat:CHAT,pair:{version:1,origin:'http://127.0.0.1:18755',
    conversation_id:CHAT,reporting_session_id:SID,observer_key:'o'.repeat(48),task_intent_key:KEY},calls:[],sends:0};
  const data=new Map();
  const storage={set:(k,v)=>data.set(k,structuredClone(v)),get:k=>structuredClone(data.get(k)||null),list:()=>[...data.keys()]};
  const queue={i:0,isWaitingToSend:()=>false,add:()=>String(++queue.i),sendNow:()=>{state.sends++;return true;},remove(){}};
  const makeMessages=()=>createPersistentMessageController({queue,storage,getConversationId:()=>state.chat,
    getPairing:()=>state.pair,behavior:createTaskIdBehavior(webcrypto),now:()=>state.time});
  let messages=makeMessages();
  const makeMonitor=()=>createTaskIntentMonitor({messages,getConversationId:()=>state.chat,getPairing:()=>state.pair,
    request:r=>state.calls.push(r),now:()=>state.time});
  let monitor=makeMonitor();
  const draft=()=>messages.prepareDraft('  private original\n🧪\n');
  function reply(req=state.calls.at(-1),override={}) {
    const body=JSON.parse(req.data),send=body.revision>0;
    req.onload({status:201,responseText:JSON.stringify({ok:true,version:1,reporting_session_id:SID,
      conversation_id:CHAT,task_id:body.task_id,...(send?{recorded:true,revision:body.revision,
      stored_revision:body.revision,phase:body.phase,status:'created',provenance:'notifier_send_claim'}:
      {registered:true,registered_at_unix:state.time/1000,status:'created',provenance:'notifier_local_save_claim'}),...override})});
  }
  return {state,data,storage,queue,draft,reply,get messages(){return messages;},get monitor(){return monitor;},
    tick(){state.time+=61000;},reload(){monitor.dispose();messages=makeMessages();monitor=makeMonitor();}};
}
test('verified saved draft registers before AI without text, archive or Send',()=>{
  const f=fixture(),d=f.draft();
  assert.equal(f.messages.load(d.task_id).intent_ready,true);
  assert.equal(f.monitor.check(),true);
  const req=f.state.calls[0],body=JSON.parse(req.data);
  assert.equal(req.url,'http://127.0.0.1:18755/api/task-intents');
  assert.deepEqual(Object.keys(body).sort(),['version','reporting_session_id','conversation_id','task_id','prepared_at_client_ms'].sort());
  assert.doesNotMatch(req.data,/private|original|submitted|key|summary/);
  assert.equal(f.state.sends,0);
  f.reply();assert.equal(f.messages.load(d.task_id).intent_registered,true);
  assert.equal(f.messages.load(d.task_id).activity_status,'pending');
  assert.equal(f.messages.load(d.task_id).archive_status,'pending_activity');
});
test('partial local write without successful readback is never registered',()=>{
  const f=fixture(),read=f.storage.get;
  f.storage.get=k=>{const v=read(k);return v?{...v,original_text:'corrupted'}:v;};
  assert.equal(f.draft(),null);f.storage.get=read;
  assert.equal(f.monitor.check(),false);assert.equal(f.state.calls.length,0);
});
test('offline retry after reload resends only identical metadata',()=>{
  const f=fixture(),d=f.draft();f.monitor.check();const first=f.state.calls[0];
  first.onerror();assert.equal(f.monitor.getTaskStatus(d.task_id),'unavailable');
  assert.equal(f.monitor.check(),false);f.reload();assert.equal(f.monitor.check(),true);
  assert.equal(f.state.calls[1].data,first.data);f.reply();f.tick();assert.equal(f.monitor.check(),false);
  assert.equal(f.state.sends,0);
});
test('lost reply after reload retries registration without creating task or sending',()=>{
  const f=fixture(),d=f.draft();f.monitor.check();const first=f.state.calls[0];
  f.reload();f.monitor.check();first.onload({status:201,responseText:'{}'});
  f.reply(undefined,{status:'existing'});assert.equal(f.messages.listForChat().length,1);
  assert.equal(f.messages.load(d.task_id).intent_registered,true);assert.equal(f.state.sends,0);
});
test('manual attempt becomes unconfirmed metadata and is never called delivery confirmation',()=>{
  const f=fixture(),d=f.draft();f.monitor.check();f.reply();
  f.messages.recordManualDraftSend(d.submitted_text);f.tick();f.monitor.check();
  const body=JSON.parse(f.state.calls.at(-1).data);
  assert.equal(body.phase,'send_unconfirmed');assert.equal(body.revision,1);
  assert.equal(f.state.calls.at(-1).url.endsWith('/api/task-send-state'),true);
  f.reply();assert.equal(f.messages.load(d.task_id).intent_send_revision,1);
  assert.equal(f.messages.load(d.task_id).activity_status,'pending');assert.equal(f.state.sends,0);
});
test('queue pre-click request and DOM observation have distinct durable revisions',()=>{
  const f=fixture();const id=f.messages.saveAndSend('private queue prompt');
  const q=String(f.queue.i);f.messages.beforeSendClick({source:'manual-persisted',itemIds:[q]});
  assert.equal(f.messages.load(id).send_phase,'send_requested');
  f.messages.handleSendResult({source:'manual-persisted',itemIds:[q],status:'sent'});
  const record=f.messages.load(id);assert.equal(record.send_phase,'send_observed');assert.equal(record.send_revision,2);
  assert.equal(record.activity_status,'pending');assert.equal(record.archive_status,'pending_activity');
  f.monitor.check();f.reply();f.tick();f.monitor.check();
  assert.equal(JSON.parse(f.state.calls.at(-1).data).phase,'send_observed');
  f.reply();assert.equal(f.state.sends,1);f.tick();assert.equal(f.monitor.check(),false);
});
test('failure before click remains not-attempted rather than waiting or AI failed',()=>{
  const f=fixture(),id=f.messages.saveAndSend('test');
  f.messages.handleSendResult({source:'manual-persisted',itemIds:[String(f.queue.i)],status:'failed'});
  assert.equal(f.messages.load(id).send_phase,'send_not_attempted');
  assert.equal(f.messages.load(id).activity_status,'pending');
});
test('old pairing, missing capability, origin switch and wrong session cannot sync',()=>{
  for(const alter of [f=>delete f.state.pair.task_intent_key,f=>f.state.pair=null,
    f=>f.state.pair.reporting_session_id='rs_'+'b'.repeat(32),f=>f.state.pair.origin='http://127.0.0.1:18754',
    f=>f.state.chat='other-chat-12345678']){
    const f=fixture();f.draft();alter(f);assert.equal(f.monitor.check(),false);assert.equal(f.state.calls.length,0);
  }
});
test('response arriving after chat or capability changes cannot acknowledge task',()=>{
  for(const alter of [f=>f.state.chat='other-chat-12345678',f=>f.state.pair.task_intent_key='n'.repeat(48),f=>f.state.pair=null]){
    const f=fixture(),d=f.draft();f.monitor.check();alter(f);f.reply();
    assert.notEqual(f.messages.load(d.task_id).intent_registered,true);
  }
});
test('older send ACK cannot erase a newer local send revision',()=>{
  const f=fixture(),id=f.messages.saveAndSend('test'),q=String(f.queue.i);
  f.monitor.check();f.reply();f.messages.beforeSendClick({source:'manual-persisted',itemIds:[q]});
  f.tick();f.monitor.check();const req=f.state.calls.at(-1);
  f.messages.handleSendResult({source:'manual-persisted',itemIds:[q],status:'sent'});f.reply(req);
  assert.equal(f.messages.load(id).send_revision,2);assert.equal(f.messages.load(id).intent_send_revision,1);
  f.tick();f.monitor.check();assert.equal(JSON.parse(f.state.calls.at(-1).data).revision,2);
});
test('two independent tasks sync fairly and denial is connection state only',()=>{
  const f=fixture(),a=f.draft(),b=f.draft();f.monitor.check();
  f.state.calls.at(-1).onload({status:403,responseText:'{}'});f.tick();f.monitor.check();f.reply();
  f.tick();f.monitor.check();f.reply();
  assert.equal(f.messages.load(a.task_id).intent_registered,true);assert.equal(f.messages.load(b.task_id).intent_registered,true);
  assert.equal(f.messages.load(a.task_id).send_status,'draft');
});
test('pair validation keeps optional scoped metadata key without breaking old pair',()=>{
  const f=fixture();assert.equal(validatePairing(f.state.pair,CHAT).task_intent_key,KEY);
  assert.equal(validatePairing({...f.state.pair,task_intent_key:'bad'},CHAT),null);
  delete f.state.pair.task_intent_key;assert.ok(validatePairing(f.state.pair,CHAT));
});
