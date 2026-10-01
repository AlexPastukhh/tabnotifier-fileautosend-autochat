import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  DEFAULT_DELAY_MS,
  normalizeDelayMs,
  formatDelayedRemaining,
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
  let clicks = 0;
  const composer = { isConnected: true, text: 'hello' };
  const button = { isConnected: true, click() { clicks += 1; } };
  const context = { composer, sendButton: button, container: {} };
  const controller = createDelayedSendController({
    storage,
    now: () => time,
    getRouteKey: () => route,
    isGenerationActive: () => generating,
    resolveContext: () => context,
    isSendReady: candidate => candidate === button && candidate.isConnected !== false,
    readText: candidate => candidate?.text || '',
    normalizeText: value => String(value || '').trim()
  });
  return {
    controller,
    composer,
    button,
    storage,
    get clicks() { return clicks; },
    setTime(value) { time = value; },
    setRoute(value) { route = value; },
    setGenerating(value) { generating = Boolean(value); }
  };
}

test('delayed timer formats countdown like a compact version chip', () => {
  assert.equal(formatDelayedRemaining(0), '00:00');
  assert.equal(formatDelayedRemaining(65_000), '01:05');
  assert.equal(formatDelayedRemaining(3_661_000), '1:01:01');
});

test('delay bounds reject invalid values and keep a safe default', () => {
  assert.equal(normalizeDelayMs(Number.NaN), DEFAULT_DELAY_MS);
  assert.equal(normalizeDelayMs(1), 10_000);
  assert.equal(normalizeDelayMs(99 * 60 * 60 * 1000), 24 * 60 * 60 * 1000);
});

test('second press cancels and the next press starts a fresh full timer', () => {
  const h = createHarness();
  h.controller.setDelayMs(60_000);
  assert.equal(h.controller.toggle(), true);
  assert.equal(h.controller.isActive(), true);
  assert.equal(h.controller.getRemainingLabel(), '01:00');

  assert.equal(h.controller.toggle(), true);
  assert.equal(h.controller.isActive(), false);

  h.setTime(5_000);
  assert.equal(h.controller.toggle(), true);
  assert.equal(h.controller.getDeadline(), 65_000);
  assert.equal(h.controller.getRemainingLabel(), '01:00');
});

test('absolute deadline catches up after a long sleeping-tab pause', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  h.controller.arm();

  h.setTime(95_000); // Runtime did not execute while the tab was sleeping.
  h.controller.check();
  assert.equal(h.clicks, 1);
  assert.equal(h.controller.isConfirmingSend(), true);

  h.composer.text = '';
  h.controller.check();
  assert.equal(h.controller.isActive(), false);
});

test('persisted waiting deadline survives controller recreation and sends once after wake', () => {
  const storage = createMemoryStorage();
  const first = createHarness({ storage });
  first.controller.setDelayMs(30_000);
  first.controller.arm();

  const second = createHarness({ storage });
  second.setTime(90_000);
  second.controller.check();
  assert.equal(second.clicks, 1);
  assert.equal(second.controller.isConfirmingSend(), true);
});

test('timer cancels instead of sending text that the user changed', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  h.controller.arm();
  h.composer.text = 'edited by user';

  h.setTime(31_000);
  h.controller.check();
  assert.equal(h.controller.isActive(), true); // grace period protects React transients
  h.setTime(31_800);
  h.controller.check();
  assert.equal(h.controller.isActive(), false);
  assert.equal(h.clicks, 0);
  assert.match(h.controller.getLastStatus(), /текст .* изменился/i);
});

test('ignored Send click can retry only while the same delayed text is still present', () => {
  const h = createHarness();
  h.controller.setDelayMs(30_000);
  h.controller.arm();
  h.setTime(30_000);
  h.controller.check();
  assert.equal(h.clicks, 1);

  h.setTime(31_700);
  h.controller.check();
  assert.equal(h.clicks, 2);

  h.setGenerating(true);
  h.controller.check();
  assert.equal(h.controller.isActive(), false);
});

test('navigation cancels a delayed send instead of sending in another chat', () => {
  const h = createHarness();
  h.controller.arm();
  h.setRoute('https://chatgpt.com/c/other');
  h.controller.check();
  assert.equal(h.controller.isActive(), false);
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
