import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { webcrypto, createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const { createTaskIdBehavior, createPersistentMessageController } = require('../src/persisted-messages.js');
const { createUserMessageArchiveMonitor } = require('../src/user-message-archive.js');
const CHAT = '12345678-abcd';
const SID = 'rs_' + 'a'.repeat(32);
const KEY = 'k'.repeat(48);
const WRITER = 'w'.repeat(48);

function fixture() {
  const data = new Map(), requests = [];
  const state = { time: 1e6, chat: CHAT, pair: { version: 1,
    origin: 'http://127.0.0.1:18753', conversation_id: CHAT,
    reporting_session_id: SID, observer_key: KEY, message_writer_key: WRITER } };
  const storage = { get: key => structuredClone(data.get(key) ?? null),
    set: (key, value) => data.set(key, structuredClone(value)), list: () => [...data.keys()] };
  const queue = { number: 0, add: () => 'q-' + ++queue.number,
    sendNow: () => true, remove() {}, isWaitingToSend: () => false };
  const messages = createPersistentMessageController({ queue, storage,
    getConversationId: () => state.chat, getPairing: () => state.pair,
    behavior: createTaskIdBehavior(webcrypto), now: () => state.time });
  const monitor = createUserMessageArchiveMonitor({ messages,
    getPairing: () => state.pair, getConversationId: () => state.chat,
    request: opts => requests.push(opts), now: () => state.time });
  const send = (original) => {
    const id = messages.saveAndSend(original);
    messages.handleSendResult({ source: 'manual-persisted',
      itemIds: ['q-' + queue.number], status: 'sent' });
    return id;
  };
  const signal = id => messages.acceptActivity({ ok: true, version: 1,
    found: true, task_id: id, conversation_id: CHAT,
    reporting_session_id: SID, sequence: 2, accepted_unix: 1001,
    event: 'progress', provenance: 'sender_claim' });
  const receipt = (id, original, fields = {}) => ({ ok: true, version: 1, archived: true,
    reporting_session_id: SID, conversation_id: CHAT, task_id: id,
    status: 'created', archived_at: '2026-10-19T01:00:00+00:00',
    sha256: createHash('sha256').update(original).digest('hex'), ...fields });
  return { state, messages, monitor, requests, send, signal, receipt, data };
}

test('no accepted signal, no archive POST or text disclosure', () => {
  const f = fixture(); const id = f.send('private user text');
  assert.equal(f.monitor.check(), false);
  assert.equal(f.requests.length, 0);
  assert.equal(f.messages.load(id).archive_status, 'pending_activity');
});

test('read-only pairing does not enable full-text write', () => {
  const f = fixture(), id = f.send('private');
  f.signal(id); delete f.state.pair.message_writer_key;
  assert.equal(f.monitor.check(), false);
  assert.equal(f.requests.length, 0);
});

test('accepted activity triggers private POST, verifies owner digest and marks archived', async () => {
  const f = fixture(); const original = '  Привет\nстрока 2 </script>  ';
  const id = f.send(original);
  assert.equal(f.signal(id), true);
  assert.equal(f.messages.load(id).archive_status, 'archive_pending');
  assert.equal(f.monitor.check(), true);
  assert.equal(f.requests.length, 1);
  const request = f.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.headers['X-Fortis-Message-Writer-Key'], WRITER);
  assert.equal(request.url, 'http://127.0.0.1:18753/api/user-messages');
  assert.doesNotMatch(request.url, /Привет|private|owner|bearer/);
  assert.deepEqual(JSON.parse(request.data), { reporting_session_id: SID,
    conversation_id: CHAT, task_id: id, original_text: original });
  await request.onload({ status: 201, responseText: JSON.stringify(f.receipt(id, original)) });
  assert.equal(f.messages.load(id).archive_status, 'archived');
  assert.equal(f.messages.load(id).original_text, original);
  assert.equal(f.messages.load(id).archive_sha256, f.receipt(id, original).sha256);
  f.state.time += 4000;
  assert.equal(f.monitor.check(), false);
});

test('wrong digest, wrong task, incomplete and forged receipts never mark archived', async () => {
  const f = fixture(), id = f.send('hello'); f.signal(id);
  for (const fields of [{ sha256: '0'.repeat(64) },
    { task_id: 'task_' + 'f'.repeat(32) }, { archived: false },
    { status: 'STAGED_ONLY' }]) {
    assert.equal(f.monitor.check(), true);
    await f.requests.at(-1).onload({ status: 201,
      responseText: JSON.stringify(f.receipt(id, 'hello', fields)) });
    assert.notEqual(f.messages.load(id).archive_status, 'archived');
    f.state.time += 4000;
  }
});

test('offline failure retries after reconnect, source not silently duplicated', async () => {
  const f = fixture(), id = f.send('offline'); f.signal(id);
  f.monitor.check(); f.requests[0].ontimeout();
  assert.equal(f.messages.load(id).archive_status, 'archive_pending');
  f.state.time += 4000; assert.equal(f.monitor.check(), true);
  await f.requests[1].onload({ status: 200, responseText: JSON.stringify(
    f.receipt(id, 'offline', { status: 'existing' })) });
  assert.equal(f.messages.load(id).archive_status, 'archived');
  assert.equal(f.messages.listForChat().length, 1);
});

test('chat change, writer key change, server 409 do not archive', async () => {
  const f = fixture(), id = f.send('hello'); f.signal(id);
  f.monitor.check(); f.requests[0].onload({ status: 409, responseText: '{}' });
  assert.equal(f.messages.load(id).archive_status, 'archive_pending');
  f.state.time += 4000; f.monitor.check();
  f.state.chat = 'abcdefgh-1234';
  await f.requests[1].onload({ status: 201, responseText: JSON.stringify(f.receipt(id, 'hello')) });
  assert.equal(f.messages.load(id).archive_status, 'archive_pending');
  f.state.chat = CHAT; f.state.time += 4000; f.monitor.check();
  f.state.pair.message_writer_key = 'x'.repeat(48);
  await f.requests[2].onload({ status: 201, responseText: JSON.stringify(f.receipt(id, 'hello')) });
  assert.equal(f.messages.load(id).archive_status, 'archive_pending');
});

test('ordinary observer pairing stays read-only; writer pairing is explicit and scoped', () => {
  const { validatePairing } = require('../src/observatory-completion.js');
  const readOnly = { version: 1, origin: 'http://127.0.0.1:18753',
    conversation_id: CHAT, reporting_session_id: SID, observer_key: KEY };
  assert.equal(validatePairing(readOnly, CHAT).message_writer_key, undefined);
  const writable = validatePairing({ ...readOnly, message_writer_key: WRITER }, CHAT);
  assert.equal(writable.message_writer_key, WRITER);
  assert.equal(validatePairing({ ...readOnly, message_writer_key: 'not-a-key' }, CHAT), null);
  assert.equal(validatePairing({ ...readOnly, message_writer_key: WRITER }, 'different-chat'), null);
  assert.equal(validatePairing({ ...readOnly, origin: 'http://127.0.0.1:8080', message_writer_key: WRITER }, CHAT), null);
  assert.equal(validatePairing({ ...readOnly, message_writer_key: WRITER, owner_token: 'never-use' }, CHAT).owner_token, undefined);
});
