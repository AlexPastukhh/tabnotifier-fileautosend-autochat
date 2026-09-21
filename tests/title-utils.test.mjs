import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { cleanTitle, removeUnpairedSurrogates, faviconSvg } = require('../src/title-utils.js');

test('cleanTitle removes notifier prefixes without corrupting title', () => {
  assert.equal(cleanTitle('⇧ ⏳ ● ✓ ChatGPT'), 'ChatGPT');
  assert.equal(cleanTitle('ChatGPT'), 'ChatGPT');
});

test('removeUnpairedSurrogates preserves valid pairs and drops orphan surrogate', () => {
  assert.equal(removeUnpairedSurrogates('A\uD83D\uDD14B'), 'A🔔B');
  assert.equal(removeUnpairedSurrogates('A\uDD14B'), 'AB');
});

test('faviconSvg returns data URI for known state', () => {
  assert.match(faviconSvg('uploading'), /^data:image\/svg\+xml,/);
  assert.equal(faviconSvg('idle'), '');
});
