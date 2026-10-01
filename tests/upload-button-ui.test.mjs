import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const { clampFloatingPosition } = require('../src/upload-button-ui.js');

test('floating controls stay inside viewport bounds', () => {
  assert.deepEqual(clampFloatingPosition({ left: -100, top: -50 }, 1000, 800), { left: 6, top: 6 });
  assert.deepEqual(clampFloatingPosition({ left: 9999, top: 9999 }, 1000, 800), { left: 880, top: 760 });
});

test('floating controls preserve valid user position', () => {
  assert.deepEqual(clampFloatingPosition({ left: 123, top: 456 }, 1000, 800), { left: 123, top: 456 });
});


test('queue UI keeps open Shadow DOM for ChatGPT focus compatibility', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/upload-button-ui.js', import.meta.url)), 'utf8');
  assert.match(source, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.doesNotMatch(source, /attachShadow\(\{ mode: 'closed' \}\)/);
});


test('floating UI includes delayed-send button and compact timer chip', () => {
  const source = fs.readFileSync(fileURLToPath(new URL('../src/upload-button-ui.js', import.meta.url)), 'utf8');
  assert.match(source, /data-role="delay-send"/);
  assert.match(source, /class="meta-chip timer-chip"/);
  assert.match(source, /Отложенная отправка/);
});
