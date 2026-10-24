import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createTaskIdBehavior, createPersistentMessageController } = require('../src/persisted-messages.js');
const { createTaskActivityMonitor } = require('../src/task-activity.js');

const SID = 'rs_' + 'a'.repeat(32);
const KEY = 'k'.repeat(48);
const CHAT = '12345678-abcd';

function fixture() {
  const data = new Map();
  const state = { chat: CHAT, pairing: { version: 1,
    origin: 'http://127.0.0.1:18753', conversation_id: CHAT,
    reporting_session_id: SID, observer_key: KEY }, time: 1e6, calls: [] };
  const storage = {
    set: (key, value) => data.set(key, structuredClone(value)),
    get: key => structuredClone(data.get(key) || null),
    list: () => [...data.keys()]
  };
  const queue = {
    i: 0, add: () => 'q-' + ++queue.i,
    isWaitingToSend: () => false, sendNow: () => true, remove() {}
  };
  const messages = createPersistentMessageController({
    queue, storage,
    getConversationId: () => state.chat, getPairing: () => state.pairing,
    behavior: createTaskIdBehavior(webcrypto), now: () => state.time
  });
  const monitor = createTaskActivityMonitor({
    messages, getPairing: () => state.pairing,
    getConversationId: () => state.chat,
    request: options => state.calls.push(options),
    now: () => state.time
  });
  function makeSent(text) {
    const id = messages.saveAndSend(text);
    const record = messages.load(id);
    const queueId = 'q-' + queue.i;
    messages.handleSendResult({ source: 'manual-persisted',
      itemIds: [queueId], status: 'sent' });
    return { id, record: messages.load(id) };
  }
  function receipt(id, fields = {}) {
    return { ok: true, version: 1, found: true, conversation_id: CHAT,
      reporting_session_id: SID, task_id: id, sequence: 7,
      accepted_unix: 1001, event: 'progress', provenance: 'sender_claim', ...fields };
  }
  return { state, data, messages, monitor, makeSent, receipt, storage };
}

test('no pair or no matching task avoids all network requests', () => {
  const f = fixture();
  assert.equal(f.monitor.check(), false);
  f.makeSent('hello');
  f.state.pairing = null;
  assert.equal(f.monitor.check(), false);
  f.state.pairing = { origin: 'https://evil.example', conversation_id: CHAT,
    reporting_session_id: SID, observer_key: KEY };
  assert.equal(f.monitor.check(), false);
  assert.equal(f.state.calls.length, 0);
});
test('accepted progress receipt is bound to stored task, session and chat', () => {
  const f = fixture(), { id, record } = f.makeSent('private message');
  assert.equal(record.reporting_session_id, SID);
  assert.equal(f.monitor.check(), true);
  assert.equal(f.state.calls.length, 1);
  const req = f.state.calls[0];
  assert.equal(req.method, 'GET');
  assert.equal(req.headers['X-Fortis-Observer-Key'], KEY);
  assert.match(req.url, new RegExp(id));
  assert.doesNotMatch(req.url, /private message|owner|bearer/i);
  req.onload({ status: 200, responseText: JSON.stringify(f.receipt(id)) });
  const saved = f.messages.load(id);
  assert.equal(saved.activity_status, 'accepted');
  assert.equal(saved.first_activity_event, 'progress');
  assert.equal(saved.first_activity_sequence, 7);
  assert.equal(saved.first_activity_at, 1001000);
  assert.equal(saved.original_text, 'private message');
  assert.equal(saved.archive_status, 'archive_pending');
  f.state.time += 4000;
  assert.equal(f.monitor.check(), false);
});
test('unknown, incorrect and staged-only replies cannot set accepted', () => {
  const f = fixture(), { id } = f.makeSent('hello');
  f.monitor.check();
  f.state.calls[0].onload({ status: 200, responseText:
    JSON.stringify(f.receipt(id, { found: false, event: null, accepted_unix: null })) });
  assert.equal(f.messages.load(id).activity_status, 'pending');
  f.state.time += 4000;
  f.monitor.check();
  f.state.calls[1].onload({ status: 200, responseText: JSON.stringify(f.receipt(id, {
    task_id: 'task_' + 'b'.repeat(32)
  })) });
  assert.equal(f.messages.load(id).activity_status, 'pending');
  f.state.time += 4000;
  f.monitor.check();
  f.state.calls[2].onload({ status: 200, responseText:
    JSON.stringify(f.receipt(id, { provenance: 'STAGED_ONLY' })) });
  assert.equal(f.messages.load(id).activity_status, 'pending');
});
test('offline request can be retried after reconnection using the same task', () => {
  const f = fixture(), { id } = f.makeSent('offline');
  assert.equal(f.monitor.check(), true);
  f.state.calls[0].onerror();
  assert.equal(f.messages.load(id).activity_status, 'pending');
  f.state.time += 4000;
  assert.equal(f.monitor.check(), true);
  f.state.calls[1].onload({ status: 200, responseText:
    JSON.stringify(f.receipt(id, { event: 'assistant_message', sequence: 2 })) });
  assert.equal(f.messages.load(id).first_activity_event, 'assistant_message');
});
test('stale response after switching chat or key is ignored', () => {
  const f = fixture(), { id } = f.makeSent('message');
  f.monitor.check();
  f.state.chat = 'another-12345678';
  f.state.calls[0].onload({ status: 200, responseText: JSON.stringify(f.receipt(id)) });
  assert.equal(f.messages.load(id).activity_status, 'pending');
  f.state.chat = CHAT; f.state.time += 4000;
  f.monitor.check();
  f.state.pairing = { ...f.state.pairing, observer_key: 'x'.repeat(48) };
  f.state.calls[1].onload({ status: 200, responseText: JSON.stringify(f.receipt(id)) });
  assert.equal(f.messages.load(id).activity_status, 'pending');
});
test('task without pairing at send remains local; later pairing does not silently rewrite ownership', () => {
  const f = fixture();
  f.state.pairing = null;
  const { id } = f.makeSent('unpaired');
  assert.equal(f.messages.load(id).reporting_session_id, null);
  f.state.pairing = { origin: 'http://127.0.0.1:18753',
    reporting_session_id: SID, conversation_id: CHAT, observer_key: KEY };
  assert.equal(f.monitor.check(), false);
  assert.equal(f.messages.load(id).archive_status, 'pending_activity');
});
test('multiple tasks get separate checks; pending records survive new controller', () => {
  const f = fixture(), first = f.makeSent('one'), second = f.makeSent('two');
  f.monitor.check();
  const firstTask = new URL(f.state.calls[0].url).searchParams.get('task');
  f.state.calls[0].onload({ status: 200, responseText:
    JSON.stringify(f.receipt(firstTask, { sequence: 0, event: 'user_message' })) });
  f.state.time += 4000;
  f.monitor.check();
  const secondTask = new URL(f.state.calls[1].url).searchParams.get('task');
  assert.notEqual(secondTask, firstTask);
  f.state.calls[1].onload({ status: 200, responseText:
    JSON.stringify(f.receipt(secondTask, { sequence: 3, event: 'completed' })) });
  assert.equal(f.messages.load(first.id).activity_status, 'accepted');
  assert.equal(f.messages.load(second.id).activity_status, 'accepted');
  assert.deepEqual(f.messages.listForChat().map(x => x.archive_status),
    ['archive_pending', 'archive_pending']);
});
test('invalid messages API receipt cannot be locally accepted', () => {
  const f = fixture(), { id } = f.makeSent('secret');
  assert.equal(f.messages.acceptActivity(f.receipt(id, { sequence: '7' })), false);
  assert.equal(f.messages.acceptActivity(f.receipt(id, { reporting_session_id: 'bad' })), false);
  assert.equal(f.messages.acceptActivity(f.receipt(id, { event: 'unauthorized' })), false);
  assert.equal(f.messages.load(id).activity_status, 'pending');
});

