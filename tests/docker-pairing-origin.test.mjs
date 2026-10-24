import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto, createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { allowedObservatoryOrigin } = require('../src/observatory-endpoints.js');
const { validatePairing } = require('../src/observatory-completion.js');
const { createTaskIdBehavior, createPersistentMessageController } = require('../src/persisted-messages.js');
const { createTaskActivityMonitor } = require('../src/task-activity.js');
const { createUserMessageArchiveMonitor } = require('../src/user-message-archive.js');
const CHAT = '12345678-abcd';
const SESSION = 'rs_' + 'a'.repeat(32), KEY = 'k'.repeat(48), WRITER = 'w'.repeat(48);
const LEGACY = 'http://127.0.0.1:18753', DOCKER = 'http://127.0.0.1:18754';
const OWNER_VIEWER = 'http://127.0.0.1:18755';
const pair = origin => ({ version: 1, origin, conversation_id: CHAT,
  reporting_session_id: SESSION, observer_key: KEY, message_writer_key: WRITER });

function fixture(origin = DOCKER) {
  const kv = new Map(), calls = [];
  const state = { chat: CHAT, pair: pair(origin), time: 1000000 };
  const queue = { id: 0, add: () => 'q-' + ++queue.id,
    isWaitingToSend: () => false, sendNow: () => true, remove() {} };
  const messages = createPersistentMessageController({
    queue, storage: {
      get: k => structuredClone(kv.get(k) || null),
      set: (k, v) => kv.set(k, structuredClone(v)),
      list: () => Array.from(kv.keys())
    },
    getConversationId: () => state.chat, getPairing: () => state.pair,
    behavior: createTaskIdBehavior(webcrypto), now: () => state.time
  });
  const activity = createTaskActivityMonitor({ messages,
    getPairing: () => state.pair, getConversationId: () => state.chat,
    request: req => calls.push(req), now: () => state.time });
  const archive = createUserMessageArchiveMonitor({ messages,
    getPairing: () => state.pair, getConversationId: () => state.chat,
    request: req => calls.push(req), now: () => state.time });
  function send(body) {
    const id = messages.saveAndSend(body);
    messages.handleSendResult({source: 'manual-persisted',
      itemIds: ['q-' + queue.id], status: 'sent'});
    return id;
  }
  function receipt(id) {
    return {ok:true,version:1,found:true,conversation_id:CHAT,
      reporting_session_id:SESSION,task_id:id,sequence:0,accepted_unix:1001,
      event:'progress',provenance:'sender_claim'};
  }
  return { state, kv, calls, messages, activity, archive, send, receipt };
}
test('only exact pinned legacy and Docker browser origins are allowed', () => {
  for (const origin of [LEGACY, DOCKER, OWNER_VIEWER]) {
    assert.equal(allowedObservatoryOrigin(origin), true);
    assert.equal(validatePairing(pair(origin), CHAT)?.origin, origin);
  }
  for (const origin of [
    'http://localhost:18754','http://127.0.0.1:18754/',
    'http://127.0.0.1:18754@evil.com','http://127.0.0.1:18754.evil.com',
    'http://0.0.0.0:18754','http://127.0.0.1:9999',
    'https://127.0.0.1:18754','https://evil.example','',null
  ]) {
    assert.equal(allowedObservatoryOrigin(origin), false, String(origin));
    assert.equal(validatePairing(pair(origin), CHAT), null, String(origin));
  }
});
test('Docker-bound message uses paired Docker origin for both activity and archive', async () => {
  const f=fixture(), text='  user original <private>  ', id=f.send(text);
  assert.equal(f.messages.load(id).observatory_origin, DOCKER);
  assert.equal(f.activity.check(), true);
  assert.equal(f.calls[0].url.startsWith(DOCKER + '/api/task-activity?'), true);
  f.calls[0].onload({status:200,responseText:JSON.stringify(f.receipt(id))});
  assert.equal(f.messages.load(id).activity_status, 'accepted');
  assert.equal(f.archive.check(), true);
  const post=f.calls[1];
  assert.equal(post.url,DOCKER+'/api/user-messages');
  assert.equal(post.headers['X-Fortis-Message-Writer-Key'], WRITER);
  assert.equal(JSON.parse(post.data).original_text,text);
  await post.onload({status:201,responseText:JSON.stringify({
    ok:true,version:1,archived:true,reporting_session_id:SESSION,
    conversation_id:CHAT,task_id:id,status:'created',
    archived_at:'2026-10-19T01:00:00+00:00',
    sha256:createHash('sha256').update(text).digest('hex')
  })});
  assert.equal(f.messages.load(id).archive_status,'archived');
});
test('owner viewer pair uses 18755 for activity and exact user original, not 18754', async()=>{
  const f=fixture(OWNER_VIEWER),text='  оригинал через Textbox 🧪\n',id=f.send(text);
  assert.equal(f.messages.load(id).observatory_origin,OWNER_VIEWER);
  assert.equal(f.activity.check(),true);
  assert.equal(f.calls[0].url.startsWith(OWNER_VIEWER+'/api/task-activity?'),true);
  f.calls[0].onload({status:200,responseText:JSON.stringify(f.receipt(id))});
  assert.equal(f.messages.load(id).activity_status,'accepted');
  assert.equal(f.archive.check(),true);
  const req=f.calls[1];
  assert.equal(req.url,OWNER_VIEWER+'/api/user-messages');
  assert.equal(req.headers['X-Fortis-Message-Writer-Key'],WRITER);
  assert.equal(JSON.parse(req.data).original_text,text);
  await req.onload({status:201,responseText:JSON.stringify({
    ok:true,version:1,archived:true,reporting_session_id:SESSION,
    conversation_id:CHAT,task_id:id,status:'created',
    archived_at:'2026-10-19T01:00:00+00:00',
    sha256:createHash('sha256').update(text).digest('hex')
  })});
  assert.equal(f.messages.load(id).archive_status,'archived');
});

test('old unpaired original stays unbound after changing to owner viewer pair',()=>{
  const f=fixture(null);
  f.state.pair=null;
  const task=f.send('written before notifier pairing');
  assert.equal(f.messages.load(task).observatory_origin,null);
  assert.equal(f.messages.load(task).reporting_session_id,null);
  f.state.pair=pair(OWNER_VIEWER);
  assert.equal(f.activity.check(),false);
  assert.equal(f.archive.check(),false);
  assert.equal(f.calls.length,0);
});

test('old Docker-18754 original must not silently migrate to owner 18755',()=>{
  const f=fixture(DOCKER),task=f.send('old docker-bound raw message');
  f.state.pair=pair(OWNER_VIEWER);
  assert.equal(f.activity.check(),false);
  assert.equal(f.archive.check(),false);
  assert.equal(f.messages.load(task).observatory_origin,DOCKER);
});

test('re-pairing an already created task to a different origin cannot migrate original', () => {
  const f=fixture(LEGACY), id=f.send('legacy original');
  f.state.pair=pair(DOCKER);
  assert.equal(f.activity.check(),false);
  assert.equal(f.calls.length,0);
  assert.equal(f.messages.load(id).observatory_origin,LEGACY);
  f.messages.acceptActivity(f.receipt(id));
  assert.equal(f.archive.check(),false);
  assert.equal(f.calls.length,0);
});
test('historical records with missing origin belong to legacy Windows target, not Docker', () => {
  const f=fixture(LEGACY), id=f.send('old GM record');
  f.kv.set('fortis-local-user-message-v1-'+id,
    {...f.messages.load(id), observatory_origin:undefined});
  f.state.pair=pair(DOCKER);
  assert.equal(f.activity.check(),false);
  f.state.pair=pair(LEGACY);
  assert.equal(f.activity.check(),true);
  assert.equal(f.calls[0].url.startsWith(LEGACY+'/api/task-activity?'),true);
});
test('late activity response after moving pair origin is ignored even with same session/key', () => {
  const f=fixture(DOCKER), id=f.send('awaiting');
  f.activity.check();
  const old=f.calls[0];
  f.state.pair=pair(LEGACY);
  old.onload({status:200,responseText:JSON.stringify(f.receipt(id))});
  assert.equal(f.messages.load(id).activity_status,'pending');
});
test('late writer response after moving pair origin cannot mark archived', async () => {
  const f=fixture(DOCKER),id=f.send('exact data');
  f.messages.acceptActivity(f.receipt(id));
  f.archive.check();
  const prev=f.calls[0];
  f.state.pair=pair(LEGACY);
  await prev.onload({status:201,responseText:JSON.stringify({
    ok:true,version:1,archived:true,reporting_session_id:SESSION,
    conversation_id:CHAT,task_id:id,status:'created',
    archived_at:'2026-10-19T01:00:00+00:00',
    sha256:createHash('sha256').update('exact data').digest('hex')
  })});
  assert.equal(f.messages.load(id).archive_status,'archive_pending');
});
