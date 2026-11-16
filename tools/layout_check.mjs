// Layout check: how tidy is the picture at the end of a program?
//
//   node tools/layout_check.mjs examples/untangle.lua [stage.lua]
//
// Runs the program and reports, for the final picture: line crossings (lines that share an end
// don't count), the closest two nodes (circles are 48 px wide, so under 48 they overlap) and the
// bounding box. Used to tune the "spread" rule (core/motion.js) and to pick example starts.
// Expected today: examples/untangle.lua -> 0 crossings, closest 63.

import fengari from 'fengari';
import fs from 'node:fs';
import { runProgram } from '../core/lua_api.js';
import { sceneAt } from '../core/player.js';

const [scriptFile, stageFile] = process.argv.slice(2);
if (!scriptFile) { console.error('usage: node tools/layout_check.mjs script.lua [stage.lua]'); process.exit(2); }
const { timeline } = runProgram(fengari, {
  stage: stageFile ? fs.readFileSync(stageFile, 'utf8') : '',
  script: fs.readFileSync(scriptFile, 'utf8'),
});
const st = sceneAt(timeline, timeline.durationMs);
const P = new Map(st.nodes.map((n) => [n.id, n]));
const ccw = (a, b, c) => (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
let crossings = 0;
for (const e of st.edges) {
  for (const f of st.edges) {
    if (e.id >= f.id || [e.a, e.b].some((x) => x === f.a || x === f.b)) continue;
    const [a, b, c, d] = [P.get(e.a), P.get(e.b), P.get(f.a), P.get(f.b)];
    if (ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d)) crossings++;
  }
}
let closest = Infinity;
for (const a of st.nodes) for (const b of st.nodes) if (a !== b) closest = Math.min(closest, Math.hypot(a.x - b.x, a.y - b.y));
const xs = st.nodes.map((n) => n.x), ys = st.nodes.map((n) => n.y);
const r = Math.round;
console.log(`crossings ${crossings} · closest ${r(closest)} · x ${r(Math.min(...xs))}–${r(Math.max(...xs))} · y ${r(Math.min(...ys))}–${r(Math.max(...ys))}`);
