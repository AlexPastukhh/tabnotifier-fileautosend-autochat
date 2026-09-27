import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(path.join(here, '../src/upload-auto-send.js'), 'utf8');

test('file auto-send uses the coherent composer-context API instead of independent composer/form lookups', () => {
  assert.match(source, /deps\.findComposerContext\(document\)/);
  assert.doesNotMatch(source, /deps\.findComposerForm\(/);
  assert.doesNotMatch(source, /deps\.findComposer\(/);
});

test('file auto-send stores clicked composer identity and rejects transient missing-context confirmation', () => {
  assert.match(source, /sendAttempt\.lastComposer = snapshot\.composer/);
  assert.match(source, /contextAvailable: snapshot\.contextAvailable/);
  assert.match(source, /composer-context-missing/);
});
