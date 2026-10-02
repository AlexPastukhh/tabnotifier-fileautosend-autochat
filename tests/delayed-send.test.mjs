import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  DEFAULT_DELAY_MS,
  normalizeDelayMs,
  delayMinutesToMs,
  formatDelayMinutes,
  formatDelayedRemaining,
  evaluateCheckpointResponseGuard,
  evaluateDelayedSendConfirmation,
  createDelayedSendController
} = require('../src/delayed-send.js');

function createMemoryStorage() {
  const map = new Map();
  return {
    getItem(key) { return map.has(key) ? map.get(key) : null; },
    setItem(key, value) { map.set(key, String(value)); },
    removeItem(key) { map.delete(key); }
  };
}

function createHarness({ storage = createMemoryStorage() } = {}) {
  let time = 0;
  let route = 'https://chatgpt.com/c/test';
  let generating = false;
  let pipelineBusy = false;
  let assistantSnapshot = { count: 0, fingerprint: '0:' };
  let clicks = 0;
  const clickedTexts = [];
  const composer = { isConnected: true, text: '' };
  const button = {
    isConnected: true,
    click() {
      clicks += 1;
      clickedTexts.push(composer.text);
    }
  };
  const context = { composer, sendButton: button, container: {} };
  const controller = createDelayedSendController({
    storage,
    now: () => time,
    getRouteKey: () => route,
    isGenerationActive: () => generating,
    isSendPipelineBusy: () => pipelineBusy,
    getAssistantSnapshot: () => ({ ...assistantSnapshot }),
    resolveContext: () => context,
    isSendReady: candidate => candidate === button && candidate.isConnected !== false,
    readText: candidate => candidate?.text || '',
    setText: (candidate, value) => {
      if (!candidate) return false;
      candidate.text = String(value);
      return true;
    },
    normalizeText: value => String(value || '').trim()
  });
  return {
    controller,
    composer,
    button,
    storage,
    clickedTexts,
    get clicks() { return clicks; },
    setTime(value) { time = value; },
    setRoute(value) { route = value; },
    setGenerating(value) { generating = Boolean(value); },
    setPipelineBusy(value) { pipelineBusy = Boolean(value); },
    setAssistantSnapshot(count, text = '') {
      const numericCount = Math.max(0, Number(count) || 0);
      const normalizedText = String(text || '').replace(/\s+/g, ' ').trim();
      assistantSnapshot = numericCount > 0
        ? { count: numericCount, fingerprint: `${numericCount}:${normalizedText.length}:${normalizedText.slice(-300)}` }
        : { count: 0, fingerprint: '0:' };
    }
  };
}

function armCheckpoint(h, text = 'checkpoint') {
  h.controller.setCheckpointText(text);
  assert.equal(h.controller.armCheckpoint(), true);
}

function runDueSend(h, dueAt) {
  h.setTime(dueAt);
  h.controller.check(); // inserts stored text into an empty native composer
  h.controller.check(); // clicks native Send after the composer has the owned text
}

test('delayed timer formats countdown like a compact version chip', () => {
  assert.equal(formatDelayedRemaining(0), '00:00');
  assert.equal(formatDelayedRemaining(65_000), '01:05');
  assert.equal(formatDelayedRemaining(3_661_000), '1:01:01');
});

test('checkpoint response guard reuses assistant snapshot semantics and fails closed while hydration is incomplete', () => {
  assert.deepEqual(
    evaluateCheckpointResponseGuard({
      baseline: { count: 2, fingerprint: '2:5:hello' },
      current: { count: 2, fingerprint: '2:5:hello' }
    }),
    { allow: true, answered: false, reason: 'unchanged' }
  );
  assert.equal(
    evaluateCheckpointResponseGuard({
      baseline: { count: 2, fingerprint: '2:5:hello' },
      current: { count: 3, fingerprint: '3:6:answer' }
    }).answered,
    true
  );
  assert.deepEqual(
    evaluateCheckpointResponseGuard({
      baseline: { count: 2, fingerprint: '2:5:hello' },
      current: { count: 1, fingerprint: '1:3:old' }
    }),
    { allow: false, answered: false, reason: 'snapshot-not-ready' }
  );
});

test('runtime wires the existing response-monitor assistantSnapshot into the checkpoint guard', () => {
  const source = fs.readFileSync(new URL('../src/runtime.js', import.meta.url), 'utf8');
  assert.match(source, /getAssistantSnapshot:\s*deps\.assistantSnapshot/);
});

test('delay bounds reject invalid values and keep a safe default', () => {
  assert.equal(normalizeDelayMs(Number.NaN), DEFAULT_DELAY_MS);
  assert.equal(normalizeDelayMs(1), 10_000);
  assert.equal(normalizeDelayMs(99 * 60 * 60 * 1000), 24 * 60 * 60 * 1000);
});

test('manual minute input accepts arbitrary minute counts and comma decimals', () => {
  assert.equal(delayMinutesToMs('7'), 7 * 60_000);
  assert.equal(delayMinutesToMs('12,5'), 12.5 * 60_000);
  assert.equal(delayMinutesToMs('0'), null);
  assert.equal(delayMinutesToMs('abc'), null);
  assert.equal(formatDelayMinutes(7 * 60_000), '7');
  assert.equal(formatDelayMinutes(12.5 * 60_000), '12.5');
});

test('checkpoint has its own persisted fixed text and manually entered delay', () => {
  const storage = createMemoryStorage();
  const first = createHarness({ storage });
  first.controller.setDelayMinutes('17');
  first.controller.setCheckpointText('fixed checkpoint');
  assert.equal(first.controller.getDelayMinutes(), '17');
  assert.equal(first.controller.armCheckpoint(), true);
  assert.equal(first.controller.getCheckpointRemainingLabel(), '17:00');

  const second = createHarness({ storage });
  assert.equal(second.controller.getCheckpointText(), 'fixed checkpoint');
  assert.equal(second.controller.getDelayMinutes(), '17');
});

test('second clock press cancels and the next press starts a fresh full checkpoint timer', () => {
  const h = createHarness();
  h.controller.setDelayMs(60_000);
  h.controller.setCheckpointText('checkpoint');
  assert.equal(h.controller.toggleCheckpoint(), true);
  assert.equal(h.controller.isCheckpointActive(), true);
  assert.equal(h.controller.getCheckpointRemainingLabel(), '01:00');

  assert.equal(h.controller.toggleCheckpoint(), true);
  assert.equal(h.controller.isCheckpointActive(), false);

  h.setTime(5_000);
  assert.equal(h.controller.toggleCheckpoint(), true);
  assert.equal(h.controller.getCheckpointDeadline(), 65_000);
  assert.equal(h.controller.getCheckpointRemainingLabel(), '01:00');
});

test('checkpoint sends its stored text instead of reading the native ChatGPT composer at arm time', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  h.composer.text = 'manual text currently in ChatGPT';
  armCheckpoint(h, 'fixed checkpoint text');

  h.setTime(31_000);
  h.controller.check();
  assert.equal(h.clicks, 0);
  assert.equal(h.composer.text, 'manual text currently in ChatGPT');

  h.composer.text = '';
  h.controller.check();
  assert.equal(h.composer.text, 'fixed checkpoint text');
  h.controller.check();
  assert.equal(h.clicks, 1);
  assert.equal(h.clickedTexts[0], 'fixed checkpoint text');
});

test('checkpoint is cancelled as soon as an assistant answer appears after arming', () => {
  const h = createHarness();
  h.controller.setDelayMs(60_000);
  armCheckpoint(h, 'should not be sent');

  h.setAssistantSnapshot(1, 'assistant answered');
  h.setTime(10_000);
  h.controller.check();

  assert.equal(h.controller.isCheckpointActive(), false);
  assert.equal(h.clicks, 0);
  assert.equal(h.composer.text, '');
  assert.match(h.controller.getLastStatus(), /Ответ ChatGPT уже получен/);
});

test('checkpoint guard clears its owned composer text if the answer arrives between insertion and Send', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  armCheckpoint(h, 'checkpoint race');

  h.setTime(31_000);
  h.controller.check();
  assert.equal(h.composer.text, 'checkpoint race');
  assert.equal(h.clicks, 0);

  h.setAssistantSnapshot(1, 'answer completed during the final guard window');
  h.controller.check();
  assert.equal(h.clicks, 0);
  assert.equal(h.composer.text, '');
  assert.equal(h.controller.isCheckpointActive(), false);
});

test('persisted checkpoint does not fire after sleep when an answer arrived while JavaScript was suspended', () => {
  const storage = createMemoryStorage();
  const first = createHarness({ storage });
  first.controller.setDelayMs(30_000);
  armCheckpoint(first, 'sleep guard checkpoint');

  const second = createHarness({ storage });
  second.setAssistantSnapshot(1, 'answer received while tab slept');
  second.setTime(90_000);
  second.controller.check();

  assert.equal(second.clicks, 0);
  assert.equal(second.composer.text, '');
  assert.equal(second.controller.isCheckpointActive(), false);
});

test('checkpoint waits for assistant snapshot hydration after reload instead of sending blindly', () => {
  const storage = createMemoryStorage();
  const first = createHarness({ storage });
  first.setAssistantSnapshot(2, 'previous assistant answer');
  first.controller.setDelayMs(30_000);
  armCheckpoint(first, 'wait for hydration');

  const second = createHarness({ storage }); // current DOM snapshot is temporarily 0 messages
  second.setTime(90_000);
  second.controller.check();
  assert.equal(second.clicks, 0);
  assert.equal(second.composer.text, '');
  assert.equal(second.controller.isCheckpointActive(), true);

  second.setAssistantSnapshot(2, 'previous assistant answer');
  second.controller.check();
  second.controller.check();
  assert.equal(second.clicks, 1);
});

test('assistant answers do not cancel ordinary delayed-list messages', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  h.controller.addScheduled('ordinary delayed message');
  h.setAssistantSnapshot(1, 'assistant answer unrelated to the delayed list');

  runDueSend(h, 31_000);
  assert.equal(h.clicks, 1);
  assert.equal(h.clickedTexts[0], 'ordinary delayed message');
});

test('absolute checkpoint deadline catches up after a long sleeping-tab pause', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  armCheckpoint(h, 'wake checkpoint');

  runDueSend(h, 95_000); // Runtime did not execute while the tab was sleeping.
  assert.equal(h.clicks, 1);
  assert.equal(h.controller.isConfirmingSend(), true);

  h.setGenerating(true);
  h.controller.check();
  assert.equal(h.controller.isCheckpointActive(), false);
});

test('persisted waiting checkpoint survives controller recreation and sends after wake', () => {
  const storage = createMemoryStorage();
  const first = createHarness({ storage });
  first.controller.setDelayMs(30_000);
  armCheckpoint(first, 'persisted checkpoint');

  const second = createHarness({ storage });
  runDueSend(second, 90_000);
  assert.equal(second.clicks, 1);
  assert.equal(second.clickedTexts[0], 'persisted checkpoint');
});

test('standard plus-panel text can be added to a separate delayed-message list', () => {
  const h = createHarness();
  h.controller.setDelayMs(60_000);
  const firstId = h.controller.addScheduled('first delayed message');
  assert.ok(firstId);
  h.setTime(10_000);
  const secondId = h.controller.addScheduled('second delayed message');
  assert.ok(secondId);

  const items = h.controller.getScheduledItems();
  assert.equal(items.length, 2);
  assert.equal(items[0].text, 'first delayed message');
  assert.equal(items[0].remainingLabel, '00:50');
  assert.equal(items[1].text, 'second delayed message');
  assert.equal(items[1].remainingLabel, '01:00');
  assert.equal(h.controller.isCheckpointActive(), false);
});

test('due delayed-list item is injected and sent without overwriting unrelated user text', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  h.controller.addScheduled('scheduled text');
  h.composer.text = 'user draft';

  h.setTime(31_000);
  h.controller.check();
  assert.equal(h.clicks, 0);
  assert.equal(h.composer.text, 'user draft');
  assert.equal(h.controller.getScheduledItems().length, 1);

  h.composer.text = '';
  h.controller.check();
  assert.equal(h.composer.text, 'scheduled text');
  h.controller.check();
  assert.equal(h.clicks, 1);
  h.setGenerating(true);
  h.controller.check();
  assert.equal(h.controller.getScheduledItems().length, 0);
});

test('scheduled messages persist across recreation and retain absolute deadlines', () => {
  const storage = createMemoryStorage();
  const first = createHarness({ storage });
  first.controller.setDelayMs(30_000);
  first.controller.addScheduled('persist me');

  const second = createHarness({ storage });
  runDueSend(second, 90_000);
  assert.equal(second.clicks, 1);
  assert.equal(second.clickedTexts[0], 'persist me');
});

test('pipeline busy state postpones due scheduled work without dropping it', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  h.controller.addScheduled('wait for queue');
  h.setPipelineBusy(true);
  h.setTime(31_000);
  h.controller.check();
  assert.equal(h.composer.text, '');
  assert.equal(h.clicks, 0);
  assert.equal(h.controller.getScheduledItems().length, 1);

  h.setPipelineBusy(false);
  h.controller.check();
  h.controller.check();
  assert.equal(h.clicks, 1);
});

test('navigation clears route-bound checkpoint and delayed-list jobs instead of sending in another chat', () => {
  const h = createHarness();
  armCheckpoint(h, 'checkpoint');
  h.controller.addScheduled('scheduled');
  h.setRoute('https://chatgpt.com/c/other');
  h.controller.check();
  assert.equal(h.controller.isCheckpointActive(), false);
  assert.equal(h.controller.getScheduledItems().length, 0);
  assert.equal(h.clicks, 0);
});

test('confirmation requires generation or consumption of the exact clicked composer', () => {
  assert.deepEqual(
    evaluateDelayedSendConfirmation({ generationActive: true }),
    { confirmed: true, reason: 'generation-started' }
  );
  assert.deepEqual(
    evaluateDelayedSendConfirmation({ clickedComposerConnected: true, clickedComposerHasText: false }),
    { confirmed: true, reason: 'clicked-composer-consumed' }
  );
  assert.deepEqual(
    evaluateDelayedSendConfirmation({ clickedComposerConnected: false, clickedComposerHasText: false }),
    { confirmed: false, reason: 'waiting' }
  );
});
