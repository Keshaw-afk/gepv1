// Arranging several objects at once: align them to an edge or centre, or spread them out evenly.
// Pure geometry (no page, no steps) so the stage and the Behaviour tab share it and tests can check it.
//
//   arrange(nodes, kind) -> [{ id, x, y }]   the new centre of every node that has to move
//     nodes  [{ id, shape, label, x, y, size }]
//     kind   'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hspread' | 'vspread'
// Aligning uses each shape's real edge (a big circle and a small one line up at their left sides, not
// their centres). Objects that would end up on top of each other (lining up a row along the other
// direction) are moved apart the other way, keeping their order, so nothing ever hides another.
// Spreading keeps the two outermost objects where they are and gives the others equal gaps between
// their edges, in the order they already have.

import { halfSize } from './shapes.js';
import { CANVAS } from './scene.js';

export const ARRANGE_GAP = 30; // the gap left between two objects that had to be pushed apart

export const ARRANGE_KINDS = ['left', 'hcenter', 'right', 'top', 'vcenter', 'bottom', 'hspread', 'vspread'];

export function arrange(nodes, kind) {
  if (nodes.length < 2) return [];
  const half = (n) => halfSize(n.shape ?? 'circle', n.label, n.size ?? 1);
  const horizontal = ['left', 'hcenter', 'right', 'hspread'].includes(kind);
  const axis = horizontal ? 'x' : 'y';
  const h = (n) => half(n)[axis];
  const lo = (n) => n[axis] - h(n), hi = (n) => n[axis] + h(n);
  const out = [];
  const place = (n, v) => { if (Math.abs(v - n[axis]) > 0.01) out.push({ id: n.id, x: n.x, y: n.y, [axis]: Math.round(v) }); };

  if (['left', 'top', 'right', 'bottom', 'hcenter', 'vcenter'].includes(kind)) {
    let target;
    if (kind === 'left' || kind === 'top') { const edge = Math.min(...nodes.map(lo)); target = (n) => edge + h(n); }
    else if (kind === 'right' || kind === 'bottom') { const edge = Math.max(...nodes.map(hi)); target = (n) => edge - h(n); }
    else { const mid = (Math.min(...nodes.map(lo)) + Math.max(...nodes.map(hi))) / 2; target = () => mid; }
    const placed = nodes.map((n) => ({ ...n, [axis]: Math.round(target(n)) }));
    separate(placed, horizontal ? 'y' : 'x', half);
    return placed.filter((p, i) => p.x !== nodes[i].x || p.y !== nodes[i].y).map(({ id, x, y }) => ({ id, x, y }));
  } else if (kind === 'hspread' || kind === 'vspread') {
    if (nodes.length < 3) return [];
    const sorted = [...nodes].sort((a, b) => a[axis] - b[axis]);
    const span = hi(sorted.at(-1)) - lo(sorted[0]);
    const gap = (span - sorted.reduce((sum, n) => sum + 2 * h(n), 0)) / (sorted.length - 1);
    let at = lo(sorted[0]);
    for (const n of sorted) { place(n, at + h(n)); at += 2 * h(n) + gap; }
  } else {
    throw new Error(`unknown arrangement '${kind}'`);
  }
  return out;
}

/**
 * Pushes overlapping objects apart along `axis` (in place), keeping their order on that axis.
 * Only objects that overlap on the other axis too can collide. If the group then runs off the
 * canvas it is shifted back as a whole.
 */
function separate(list, axis, half) {
  const other = axis === 'x' ? 'y' : 'x';
  const h = (n) => half(n)[axis], k = (n) => half(n)[other];
  const order = list.map((n, i) => [n, i]).sort((a, b) => a[0][axis] - b[0][axis] || a[1] - b[1]).map(([n]) => n);
  let pushed = false;
  for (let i = 1; i < order.length; i++) {
    const n = order[i];
    // only objects that really overlap move; they then keep a clear gap
    const hit = order.slice(0, i).filter((m) => Math.abs(m[other] - n[other]) < k(m) + k(n) && n[axis] - h(n) < m[axis] + h(m));
    if (!hit.length) continue;
    n[axis] = Math.round(Math.max(...hit.map((m) => m[axis] + h(m) + ARRANGE_GAP + h(n))));
    pushed = true;
  }
  if (!pushed) return;
  const size = axis === 'x' ? CANVAS.width : CANVAS.height;
  const over = Math.max(...list.map((n) => n[axis] + h(n))) - size;
  const room = Math.min(...list.map((n) => n[axis] - h(n)));
  const shift = over > 0 ? -Math.min(over, Math.max(0, room)) : 0;
  for (const n of list) n[axis] = Math.round(n[axis] + shift);
}
