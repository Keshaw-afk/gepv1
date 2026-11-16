// Animated SVG check: does the browser play the animated SVG exactly like the player?
//
//   node tools/animated_check.mjs            writes out/animated_check.html (open it in Chrome)
//   node tools/animated_check.mjs --web      writes web/_check.html (served by `npm start` at
//                                            http://localhost:8080/web/_check.html, for browser
//                                            automation; git-ignored, delete it afterwards)
//
// For each case below it bakes the expected state (from sceneAt) every 23 ms into a page together
// with the animated SVG. The page pauses each SVG, seeks with setCurrentTime and compares, for every
// object: position (the group's transform), fill/stroke colour, arrow points, line ends and
// visibility. The result is shown on the page and stored in window.checkResult / document.title.
//
// Expected today: 34,412 checks, 3 failures, all in "network" at t = 2100 ms. That is exactly a
// command's start instant, where Chrome's clock is half a millisecond behind (0.5 ms later it
// matches). Any other failure is a real difference. Add a case here for every new kind of animation.

import fengari from 'fengari';
import fs from 'node:fs';
import path from 'node:path';
import { runProgram } from '../core/lua_api.js';
import { sceneAt } from '../core/player.js';
import { timelineIds, paint } from '../core/svg.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ex = (f) => fs.readFileSync(path.join(root, 'examples', f), 'utf8');

const CASES = {
  dfs: { stage: ex('stage.lua'), script: ex('dfs.lua') },
  rotation: { script: ex('rotation.lua') },
  network: { script: ex('network.lua') },
  untangle: { script: ex('untangle.lua') },
  rules: { script: ex('rules.lua') },
  // every shape, arrows, smooth moves interrupted mid-move, instant moves, late creation, removal, tree_layout
  edge: {
    stage: 'A = node("A", 100, 100) B = rect("B", 300, 100) C = triangle("C", 500, 250) T = text("Hi", 320, 300) arrow(A, B) edge(B, C) arrow(C, A)',
    script: 'move(A, 300, 250, 1, "smooth"); wait(0.4); move(A, 50, 50, 0.8); color(T, "red", 0.5); wait(0.3); move(B, 400, 200, 0); wait(0.3)\n' +
      'P = node("P", 600, 50); arrow(P, B); color(B, "blue", 0.6); wait(0.5); remove(B); move(P, 200, 200, 1, "smooth"); wait(0.4); move(C, 100, 300, 0); wait(0.8); tree_layout(A, 0.5); wait(0.6)',
  },
  // simulations with arrows and a scripted move between them
  simarrow: {
    stage: 'A = node("A", 100, 100) B = rect("B", 400, 200) C = triangle("C", 500, 80) arrow(A, B) edge(B, C)',
    script: 'push(A, 400, 300); simulate(1.2); move(B, 100, 300, 0.6, "smooth"); simulate(1, "towards", {target = B, only = A}); wait(0.2)',
  },
};

const data = {};
for (const [name, prog] of Object.entries(CASES)) {
  const { timeline } = runProgram(fengari, prog);
  const ids = timelineIds(timeline);
  const samples = [];
  for (let t = 7; t <= timeline.durationMs + 200; t += 23) {
    const st = sceneAt(timeline, t);
    const at = new Map(st.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
    samples.push({
      t,
      nodes: st.nodes.map((n) => ({ id: ids.get(n.id), x: n.x, y: n.y, fill: paint(n.color), shape: n.shape })),
      edges: st.edges.map((e) => ({ id: ids.get(e.id), directed: e.directed, a: at.get(e.a), b: at.get(e.b), stroke: paint(e.color) })),
    });
  }
  data[name] = { svg: renderAnimatedSVG(timeline), samples, all: [...ids.values()] };
}

// Runs in the browser.
function check(data) {
  const hex = (c) => '#' + c.match(/\d+/g).slice(0, 3).map((v) => (+v).toString(16).padStart(2, '0')).join('');
  const near = (a, b) => [1, 3, 5].every((i) => Math.abs(parseInt(a.slice(i, i + 2), 16) - parseInt(b.slice(i, i + 2), 16)) <= 3);
  const tf = (g) => {
    let m = new DOMMatrix();
    const l = g.transform.animVal;
    for (let i = 0; i < l.numberOfItems; i++) m = m.multiply(DOMMatrix.fromMatrix(l.getItem(i).matrix));
    return m;
  };
  const report = {};
  for (const [name, c] of Object.entries(data)) {
    const host = document.createElement('div');
    host.innerHTML = c.svg;
    document.getElementById('svgs').append(host);
    const svg = host.querySelector('svg');
    svg.pauseAnimations();
    let checks = 0;
    const bad = [];
    for (const s of c.samples) {
      svg.setCurrentTime(s.t / 1000);
      const visible = new Set();
      for (const n of s.nodes) {
        visible.add(n.id);
        const g = svg.getElementById(n.id);
        const m = tf(g);
        checks++;
        if (Math.abs(m.e - n.x) > 0.6 || Math.abs(m.f - n.y) > 0.6) bad.push(`${s.t} ${n.id} pos ${m.e.toFixed(2)},${m.f.toFixed(2)} vs ${n.x.toFixed(2)},${n.y.toFixed(2)}`);
        const fillEl = n.shape === 'text' ? g.querySelector('text') : g.querySelector('circle,rect,polygon');
        const f = hex(getComputedStyle(fillEl).fill);
        checks++;
        if (!near(f, n.fill)) bad.push(`${s.t} ${n.id} fill ${f} vs ${n.fill}`);
      }
      for (const e of s.edges) {
        visible.add(e.id);
        const el = svg.getElementById(e.id);
        const pts = e.directed
          ? [0, 1, 2].map((i) => el.animatedPoints.getItem(i))
          : [{ x: el.x1.animVal.value, y: el.y1.animVal.value }, null, { x: el.x2.animVal.value, y: el.y2.animVal.value }];
        const tol = e.directed ? 1.5 : 0.6; // arrows are sampled every 10 ms
        const off = (p, q) => Math.abs(p.x - q.x) > tol || Math.abs(p.y - q.y) > tol;
        checks++;
        if (off(pts[0], e.a) || off(pts[2], e.b) || (pts[1] && off(pts[1], { x: (e.a.x + e.b.x) / 2, y: (e.a.y + e.b.y) / 2 }))) {
          bad.push(`${s.t} ${e.id} ends ${pts.filter(Boolean).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}`);
        }
        const st = hex(getComputedStyle(el).stroke);
        checks++;
        if (!near(st, e.stroke)) bad.push(`${s.t} ${e.id} stroke ${st} vs ${e.stroke}`);
      }
      for (const id of c.all) {
        const shown = getComputedStyle(svg.getElementById(id)).visibility !== 'hidden';
        checks++;
        if (shown !== visible.has(id)) bad.push(`${s.t} ${id} visible=${shown}, expected ${visible.has(id)}`);
      }
    }
    report[name] = { checks, failures: bad.length, first: bad.slice(0, 8) };
  }
  const total = Object.values(report).reduce((a, r) => a + r.checks, 0);
  const failures = Object.values(report).reduce((a, r) => a + r.failures, 0);
  window.checkResult = { total, failures, report };
  document.title = `animated check: ${total} checks, ${failures} failures`;
  document.getElementById('result').textContent = JSON.stringify(window.checkResult, null, 2);
}

const html = `<!doctype html>
<meta charset="utf-8">
<title>animated check: running</title>
<pre id="result">running…</pre>
<div id="svgs" style="display:flex;flex-wrap:wrap;gap:8px"></div>
<script>
const data = ${JSON.stringify(data)};
${check.toString()}
// SMIL timelines only start once the document has loaded; checking earlier gives false failures
window.addEventListener('load', () => requestAnimationFrame(() => check(data)));
</script>
`;
const web = process.argv.includes('--web');
const out = path.join(root, web ? 'web/_check.html' : 'out/animated_check.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`wrote ${path.relative(root, out)} (${Object.keys(CASES).length} cases, ${Object.values(data).reduce((a, d) => a + d.samples.length, 0)} sample times)`);
console.log(web ? 'open http://localhost:8080/web/_check.html (npm start), then delete the file' : `open it in Chrome: xdg-open ${out}`);
