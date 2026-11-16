// Tuning harness for motion rules (core/motion.js), mainly "spread".
//
//   node tools/spread_tune.mjs [ms=3000]
//
// Runs each rule in VARIANTS on a set of graphs straight from motion.simulate (no Lua) and prints,
// per graph: x = line crossings, d = closest two nodes (under 48 = circles overlap), m = how far
// the most-moving node travelled in the last 0.5 s (small = settled).
// Today's "spread" (2026-11-16): crossings 0 on trees; a square cycle can settle as a bow-tie
// (1 crossing) from some starts; everything settles within 3 s.
// To try an idea, add a variant (copy RULES.spread into it and change constants), compare, then
// move the winner into core/motion.js and re-run tools/layout_check.mjs on examples/untangle.lua.

import { simulate, RULES } from '../core/motion.js';

const SQUARE = [[1, 2], [2, 3], [3, 4], [4, 1], [1, 5], [2, 6], [3, 7], [4, 8]];
const GRAPHS = {
  clump: { nodes: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => [290 + ((i * 37) % 60), 150 + ((i * 53) % 70)]), edges: SQUARE },
  scatter: { nodes: [[120, 80], [520, 280], [140, 290], [500, 70], [330, 200], [300, 120], [360, 60], [250, 300]], edges: SQUARE },
  tree: { nodes: [[320, 40], [100, 300], [500, 300], [50, 100], [150, 100], [450, 100], [600, 200]], edges: [[1, 2], [1, 3], [2, 4], [2, 5], [3, 6], [3, 7]] },
  stage: { nodes: [[100, 180], [270, 90], [270, 270], [440, 180]], edges: [[1, 2], [1, 3], [2, 4]] },
  grid: {
    nodes: [[100, 100], [500, 300], [300, 60], [120, 300], [550, 90], [320, 320], [200, 200], [420, 180], [60, 180]],
    edges: [[1, 2], [2, 3], [4, 5], [5, 6], [7, 8], [8, 9], [1, 4], [4, 7], [2, 5], [5, 8], [3, 6], [6, 9]],
  },
};

const VARIANTS = {
  'spread (current)': RULES.spread,
  // 'my idea': (b, w) => { ... return [ax, ay]; },
};

const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
function score(rule, ms) {
  return Object.entries(GRAPHS).map(([name, g]) => {
    const bodies = g.nodes.map(([x, y], i) => ({ id: i + 1, x, y, vx: 0, vy: 0, half: { x: 24, y: 24 }, moves: true }));
    const edges = g.edges.map(([a, b]) => ({ a, b }));
    const { paths } = simulate({ bodies, edges, durMs: ms, rule });
    const P = (id) => bodies[id - 1];
    let cross = 0;
    for (const [i, e] of edges.entries()) {
      for (const f of edges.slice(i + 1)) {
        if ([e.a, e.b].some((x) => x === f.a || x === f.b)) continue;
        const [a, b, c, d] = [P(e.a), P(e.b), P(f.a), P(f.b)];
        if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) cross++;
      }
    }
    let minD = Infinity;
    for (const a of bodies) for (const b of bodies) if (a !== b) minD = Math.min(minD, Math.hypot(a.x - b.x, a.y - b.y));
    const late = Math.max(...[...paths.values()].map((p) => {
      const n = p.length / 2 - 1, k = Math.max(0, n - 50);
      return Math.hypot(p[2 * n] - p[2 * k], p[2 * n + 1] - p[2 * k + 1]);
    }));
    return `${name}: x${cross} d${Math.round(minD)} m${late.toFixed(0)}`;
  }).join(' | ');
}

const ms = Number(process.argv[2]) || 3000;
for (const [name, rule] of Object.entries(VARIANTS)) console.log(`${name} :: ${score(rule, ms)}`);
