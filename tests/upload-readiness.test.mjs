import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SETTINGS } = require('../src/config.js');
const { evaluateUploadReadiness } = require('../src/upload-auto-send.js');

function base(overrides = {}) {
  return {
    attachment: true,
    busy: false,
    sendReady: true,
    hasFileRelation: true,
    armAgeMs: SETTINGS.uploadMinArmDelayMs + 1,
    readyAgeMs: SETTINGS.uploadReadyStableMs + 1,
    ...overrides
  };
}

test('upload readiness requires attachment', () => {
  assert.deepEqual(evaluateUploadReadiness(base({ attachment: false })), { ready: false, reason: 'no-attachment' });
});

test('upload readiness rejects busy composer', () => {
  assert.deepEqual(evaluateUploadReadiness(base({ busy: true })), { ready: false, reason: 'upload-busy' });
});

test('upload readiness requires stable ready period', () => {
  assert.deepEqual(evaluateUploadReadiness(base({ readyAgeMs: 1 })), { ready: false, reason: 'stability-delay' });
});

test('upload readiness becomes ready only after all guards pass', () => {
  assert.deepEqual(evaluateUploadReadiness(base()), { ready: true, reason: 'ready' });
});
