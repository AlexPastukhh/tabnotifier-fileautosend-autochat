import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { clampFloatingPosition } = require('../src/upload-button-ui.js');

function source() {
  return fs.readFileSync(fileURLToPath(new URL('../src/upload-button-ui.js', import.meta.url)), 'utf8');
}

test('floating controls stay inside viewport bounds', () => {
  assert.deepEqual(clampFloatingPosition({ left: -100, top: -50 }, 1000, 800), { left: 6, top: 6 });
  assert.deepEqual(clampFloatingPosition({ left: 9999, top: 9999 }, 1000, 800), { left: 880, top: 760 });
});

test('floating controls preserve valid user position', () => {
  assert.deepEqual(clampFloatingPosition({ left: 123, top: 456 }, 1000, 800), { left: 123, top: 456 });
});

test('queue UI keeps open Shadow DOM for ChatGPT focus compatibility', () => {
  const text = source();
  assert.match(text, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.doesNotMatch(text, /attachShadow\(\{ mode: 'closed' \}\)/);
});

test('floating UI keeps checkpoint clock and compact timer chip', () => {
  const text = source();
  assert.match(text, /data-role="delay-send"/);
  assert.match(text, /class="meta-chip timer-chip"/);
  assert.match(text, /Чекпоинт по таймеру/);
  assert.match(text, /toggleCheckpoint/);
});

test('checkpoint has a dedicated text field separate from the normal plus-panel composer', () => {
  const text = source();
  assert.match(text, /class="checkpoint-input"/);
  assert.match(text, /Фиксированный текст чекпоинта/);
  assert.match(text, /class="queue-input"/);
  assert.match(text, /setCheckpointText/);
});

test('plus-panel composer can add text to a distinct delayed-message list', () => {
  const text = source();
  assert.match(text, /class="schedule-later"[^>]*>Отправить позже</);
  assert.match(text, /class="delayed-list"/);
  assert.match(text, /Отправятся позже/);
  assert.match(text, /addScheduled\?\.\(ui\.textarea\.value\)/);
  assert.match(text, /removeScheduled/);
});

test('delayed-send settings include manual minute entry shared by checkpoint and delayed list', () => {
  const text = source();
  assert.match(text, /class="delay-minutes"/);
  assert.match(text, /Свои минуты/);
  assert.match(text, /setDelayMinutes/);
  assert.match(text, /и для чекпоинта ◷, и для кнопки «Отправить позже»/);
});

test('checkpoint button renders active state immediately after toggle', () => {
  const text = source();
  assert.match(
    text,
    /ui\.delayButton\.addEventListener\('click',[\s\S]*?delayedSendController\?\.toggleCheckpoint\?\.\(\);[\s\S]*?render\(\);/
  );
});
