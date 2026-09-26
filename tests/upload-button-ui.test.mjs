import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { clampFloatingPosition } = require('../src/upload-button-ui.js');

test('floating controls stay inside viewport bounds', () => {
  assert.deepEqual(clampFloatingPosition({ left: -100, top: -50 }, 1000, 800), { left: 6, top: 6 });
  assert.deepEqual(clampFloatingPosition({ left: 9999, top: 9999 }, 1000, 800), { left: 920, top: 760 });
});

test('floating controls preserve valid user position', () => {
  assert.deepEqual(clampFloatingPosition({ left: 123, top: 456 }, 1000, 800), { left: 123, top: 456 });
});
