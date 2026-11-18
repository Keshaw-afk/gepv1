import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arrange } from '../core/arrange.js';
import { Scene } from '../core/scene.js';

const n = (id, x, y, shape = 'circle', size = 1) => ({ id, x, y, shape, label: '', size });
const at = (list) => Object.fromEntries(list.map((m) => [m.id, [m.x, m.y]]));

test('align uses the real edges of shapes of different sizes', () => {
  const nodes = [n(1, 100, 50), n(2, 300, 120, 'circle', 2), n(3, 200, 200, 'rect')];
  // left edges: 76, 252, 168 -> all at 76; then they'd overlap, so 2 and 3 move down (gap 30)
  assert.deepEqual(at(arrange(nodes, 'left')), { 2: [124, 152], 3: [108, 250] });
  // top edges: 26, 72, 180 -> all at 26: the big circle (half 48) sits at 74
  assert.deepEqual(at(arrange(nodes, 'top')), { 2: [300, 74], 3: [200, 46] });
  // vertical middle: the group spans y 26 (top of node 1) to 220 (bottom of node 3), so 123
  assert.deepEqual(at(arrange(nodes, 'vcenter')), { 1: [100, 123], 2: [300, 123], 3: [200, 123] });
  // right edges: 124, 348, 232 -> all at 348
  assert.deepEqual(at(arrange(nodes, 'right')), { 1: [324, 50], 2: [300, 152], 3: [316, 250] });
});

test('lining up a row the other way never piles objects on top of each other', () => {
  const row = [n(1, 100, 300), n(2, 270, 300), n(3, 440, 300)];
  const col = at(arrange(row, 'hcenter'));
  const ys = [1, 2, 3].map((id) => col[id][1]);
  assert.ok(ys.every((y, i) => i === 0 || y - ys[i - 1] >= 48 + 30), `apart: ${ys}`);
  assert.ok(Math.max(...ys) + 24 <= 360, 'still on the canvas (shifted back up)');
  assert.ok(new Set([1, 2, 3].map((id) => col[id][0])).size === 1, 'one column');
  // objects that don't touch stay where they are on the other axis
  assert.deepEqual(at(arrange([n(1, 100, 50), n(2, 300, 250)], 'left')), { 2: [100, 250] });
});

test('spread keeps the outer two and gives equal gaps, in the order they already have', () => {
  const nodes = [n(1, 100, 100), n(2, 130, 100), n(3, 500, 100), n(4, 200, 100)];
  const moved = at(arrange(nodes, 'hspread'));
  // outer edges 76 and 524; four circles 48 wide leave 3 equal gaps of (448 - 192) / 3
  const gap = (448 - 192) / 3;
  assert.equal(moved[1], undefined, 'the leftmost stays');
  assert.equal(moved[3], undefined, 'the rightmost stays');
  assert.equal(moved[2][0], Math.round(76 + 48 + gap + 24));   // second from the left is node 2
  assert.equal(moved[4][0], Math.round(76 + 2 * 48 + 2 * gap + 24));
  assert.deepEqual(arrange(nodes.slice(0, 2), 'hspread'), [], 'two objects have nothing to spread');
  assert.deepEqual(arrange([n(1, 5, 5)], 'left'), []);
  assert.throws(() => arrange(nodes, 'diagonal'), /unknown arrangement/);
});

test('a scene survives being saved as plain data and rebuilt (undo and autosave use this)', () => {
  const s = new Scene();
  const a = s.addNode('A', 10, 20, 'rect', 1.5), b = s.addNode('B', 30, 40);
  s.addEdge(a, b, true);
  const copy = Scene.from(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(copy.toJSON(), s.toJSON());
  assert.equal(copy.addNode('C', 1, 1), s.nextId, 'ids carry on from where they were');
});
