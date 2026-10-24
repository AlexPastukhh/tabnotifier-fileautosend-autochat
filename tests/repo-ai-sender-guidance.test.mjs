import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const {createTaskIdBehavior, createPersistentMessageController} = require('../src/persisted-messages.js');
const CHAT = 'abcdefff-0000';
const SID = 'rs_' + 'a'.repeat(32);
const KEY = 'observer_key_' + 'a'.repeat(45);
const WRITER = 'writer_key_' + 'b'.repeat(45);
const docker = { origin:'http://127.0.0.1:18754', conversation_id:CHAT,
  reporting_session_id:SID, observer_key:KEY, message_writer_key:WRITER };

function model(pair = docker) {
  const state={pair,chat:CHAT}; const map=new Map();let sent=[];
  const queue={add(text){sent.push(text);return 'q-'+sent.length;},
    isWaitingToSend:()=>false,sendNow:()=>true,remove:()=>{}};
  const storage={get:k=>structuredClone(map.get(k)||null),
    set:(k,v)=>map.set(k,structuredClone(v)),list:()=>[...map.keys()]};
  const ctl=createPersistentMessageController({
    queue,storage,getConversationId:()=>state.chat,getPairing:()=>state.pair,
    behavior:createTaskIdBehavior(webcrypto),now:()=>123456789
  });
  return {ctl,state,sent,map};
}

test('Docker pair adds Fortis Repo tool instruction and session but not tokens',()=>{
  const f=model();
  const id=f.ctl.saveAndSend('  exact original\nprivate\n');
  assert.match(id,/^task_[0-9a-f]{32}$/);
  const submitted=f.sent[0];
  assert.match(submitted,/Основной инструмент AI.*Fortis Repo/);
  assert.match(submitted,/repo_task\.py message/);
  assert.match(submitted,/repo_task\.py event/);
  assert.doesNotMatch(submitted,/repo_message_sender\.py|repo_service\.py instructions/);
  assert.match(submitted,/reporting_session_id: rs_/);
  assert.match(submitted,new RegExp(SID));
  assert.match(submitted,new RegExp(CHAT));
  assert.match(submitted,/--chat-id abcdefff-0000 --task /);
  assert.match(submitted,new RegExp('--task '+id));
  assert.doesNotMatch(submitted,/session_task_id|session-task|enrollment|Session enrollment/);
  assert.doesNotMatch(submitted,/--session-task/);
  assert.doesNotMatch(submitted,new RegExp(KEY));
  assert.doesNotMatch(submitted,new RegExp(WRITER));
  assert.equal(f.ctl.load(id).original_text,'  exact original\nprivate\n');
  assert.equal(f.ctl.load(id).observatory_origin,docker.origin);
});
test('without pairing no false session enrollment and still names Fortis Repo',()=>{
  const f=model(null);
  const id=f.ctl.saveAndSend('unpaired');
  assert.ok(id);
  assert.match(f.sent[0],/Основной инструмент AI.*Fortis Repo/);
  assert.doesNotMatch(f.sent[0],/reporting_session_id: rs_/);
  assert.equal(f.ctl.load(id).reporting_session_id,null);
});
test('mismatched or legacy pair never injects Docker enrollment',()=>{
  for(const pair of [
    {...docker, origin:'http://127.0.0.1:18753'},
    {...docker, conversation_id:'other-chat-0000'},
    {...docker, reporting_session_id:'wrong_session'},
    {...docker, origin:'https://evil.example'}
  ]){
    const f=model(pair);
    f.ctl.saveAndSend('hello');
    assert.doesNotMatch(f.sent[0],/reporting_session_id: rs_/);
    assert.doesNotMatch(f.sent[0],new RegExp(KEY));
    assert.doesNotMatch(f.sent[0],new RegExp(WRITER));
  }
});
test('each request carries all current nonsecret IDs and does not rely on old bootstrap',()=>{
  const f=model(docker);
  const first=f.ctl.saveAndSend('Первый запрос');
  const second=f.ctl.saveAndSend('Второй запрос');
  assert.notEqual(first,second);
  const firstText=f.ctl.load(first).submitted_text;
  const secondText=f.ctl.load(second).submitted_text;
  assert.match(firstText,new RegExp('task_id: '+first));
  assert.match(secondText,new RegExp('task_id: '+second));
  assert.doesNotMatch(secondText,new RegExp(first));
  for(const body of [firstText,secondText]){
    assert.match(body,new RegExp('reporting_session_id: '+SID));
    assert.match(body,new RegExp('conversation_id: '+CHAT));
    assert.match(body,/repo_task\.py event/);
    assert.match(body,/repo_task\.py message/);
    assert.doesNotMatch(body,new RegExp(KEY));
    assert.doesNotMatch(body,new RegExp(WRITER));
    assert.doesNotMatch(body,/session_task_id|session-task|enrollment|Session enrollment/);
  }
});

test('re-pair after creation keeps frozen sent task context and original',()=>{
  const f=model(docker);
  const id=f.ctl.saveAndSend('original');
  const frozen=f.ctl.load(id).submitted_text;
  f.state.pair={...docker,origin:'http://127.0.0.1:18753'};
  assert.equal(f.ctl.load(id).submitted_text,frozen);
  assert.equal(f.ctl.load(id).observatory_origin,docker.origin);
  assert.equal(f.sent.length,1);
});
