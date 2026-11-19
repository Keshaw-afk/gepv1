import { test } from 'node:test';
import assert from 'node:assert/strict';
import fengari from 'fengari';
import { run } from './helpers.js';
import { runProgram } from '../core/lua_api.js';
import { sceneAt, positionsOf } from '../core/player.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { smoothPath, pointAlong, simplify, bend, pathLength } from '../core/paths.js';
import { stepsToLua, pruneSteps, sourceOf, reshapePath } from '../core/steps.js';
import { toStageLua } from '../core/stage_file.js';
import { Scene } from '../core/scene.js';

test('a smooth path goes through every point, starts and ends exactly, and is travelled at even speed', () => {
  const pts = [{ x: 0, y: 0 }, { x: 100, y: 100 }, { x: 200, y: 0 }];
  const curve = smoothPath(pts);
  assert.deepEqual(curve[0], pts[0]);
  assert.deepEqual(curve.at(-1), pts[2]);
  assert.ok(curve.some((p) => p.x === 100 && p.y === 100), 'passes through the middle point');
  assert.deepEqual(pointAlong(curve, 0.5), { x: 100, y: 100 }, 'symmetric curve: the middle is halfway by length');
  const L = pathLength(curve);
  const a = pointAlong(curve, 0.25), b = pointAlong(curve, 0.5);
  assert.ok(L > 2 * Math.hypot(100, 100) - 1);
  assert.ok(Math.hypot(b.x - a.x, b.y - a.y) <= L / 4 + 1e-6);
});

test('simplify keeps the shape of a drag with few points; bend tells a curve from a straight drag', () => {
  const arc = Array.from({ length: 50 }, (_, i) => ({ x: i * 4, y: Math.sin(i / 8) * 60 }));
  const thin = simplify(arc, 3);
  assert.ok(thin.length < 15 && thin.length >= 4, `${thin.length} points`);
  assert.ok(bend(arc) > 30);
  assert.ok(bend(Array.from({ length: 20 }, (_, i) => ({ x: i * 10, y: (i % 2) * 2 }))) < 3);
});

test('path() in Lua: a curved move that pos(), frames, lines and the animated SVG all follow', () => {
  const r = run('A = node("A", 0, 100) B = node("B", 300, 100) edge(A, B)', 'path(A, {{100, 0}, {200, 100}}, 1); wait(1); print(pos(A))');
  assert.deepEqual(r.log, ['200.0\t100.0']);
  const mid = sceneAt(r.timeline, 500).nodes[0];
  assert.ok(Math.abs(mid.x - 100) < 1 && Math.abs(mid.y) < 1, `halfway is the top of the arc: ${mid.x},${mid.y}`);
  const pos = positionsOf(r.timeline);
  for (const t of [0, 130, 500, 870, 1000]) assert.deepEqual(pos(1, t), { x: sceneAt(r.timeline, t).nodes[0].x, y: sceneAt(r.timeline, t).nodes[0].y });
  const svg = renderAnimatedSVG(r.timeline);
  assert.match(svg, /type="translate" values="0 100;[^"]*;200 100" keyTimes="0;[^"]*;1" begin="0s" dur="1s"/);
  assert.match(svg, /<animate attributeName="x1" values="0;[^"]*;200" keyTimes=/, 'the line follows the curve');
  assert.throws(() => run('A = node("A", 0, 0)', 'path(A, {})'), /at least one point/);
  assert.throws(() => run('A = node("A", 0, 0)', 'path(A, {{1}})'), /must be \{x, y\}/);
});

test('a path step becomes plain Lua and goes with its object', () => {
  const s = new Scene();
  const A = s.addNode('A', 0, 100);
  const steps = [{ op: 'path', target: A, points: [{ x: 100, y: 0 }, { x: 200.4, y: 100 }], dur: 1000 }];
  const lua = stepsToLua(steps, s);
  assert.match(lua, /^path\(A, \{\{100, 0\}, \{200, 100\}\}, 1\); wait\(1\)$/m);
  const r = runProgram(fengari, { stage: toStageLua(s), steps: lua });
  assert.equal(r.timeline.durationMs, 1000);
  s.remove(A);
  assert.deepEqual(pruneSteps(steps, s), []);
});

test('sourceOf finds the step that decides a property at a point; reshapePath keeps the start', () => {
  const steps = [
    { op: 'move', target: 1, x: 5, y: 5 },
    { op: 'add', id: 's1', shape: 'circle', label: 'C', x: 0, y: 0 },
    { op: 'color', target: 1, color: 'red' },
    { op: 'path', target: 1, points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] },
  ];
  assert.equal(sourceOf(steps, 0, 1, 'pos'), -1, 'at the start: the stage');
  assert.equal(sourceOf(steps, 3, 1, 'pos'), 0);
  assert.equal(sourceOf(steps, 4, 1, 'pos'), 3);
  assert.equal(sourceOf(steps, 4, 1, 'color'), 2);
  assert.equal(sourceOf(steps, 4, 1, 'size'), -1);
  assert.equal(sourceOf(steps, 4, 's1', 'pos'), 1, 'an object a step added: that add step');
  assert.equal(sourceOf(steps, 4, 's1', 'color'), 1);
  assert.deepEqual(reshapePath([{ x: 0, y: 0 }, { x: 10, y: 0 }], 10, 10), [{ x: 0, y: 5 }, { x: 10, y: 10 }]);
});
