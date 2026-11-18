import { test } from 'node:test';
import assert from 'node:assert/strict';
import { History } from '../web/history.js';

function setup(opts = {}) {
  const page = { text: 'a' };
  const kept = [];
  const h = new History({ snapshot: () => page.text, restore: (s) => { page.text = s; }, onCommit: (s) => kept.push(s), settleMs: 5, ...opts });
  return { page, h, kept };
}

test('undo and redo walk through the kept snapshots; a new edit ends the redo trail', () => {
  const { page, h, kept } = setup();
  assert.equal(h.canUndo, false);
  page.text = 'ab'; h.commit();
  page.text = 'abc'; h.commit();
  assert.deepEqual(kept, ['ab', 'abc']);
  assert.ok(h.undo()); assert.equal(page.text, 'ab');
  assert.ok(h.undo()); assert.equal(page.text, 'a');
  assert.equal(h.undo(), false);
  assert.ok(h.redo()); assert.equal(page.text, 'ab');
  page.text = 'x'; h.commit(); // a different edit after undoing
  assert.equal(h.redo(), false);
  assert.ok(h.undo()); assert.equal(page.text, 'ab');
});

test('an edit that has not settled yet is kept when you undo, so nothing is lost', () => {
  const { page, h } = setup();
  page.text = 'typed';
  assert.ok(h.canUndo);
  assert.ok(h.undo());
  assert.equal(page.text, 'a');
  assert.ok(h.redo());
  assert.equal(page.text, 'typed');
});

test('a burst of changes is one undo step; restoring does not add steps', async () => {
  const { page, h, kept } = setup();
  for (const t of ['ab', 'abc', 'abcd']) { page.text = t; h.touch(); }
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(kept, ['abcd']);
  h.undo(); h.touch();
  await new Promise((r) => setTimeout(r, 30));
  assert.deepEqual(kept, ['abcd'], 'restoring is not a new edit');
  assert.equal(page.text, 'a');
});

test('the history is capped', () => {
  const { page, h } = setup({ limit: 3 });
  for (const t of ['b', 'c', 'd', 'e']) { page.text = t; h.commit(); }
  assert.equal(h.stack.length, 3);
  h.undo(); h.undo();
  assert.equal(h.undo(), false);
  assert.equal(page.text, 'c');
});
