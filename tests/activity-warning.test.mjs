import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { describeWaitingActivity, createTaskActivityMonitor } = require('../src/task-activity.js');
const CHAT = 'chat-12345678';
const SESSION = 'rs_' + 'a'.repeat(32);
const KEY = 'k'.repeat(48);
const TASK = 'task_' + 'b'.repeat(32);
const pairing = { origin: 'http://127.0.0.1:18753', conversation_id: CHAT,
  reporting_session_id: SESSION, observer_key: KEY };
const base = { task_id: TASK, conversation_id: CHAT,
  reporting_session_id: SESSION, sent_at: 1000, send_status: 'sent',
  archive_status: 'pending_activity', activity_status: 'pending' };
const describe = (overrides = {}, options = {}) => describeWaitingActivity({
  record: { ...base, ...overrides }, pairing, connection: 'online', now: 16000, ...options
});

test('warning begins only at 15 seconds after confirmed native send and has no hard-failure claim', () => {
  assert.equal(describe({}, { now: 15999 }), 'Ожидает активности Observatory');
  assert.match(describe({}, { now: 16000 }), /Пока нет подтверждения активности/);
  assert.doesNotMatch(describe(), /ChatGPT не получил|не работает|ошибка ChatGPT|провал/);
  assert.equal(describe({}, { now: 60000 }), describe({}, { now: 16000 }));
});

test('no warning for draft, unconfirmed send, or already accepted activity', () => {
  assert.equal(describe({ send_status: 'send_queued' }), '');
  assert.equal(describe({ send_status: 'send_unconfirmed' }), '');
  assert.equal(describe({ activity_status: 'accepted' }), '');
});

test('unpaired, switched session, offline, denied and unknown connectivity stay distinguishable', () => {
  assert.match(describe({ reporting_session_id: null }), /Без привязки/);
  assert.match(describe({}, { pairing: null }), /Нет прежней привязки/);
  assert.match(describe({}, { pairing: { ...pairing, reporting_session_id: 'other' } }), /Нет прежней привязки/);
  assert.match(describe({}, { connection: 'unavailable' }), /недоступен/);
  assert.match(describe({}, { connection: 'denied' }), /отклонил доступ/);
  assert.match(describe({}, { connection: 'checking' }), /Проверяем/);
  assert.doesNotMatch(describe({}, { connection: 'unavailable' }), /нет подтверждения активности/);
});

test('no warning before Send confirmation, even when message was prepared long ago', () => {
  assert.equal(describe({ send_status: 'prepared', created_at: 1 }, { now: 100000 }), '');
  assert.equal(describe({ sent_at: null }, { now: 100000 }), 'Ожидает активности Observatory');
});

function monitorFixture() {
  let time = 20000, chat = CHAT, pair = { ...pairing };
  const calls = [], notifications = [];
  const record = { ...base, created_at: 1000 };
  const messages = {
    listForChat: () => [record],
    acceptActivity: () => false
  };
  const monitor = createTaskActivityMonitor({ messages, getConversationId: () => chat,
    getPairing: () => pair, request: options => calls.push(options),
    now: () => time, onStatus: () => notifications.push(time) });
  return { monitor, calls, notifications, tick: ms => { time += ms; },
    changeChat: to => { chat = to; }, changePair: to => { pair = to; } };
}
const okResponse = { status: 200, responseText: JSON.stringify({ ok: true, version: 1,
  found: false, conversation_id: CHAT, reporting_session_id: SESSION, task_id: TASK,
  accepted_unix: null, event: null, sequence: null, provenance: null }) };

test('only a valid per-task 200 status establishes short-lived online connectivity', () => {
  const f = monitorFixture();
  assert.equal(f.monitor.getTaskStatus(TASK), 'checking');
  assert.equal(f.monitor.check(), true);
  f.calls[0].onload(okResponse);
  assert.equal(f.monitor.getTaskStatus(TASK), 'online');
  assert.equal(f.notifications.length, 1);
  f.tick(12001);
  assert.equal(f.monitor.getTaskStatus(TASK), 'checking');
});

test('connection errors and denied access never become false ChatGPT-inactivity evidence', () => {
  const f = monitorFixture(); f.monitor.check(); f.calls[0].ontimeout();
  assert.equal(f.monitor.getTaskStatus(TASK), 'unavailable');
  f.tick(4000); f.monitor.check(); f.calls[1].onload({ status: 403, responseText: '{}' });
  assert.equal(f.monitor.getTaskStatus(TASK), 'denied');
  f.tick(4000); f.monitor.check(); f.calls[2].onload({ status: 200, responseText: '{}' });
  assert.equal(f.monitor.getTaskStatus(TASK), 'denied');
});

test('switching chat or pairing invalidates old connectivity and stale requests', () => {
  const f = monitorFixture(); f.monitor.check();
  f.changeChat('other-chat'); f.calls[0].onload(okResponse);
  assert.equal(f.monitor.getTaskStatus(TASK), 'checking');
  f.changeChat(CHAT); f.tick(4000); f.monitor.check();
  f.changePair({ ...pairing, observer_key: 'x'.repeat(48) });
  f.calls[1].onload(okResponse);
  assert.equal(f.monitor.getTaskStatus(TASK), 'checking');
});
