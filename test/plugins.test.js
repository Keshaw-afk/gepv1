import { test } from 'node:test';
import assert from 'node:assert/strict';
import fengari from 'fengari';
import { TOOLS } from '../core/plugins/index.js';
import { newProject, runTool, endState, describeProject, ToolError } from '../core/ai_tools.js';
import { keyframes, stepsToLua } from '../core/steps.js';
import { toStageLua } from '../core/stage_file.js';
import { runProgram } from '../core/lua_api.js';
import { sceneAt } from '../core/player.js';

const run = (p) => runProgram(fengari, { stage: toStageLua(p.scene), steps: stepsToLua(p.steps, p.scene) }).timeline;
const at = (p, label) => [...endState(p).values()].find((o) => o.label === label);

test('the plugins are registered next to the core tools', () => {
  for (const name of ['make_row', 'make_tree', 'make_graph', 'swap', 'throw']) assert.ok(TOOLS.some((t) => t.name === name), name);
});

test('bubble sort of a row: one swap per keyframe, the boxes really trade places', () => {
  const p = newProject();
  const r = runTool(p, 'make_row', { values: [3, 1, 3, 2] });
  assert.match(r, /Made a row of 4 boxes: 3, 1, 3′, 2/);
  const xs = ['3', '1', '3′', '2'].map((l) => at(p, l).x);
  assert.ok(xs[0] < xs[1] && xs[1] < xs[2] && xs[2] < xs[3]);
  runTool(p, 'swap', { a: '3', b: '1' }); // starts keyframe 1 by itself
  runTool(p, 'next_keyframe', {});
  runTool(p, 'swap', { a: "3'", b: '2' });
  assert.equal(keyframes(p.steps).length, 2);
  assert.deepEqual(['1', '3', '2', '3′'].map((l) => at(p, l).x), xs, 'each swap trades the places');
  const tl = run(p);
  const mid = sceneAt(tl, 500).nodes.find((n) => n.label === '3');
  assert.ok(mid.y < 180 - 20, 'the first box goes over the other one');
  const end = sceneAt(tl, tl.durationMs).nodes;
  assert.deepEqual(end.map((n) => [n.label, n.x]).sort((a, b) => a[1] - b[1]).map((n) => n[0]), ['1', '3', '2', '3′']);
});

test('a tree is laid out by levels with parents over their children; a graph sits on a circle', () => {
  const p = newProject();
  runTool(p, 'make_tree', { edges: [['8', '3'], ['8', '10'], ['3', '1'], ['3', '6'], ['10', '14']] });
  const [n8, n3, n10, n1, n6] = ['8', '3', '10', '1', '6'].map((l) => at(p, l));
  assert.ok(n8.y < n3.y && n3.y === n10.y && n1.y > n3.y);
  assert.equal(n3.x, (n1.x + n6.x) / 2);
  assert.equal(p.scene.edges().length, 5);
  assert.throws(() => runTool(newProject(), 'make_tree', { edges: [['a', 'b'], ['c', 'b']] }), /b has two parents/);
  assert.throws(() => runTool(newProject(), 'make_tree', { edges: [['a', 'b'], ['c', 'd']] }), /one root; these have no parent: a, c/);

  const g = newProject();
  runTool(g, 'make_graph', { nodes: ['A', 'B', 'C', 'D'], edges: ['A-B', 'B-C', ['C', 'D']], arrows: true });
  const pts = ['A', 'B', 'C', 'D'].map((l) => at(g, l));
  const d = pts.map((q) => Math.round(Math.hypot(q.x - 320, q.y - 180)));
  assert.ok(d.every((v) => Math.abs(v - d[0]) <= 1), `all on one circle: ${d}`);
  assert.equal(g.scene.edges().filter((e) => e.directed).length, 3);
  assert.throws(() => runTool(newProject(), 'make_graph', { nodes: ['A', 'B'], edges: [['A', 'Z']] }), /uses "Z", which is not in nodes/);
});

test('throw: a parabola through the top, landing exactly; it runs in the engine', () => {
  const p = newProject();
  runTool(p, 'add', { shape: 'circle', label: 'ball', x: 60, y: 300 });
  runTool(p, 'add', { shape: 'box', label: 'wall', x: 320, y: 280, height: 160, width: 20 });
  runTool(p, 'throw', { label: 'ball', x: 560, y: 300, height: 200 });
  const s = p.steps[0];
  assert.equal(s.op, 'path');
  const ys = s.points.map((q) => q.y);
  assert.equal(Math.min(...ys), 100, 'the top is 200 px above the ends');
  assert.deepEqual(s.points.at(-1), { x: 560, y: 300 });
  const tl = run(p);
  const end = sceneAt(tl, tl.durationMs).nodes.find((n) => n.label === 'ball');
  assert.deepEqual([end.x, end.y], [560, 300]);
  assert.match(describeProject(p), /Keyframe 1 \(1 s\): ball moves along a curve to \(560, 300\)/);
  assert.throws(() => runTool(p, 'throw', { label: 'nope', x: 1, y: 1 }), (e) => e instanceof ToolError && /No object called "nope"/.test(e.message));
});
