import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const { pagePersistedHistory } = require('../src/upload-button-ui.js');
const { createPersistentMessageController } = require('../src/persisted-messages.js');

test('first page counts all local pending and archived records rather than silently hiding older ones', () => {
  const items = Array.from({ length: 63 }, (_, i) => ({ task_id: 'task_' + String(i).padStart(32, '0'),
    archive_status: i % 3 === 0 ? 'archived' : 'pending_activity' }));
  const first = pagePersistedHistory(items, 20);
  assert.deepEqual([first.visible, first.total, first.remaining, first.localPending], [20, 63, 43, 42]);
  assert.equal(first.items[0], items[0]);
  assert.equal(first.items[19], items[19]);
  const next = pagePersistedHistory(items, 40);
  assert.equal(next.remaining, 23);
  const last = pagePersistedHistory(items, 80);
  assert.equal(last.remaining, 0);
  assert.equal(last.items.at(-1), items.at(-1));
  assert.equal(items.length, 63);
});

test('empty, missing or invalid pager arguments fail predictably', () => {
  assert.equal(pagePersistedHistory(null).total, 0);
  assert.equal(pagePersistedHistory([{ archive_status: 'archived' }], -4).visible, 0);
  assert.equal(pagePersistedHistory([{ archive_status: 'pending_activity' }], NaN).visible, 1);
});

test('history UI provides a Show More affordance and never implies all local records are unarchived', () => {
  const content = fs.readFileSync(require.resolve('../src/upload-button-ui.js'), 'utf8');
  assert.match(content, /class="persisted-more"[^>]*>Показать ещё 20</);
  assert.match(content, /persistedVisibleCount \+= 20/);
  assert.match(content, /pagePersistedHistory\(allRecords, persistedVisibleCount\)/);
  assert.match(content, /В этом чате:/);
  assert.doesNotMatch(content, /Локально сохранённые запросы \(ещё не архив Observatory\)/);
});

test('storage health flags list/read failures and does not report an empty healthy history', () => {
  const fail = () => { throw new Error('simulated quota/read error'); };
  const storage = { get: () => null, set() {}, list: fail };
  const c = createPersistentMessageController({ storage, queue: {}, getConversationId: () => 'test-12345678' });
  assert.equal(c.getStorageHealth(), false);
  assert.deepEqual(c.listForChat(), []);
  const passing = createPersistentMessageController({
    storage: { get: () => null, set() {}, list: () => [] }, queue: {}, getConversationId: () => 'test-12345678'
  });
  assert.equal(passing.getStorageHealth(), true);
});
