// Layouts: compute where objects should go; the Lua API then moves them there (so a layout is just
// a set of ordinary moves, and every frame stays exact).

import { CANVAS } from './scene.js';

const MARGIN = 40, MAX_GAP_X = 80, MAX_GAP_Y = 80;

/**
 * Tidy tree positions for the tree reached from `root` (any connected nodes; the first path found
 * from the root decides who is whose parent). Children go left to right in their current x order.
 * A single child keeps its side (left or right of its parent, as it is now), so a binary search
 * tree still reads correctly. The tree keeps its top (the root goes where the highest of its nodes
 * is now, so after a rotation the new root rises); it is centred on the canvas.
 *
 * scene: provides neighbors(id); posOf(id) -> {x, y} now. Returns Map(id -> {x, y}).
 */
export function treeLayout(scene, root, posOf) {
  // parent/children by breadth-first search from the root
  const children = new Map([[root, []]]);
  const depth = new Map([[root, 0]]);
  const queue = [root];
  while (queue.length) {
    const v = queue.shift();
    for (const n of scene.neighbors(v)) {
      if (children.has(n)) continue;
      children.set(n, []);
      depth.set(n, depth.get(v) + 1);
      children.get(v).push(n);
      queue.push(n);
    }
  }
  const x = (id) => posOf(id).x;

  // Leaves (and the empty side of a single child) take one slot each, left to right;
  // a parent sits midway between its first and last child.
  const slot = new Map();
  let next = 0;
  const place = (v) => {
    const kids = children.get(v).sort((a, b) => x(a) - x(b));
    if (!kids.length) { slot.set(v, next++); return; }
    const sides = kids.length === 1 ? (x(kids[0]) < x(v) ? [kids[0], null] : [null, kids[0]]) : kids;
    const at = sides.map((k) => {
      if (k === null) return next++;
      place(k);
      return slot.get(k);
    });
    slot.set(v, (at[0] + at.at(-1)) / 2);
  };
  place(root);

  const slots = next;
  const maxDepth = Math.max(...depth.values());
  const gapX = Math.min(MAX_GAP_X, (CANVAS.width - 2 * MARGIN) / Math.max(1, slots - 1));
  const highest = Math.min(...[...depth.keys()].map((id) => posOf(id).y));
  const top = Math.min(Math.max(MARGIN, highest), CANVAS.height - MARGIN - maxDepth * 30);
  const gapY = maxDepth ? Math.min(MAX_GAP_Y, (CANVAS.height - MARGIN - top) / maxDepth) : 0;
  const left = CANVAS.width / 2 - (gapX * (slots - 1)) / 2;

  const out = new Map();
  for (const [v, s] of slot) out.set(v, { x: Math.round(left + s * gapX), y: Math.round(top + depth.get(v) * gapY) });
  return out;
}
