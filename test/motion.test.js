import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { sceneAt, frameTimes } from '../core/player.js';
import { landmarks } from '../core/frames.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { formatTrace } from '../core/trace.js';

const GRAPH = 'A = node("A", 300, 180) B = node("B", 310, 185) C = node("C", 320, 175) D = node("D", 305, 170) edge(A, B) edge(B, C) edge(C, D)';

test('simulate "spread": a clump untangles; one command, one moment and one trace line per node', () => {
  const r = run(GRAPH, 'simulate(3, "spread")');
  const sets = r.timeline.commands.filter((c) => c.op === 'set');
  assert.equal(sets.length, 4);
  assert.ok(sets.every((c) => c.motion === 'spread' && c.t === 0 && c.dur === 3000));
  assert.equal(r.timeline.durationMs, 3000, 'simulate lets time run');
  const end = sceneAt(r.timeline, 3000).nodes;
  for (const a of end) for (const b of end) if (a !== b) assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > 60, `${a.label}-${b.label} apart`);
  const marks = landmarks(r.timeline, frameTimes(r.timeline.durationMs, 25));
  assert.equal(marks.length, 1);
  assert.equal(formatTrace(r).filter((l) => /simulate spread/.test(l)).length, 4);
});

test('the same program always moves the same way, and every frame follows the baked path', () => {
  const a = run(GRAPH, 'simulate(2, "spread")'), b = run(GRAPH, 'simulate(2, "spread")');
  assert.deepEqual(a.timeline.commands, b.timeline.commands);
  const path = a.timeline.commands.find((c) => c.op === 'set' && c.name === 'A').path;
  assert.deepEqual(sceneAt(a.timeline, 1000).nodes[0], { ...sceneAt(a.timeline, 1000).nodes[0], x: path[200], y: path[201] }); // tick 100
});

test('push + drift: a node keeps its velocity and bounces off the canvas edge', () => {
  const r = run('P = node("P", 100, 180)', 'push(P, 1000, 0); simulate(1); print(pos(P))');
  const xs = r.timeline.commands.find((c) => c.op === 'set').path.filter((_, i) => i % 2 === 0);
  assert.equal(Math.max(...xs), 640 - 24, 'reaches the right wall');
  assert.ok(xs.at(-1) < 640 - 24, 'and comes back');
  assert.ok(xs.every((x) => x >= 24 && x <= 616));
});

test('a Lua function is a rule; pos() inside it sees the simulation live; only/target limit who moves', () => {
  // F follows L, which is pulled to the right: F has to read where L is now
  const r = run('L = node("L", 100, 100) F = node("F", 100, 250) T = node("T", 500, 100)', `
    simulate(1.5, function(id, x, y, vx, vy)
      if id == L then return 400 - 3 * vx, 0 end
      local lx, ly = pos(L)
      return 30 * (lx - x) - 10 * vx, 0
    end, {only = {L, F}})
    local lx = pos(L); local fx = pos(F); print(math.floor(lx - fx + 0.5) < 60)
    simulate(1, "towards", {target = T, only = F})`);
  assert.deepEqual(r.log, ['true']);
  const end = Object.fromEntries(sceneAt(r.timeline, r.timeline.durationMs).nodes.map((n) => [n.label, n]));
  assert.equal(end.T.x, 500, 'the target itself does not move');
  assert.ok(Math.hypot(end.F.x - 500, end.F.y - 100) < 15, 'F reached T');
});

test('simulate checks its arguments', () => {
  assert.throws(() => run('A = node("A", 0, 0)', 'simulate(0)'), /seconds must be more than 0/);
  assert.throws(() => run('A = node("A", 0, 0)', 'simulate(1, "magnet")'), /unknown rule 'magnet'/);
  assert.throws(() => run('A = node("A", 0, 0)', 'simulate(1, "towards")'), /needs a target/);
  assert.throws(() => run('A = node("A", 0, 0)', 'simulate(1, "spread", {only = 99})'), /only must be a node/);
});

test('animated SVG: a simulated move is one animation through the baked positions', () => {
  const r = run('A = node("A", 100, 100) B = node("B", 300, 100) edge(A, B)', 'push(A, 200, 0); simulate(0.5, "drift", {only = A})');
  const svg = renderAnimatedSVG(r.timeline);
  const m = svg.match(/<animateTransform attributeName="transform" type="translate" values="([^"]+)" begin="0s" dur="0\.5s"/);
  assert.ok(m);
  assert.equal(m[1].split(';').length, 51);
  assert.match(svg, /<animate attributeName="x1" values="100;102;104/);
});
