import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { API_NAMES } from '../core/lua_api.js';
import { toStageLua, variableNames } from '../core/stage_file.js';
import { Scene } from '../core/scene.js';
import { sceneAt, frameTimes, positionsOf } from '../core/player.js';
import { renderSVG, timelineIds } from '../core/svg.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { renderFrame, landmarks } from '../core/frames.js';
import { formatTrace } from '../core/trace.js';
import { outputSettings } from '../core/output.js';
import { ease } from '../core/easing.js';

const SHAPES = 'C = node("C", 100, 100) R = rect("R", 200, 100) T = triangle("T", 300, 100) X = text("Hello", 400, 100) edge(C, R) arrow(R, T)';

test('every shape renders as a group placed with one translate; arrows get a mid-arrow marker', () => {
  const { timeline } = run(SHAPES);
  const svg = renderSVG(sceneAt(timeline, 0), { export: true, ids: timelineIds(timeline) });
  assert.match(svg, /<g id="C" class="node circle" transform="translate\(100 100\)">\n {4}<circle r="24"/);
  assert.match(svg, /<g id="R" class="node rect" transform="translate\(200 100\)">\n {4}<rect x="-32" y="-20" width="64" height="40" rx="6"/);
  assert.match(svg, /<g id="T" class="node triangle"[^>]*>\n {4}<polygon points="0,-30 28,18 -28,18"/);
  assert.match(svg, /<g id="Hello" class="node text"[^>]*>\n {4}<text y="6" fill="#333333">Hello<\/text>/);
  assert.match(svg, /<line id="C-R" class="edge"/);
  assert.match(svg, /<polyline id="R-T" class="edge arrow" points="200,100 250,100 300,100" [^>]*marker-mid="url\(#arrowhead\)"/);
  assert.match(svg, /<marker id="arrowhead"[\s\S]*fill="context-stroke"/);
});

test('stage.lua saves shapes and arrows as the same API calls', () => {
  const s = new Scene();
  const a = s.addNode('R', 10, 20, 'rect'), b = s.addNode('T', 30, 40, 'triangle'), c = s.addNode('Hi there', 50, 60, 'text');
  s.addEdge(a, b, true);
  s.addEdge(b, c);
  const lua = toStageLua(s);
  assert.match(lua, /^R = rect\("R", 10, 20\)$/m);
  assert.match(lua, /^T = triangle\("T", 30, 40\)$/m);
  assert.match(lua, /^node_1 = text\("Hi there", 50, 60\)$/m);
  assert.match(lua, /^arrow\(R, T\)$/m);
  const back = run(lua).scene;
  assert.deepEqual(back.nodes().map((n) => n.shape), ['rect', 'triangle', 'text']);
  assert.deepEqual(back.edges().map((e) => e.directed), [true, false]);
});

test('no generated variable can shadow the API (a node called "text" or "pos")', () => {
  const { log } = run('', `print(${API_NAMES.map((n) => `type(${n})`).join(', ')})`);
  assert.deepEqual(log[0].split('\t'), API_NAMES.map(() => 'function'));
  const s = new Scene();
  for (const name of API_NAMES) s.addNode(name, 0, 0);
  for (const v of variableNames(s).values()) assert.ok(!API_NAMES.includes(v), v);
});

test('remove: an object disappears at that time, a node takes its lines with it', () => {
  const r = run('A = node("A", 0, 0) B = node("B", 100, 0) edge(A, B)', 'wait(1); remove(A); wait(1)');
  const before = sceneAt(r.timeline, 999), after = sceneAt(r.timeline, 1000);
  assert.equal(before.nodes.length, 2);
  assert.equal(before.edges.length, 1);
  assert.deepEqual(after.nodes.map((n) => n.label), ['B']);
  assert.equal(after.edges.length, 0);
  const trace = formatTrace(r).join('\n');
  assert.match(trace, /t=1\.00 {2}remove A-B/);
  assert.match(trace, /t=1\.00 {2}remove A /);
  const marks = landmarks(r.timeline, frameTimes(r.timeline.durationMs, 25));
  assert.deepEqual(marks.map((m) => m.cmds.map((c) => `${c.op} ${c.name}`)), [['remove A-B', 'remove A']]);
  const anim = renderAnimatedSVG(r.timeline);
  assert.match(anim, /<g id="A"[^>]*>\s*<set attributeName="visibility" to="hidden" begin="1s"/);
});

test('ids stay the same in every frame even when objects are removed or re-created', () => {
  const r = run('A = node("A", 0, 0) A2 = node("A", 50, 0) B = node("B", 100, 0) edge(A, B)',
    'wait(1); remove(A); wait(1); edge(A2, B); wait(1)');
  const times = frameTimes(r.timeline.durationMs, 25);
  const ids = (i) => [...renderFrame(r.timeline, times, i, outputSettings()).matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(ids(0), ['A-B', 'A', 'node-2', 'B']);
  assert.deepEqual(ids(times.length - 1), ['node-2-B', 'node-2', 'B']); // the second "A" is still node-2
});

test('easing: "smooth" moves slowly at both ends and matches the CSS ease-in-out curve', () => {
  assert.ok(Math.abs(ease('smooth', 0.5) - 0.5) < 1e-9);
  assert.ok(Math.abs(ease('smooth', 0.25) - 0.1291) < 0.001); // cubic-bezier(.42,0,.58,1) at x = 0.25
  const r = run('A = node("A", 0, 0)', 'move(A, 100, 0, 1, "smooth"); wait(1)');
  const x = (t) => sceneAt(r.timeline, t).nodes[0].x;
  assert.ok(x(100) < 10 && Math.abs(x(500) - 50) < 1e-6 && x(900) > 90);
  assert.match(renderAnimatedSVG(r.timeline), /type="translate" from="0 0" to="100 0" begin="0s" dur="1s" calcMode="spline" keyTimes="0;1" keySplines="0\.42 0 0\.58 1"/);
  assert.throws(() => run('A = node("A", 0, 0)', 'move(A, 1, 1, 1, "bouncy")'), /unknown easing 'bouncy'/);
});

test('pos() tells a script where a node is now, also halfway through a move', () => {
  const r = run('A = node("A", 0, 0)', 'print(pos(A)); move(A, 100, 50, 1); wait(0.5); print(pos(A)); wait(1); print(pos(A))');
  assert.deepEqual(r.log, ['0.0\t0.0', '50.0\t25.0', '100.0\t50.0']);
});

test('tree_layout: tidy positions; a single child keeps its side, as in a binary search tree', () => {
  // 50 has children 30 (left) and 70 (right); 30 has only a right child 40; 70 has only a left child 60
  const r = run(`
    a = node("50", 300, 50) b = node("30", 100, 200) c = node("70", 500, 200) d = node("40", 200, 300) e = node("60", 400, 300)
    edge(a, b) edge(a, c) edge(b, d) edge(c, e)`, 'tree_layout(a); wait(0.5)');
  const at = Object.fromEntries(sceneAt(r.timeline, r.timeline.durationMs).nodes.map((n) => [n.label, n]));
  assert.ok(at['30'].x < at['50'].x && at['50'].x < at['70'].x, 'children left to right');
  assert.ok(at['40'].x > at['30'].x, '40 stays right of 30');
  assert.ok(at['60'].x < at['70'].x, '60 stays left of 70');
  assert.ok(at['30'].y === at['70'].y && at['40'].y === at['60'].y && at['40'].y > at['30'].y, 'levels');
  assert.equal(at['50'].y, 50, 'the tree keeps its top');
  // the moves are smooth and start together
  const moves = r.timeline.commands.filter((c) => c.op === 'set');
  assert.ok(moves.length >= 4 && moves.every((m) => m.ease === 'smooth' && m.t === 0));
});

test('positionsOf agrees with sceneAt, including eased moves that start mid-move', () => {
  const r = run('A = node("A", 0, 0)', 'move(A, 100, 0, 1, "smooth"); wait(0.3); move(A, 0, 80, 1); wait(1)');
  const pos = positionsOf(r.timeline);
  for (let t = 0; t <= r.timeline.durationMs; t += 50) {
    const a = sceneAt(r.timeline, t).nodes[0], b = pos(1, t);
    assert.ok(Math.abs(a.x - b.x) < 1e-9 && Math.abs(a.y - b.y) < 1e-9, `t=${t}`);
  }
});

test('animated SVG: an arrow follows its ends, also when an end jumps (a move with duration 0)', () => {
  const r = run('A = node("A", 0, 0) B = node("B", 100, 0) arrow(A, B)', 'wait(1); move(A, 200, 0, 0); wait(1); move(B, 100, 100, 1); wait(0.5); move(A, 0, 0, 0); wait(1)');
  const svg = renderAnimatedSVG(r.timeline);
  assert.match(svg, /<set attributeName="points" to="200,0 150,0 100,0" begin="1s"/);
  const anim = svg.match(/<animate attributeName="points" values="([^"]+)" keyTimes="([^"]+)" begin="2s" dur="1s"/);
  assert.ok(anim, 'sampled while B moves');
  const values = anim[1].split(';'), keys = anim[2].split(';').map(Number);
  const k = keys.indexOf(0.5);
  assert.equal(keys[k + 1], 0.5, 'a jump: two values at the same time');
  assert.ok(values[k].startsWith('200,') && values[k + 1].startsWith('0,0'));
  assert.equal(values.at(-1), '0,0 50,50 100,100');
});
