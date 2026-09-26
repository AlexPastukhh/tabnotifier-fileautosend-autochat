import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SETTINGS } = require('../src/config.js');
const { evaluateUploadReadiness } = require('../src/upload-auto-send.js');

function base(overrides = {}) {
  return {
    attachment: true,
    activityFallback: false,
    busy: false,
    sendReady: true,
    hasFileRelation: true,
    armAgeMs: SETTINGS.uploadMinArmDelayMs + 1,
    readyAgeMs: SETTINGS.uploadReadyStableMs + 1,
    ...overrides
  };
}

test('upload readiness still requires attachment when no trusted file-activity fallback exists', () => {
  assert.deepEqual(
    evaluateUploadReadiness(base({ attachment: false, activityFallback: false })),
    { ready: false, reason: 'no-attachment' }
  );
});

test('fresh trusted file activity can replace brittle attachment-card DOM evidence', () => {
  assert.deepEqual(
    evaluateUploadReadiness(base({ attachment: false, activityFallback: true })),
    { ready: true, reason: 'ready' }
  );
});

test('activity fallback never bypasses upload-busy evidence', () => {
  assert.deepEqual(
    evaluateUploadReadiness(base({ attachment: false, activityFallback: true, busy: true })),
    { ready: false, reason: 'upload-busy' }
  );
});

test('activity fallback never bypasses a disabled Send button', () => {
  assert.deepEqual(
    evaluateUploadReadiness(base({ attachment: false, activityFallback: true, sendReady: false })),
    { ready: false, reason: 'send-not-ready' }
  );
});

test('upload readiness requires stable ready period', () => {
  assert.deepEqual(evaluateUploadReadiness(base({ readyAgeMs: 1 })), { ready: false, reason: 'stability-delay' });
});

test('upload readiness becomes ready only after all guards pass', () => {
  assert.deepEqual(evaluateUploadReadiness(base()), { ready: true, reason: 'ready' });
});
