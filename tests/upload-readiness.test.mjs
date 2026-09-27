import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { SETTINGS } = require('../src/config.js');
const { evaluateUploadReadiness, evaluateUploadSendConfirmation, shouldRetryUploadSend } = require('../src/upload-auto-send.js');

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

test('send confirmation accepts actual generation start', () => {
  assert.deepEqual(
    evaluateUploadSendConfirmation({ generationActive: true }),
    { confirmed: true, reason: 'generation-started' }
  );
});

test('send confirmation accepts consumed attachment only when Send also became unavailable', () => {
  assert.deepEqual(
    evaluateUploadSendConfirmation({
      attachmentBefore: true,
      attachmentNow: false,
      sendReadyNow: false
    }),
    { confirmed: true, reason: 'attachment-consumed' }
  );
});

test('send confirmation does not accept attachment disappearance while Send is still ready', () => {
  assert.deepEqual(
    evaluateUploadSendConfirmation({
      attachmentBefore: true,
      attachmentNow: false,
      sendReadyNow: true
    }),
    { confirmed: false, reason: 'waiting' }
  );
});

test('send confirmation accepts consumed file input with unavailable Send', () => {
  assert.deepEqual(
    evaluateUploadSendConfirmation({
      fileInputBefore: true,
      fileInputNow: false,
      sendReadyNow: false
    }),
    { confirmed: true, reason: 'file-input-consumed' }
  );
});

test('transient missing composer context is never treated as send confirmation', () => {
  assert.deepEqual(
    evaluateUploadSendConfirmation({
      contextAvailable: false,
      sendReadyNow: false,
      currentStrongFileEvidence: false,
      elapsedSinceClickMs: 500
    }),
    { confirmed: false, reason: 'composer-context-missing' }
  );
});

test('consumption from a replaced composer is not enough to confirm send', () => {
  assert.deepEqual(
    evaluateUploadSendConfirmation({
      contextAvailable: true,
      sameComposerContext: false,
      attachmentBefore: true,
      attachmentNow: false,
      sendReadyNow: false
    }),
    { confirmed: false, reason: 'waiting' }
  );
});


test('retry is allowed when strong current file evidence still proves the unchanged payload is waiting', () => {
  assert.equal(shouldRetryUploadSend({
    elapsedSinceClickMs: 1900,
    clickCount: 1,
    sendReadyNow: true,
    busy: false,
    currentStrongFileEvidence: true,
    composerUnchanged: true
  }), true);
});

test('strong file evidence does not allow retry after composer text changed', () => {
  assert.equal(shouldRetryUploadSend({
    elapsedSinceClickMs: 3000,
    clickCount: 1,
    sendReadyNow: true,
    busy: false,
    currentStrongFileEvidence: true,
    composerUnchanged: false
  }), false);
});

test('fallback-only retry requires the exact same ready button and unchanged composer for longer', () => {
  assert.equal(shouldRetryUploadSend({
    elapsedSinceClickMs: 2600,
    clickCount: 1,
    sendReadyNow: true,
    busy: false,
    currentStrongFileEvidence: false,
    sameReadyButton: true,
    sameComposerContext: true,
    composerUnchanged: true
  }), true);
});

test('fallback-only retry is blocked after a composer/button transition', () => {
  assert.equal(shouldRetryUploadSend({
    elapsedSinceClickMs: 3000,
    clickCount: 1,
    sendReadyNow: true,
    busy: false,
    currentStrongFileEvidence: false,
    sameReadyButton: false,
    sameComposerContext: false,
    composerUnchanged: true
  }), false);
});

test('fallback-only retry is blocked when React replaced composer even if Send node survived', () => {
  assert.equal(shouldRetryUploadSend({
    elapsedSinceClickMs: 3000,
    clickCount: 1,
    sendReadyNow: true,
    busy: false,
    currentStrongFileEvidence: false,
    sameReadyButton: true,
    sameComposerContext: false,
    composerUnchanged: true
  }), false);
});
