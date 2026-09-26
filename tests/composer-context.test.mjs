import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { scoreComposerCandidateMeta } = require('../src/chatgpt-dom.js');

test('native ChatGPT composer outranks a much larger generic textarea', () => {
  const nativeScore = scoreComposerCandidateMeta({
    selectorIndex: 0,
    area: 9000,
    isPromptTextarea: true,
    isContentEditable: true,
    isRoleTextbox: true,
    hasComposerControls: true,
    hasSendButton: true
  });
  const genericScore = scoreComposerCandidateMeta({
    selectorIndex: 9,
    area: 900000,
    hasComposerControls: false,
    hasSendButton: false
  });
  assert.ok(nativeScore > genericScore);
});

test('ownership by composer controls outweighs raw visual area', () => {
  const ownedScore = scoreComposerCandidateMeta({
    selectorIndex: 8,
    area: 12000,
    isContentEditable: true,
    isRoleTextbox: true,
    hasComposerControls: true,
    hasSendButton: true
  });
  const unownedScore = scoreComposerCandidateMeta({
    selectorIndex: 7,
    area: 700000,
    isContentEditable: true,
    isRoleTextbox: true,
    hasComposerControls: false,
    hasSendButton: false
  });
  assert.ok(ownedScore > unownedScore);
});
