// Arranging several objects at once: align them to an edge or centre, or spread them out evenly.
// Pure geometry (no page, no steps) so the stage and the Behaviour tab share it and tests can check it.
//
//   arrange(nodes, kind) -> [{ id, x, y }]   the new centre of every node that has to move
//     nodes  [{ id, shape, label, x, y, size }]
//     kind   'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom' | 'hspread' | 'vspread'
// Aligning uses each shape's real edge (a big circle and a small one line up at their left sides, not
// their centres). Spreading keeps the two outermost objects where they are and gives the others
// equal gaps between their edges, in the order they already have.

import { halfSize } from './shapes.js';

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

  if (kind === 'left' || kind === 'top') {
    const edge = Math.min(...nodes.map(lo));
    for (const n of nodes) place(n, edge + h(n));
  } else if (kind === 'right' || kind === 'bottom') {
    const edge = Math.max(...nodes.map(hi));
    for (const n of nodes) place(n, edge - h(n));
  } else if (kind === 'hcenter' || kind === 'vcenter') {
    const mid = (Math.min(...nodes.map(lo)) + Math.max(...nodes.map(hi))) / 2;
    for (const n of nodes) place(n, mid);
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
