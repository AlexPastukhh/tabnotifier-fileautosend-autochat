import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const {
  shouldClearComposerTransfer,
  evaluateQueueSendConfirmation
} = require('../src/queued-prompt.js');

test('transfer clears only the same normalized composer text', () => {
  assert.equal(shouldClearComposerTransfer(' hello\nworld ', 'hello\nworld'), true);
  assert.equal(shouldClearComposerTransfer('new user text', 'hello\nworld'), false);
  assert.equal(shouldClearComposerTransfer('', 'hello'), false);
});

test('queue send confirms on generation start', () => {
  assert.deepEqual(
    evaluateQueueSendConfirmation({ generationActive: true, clickedComposerConnected: false }),
    { confirmed: true, reason: 'generation-started' }
  );
});

test('queue send confirms when the exact clicked composer is consumed', () => {
  assert.deepEqual(
    evaluateQueueSendConfirmation({ clickedComposerConnected: true, clickedComposerHasText: false }),
    { confirmed: true, reason: 'clicked-composer-consumed' }
  );
});

test('React replacement with another empty composer is not enough to drop a queue item', () => {
  assert.deepEqual(
    evaluateQueueSendConfirmation({
      generationActive: false,
      clickedComposerConnected: false,
      clickedComposerHasText: false
    }),
    { confirmed: false, reason: 'waiting' }
  );
});
