import { test } from 'node:test';
import assert from 'node:assert/strict';
import fengari from 'fengari';
import { newProject, runTool, describeProject, endState, TOOLS, schemaOf, ToolError, RECIPE } from '../core/ai_tools.js';
import { keyframes, stepsToLua } from '../core/steps.js';
import { toStageLua } from '../core/stage_file.js';
import { runProgram } from '../core/lua_api.js';
import { sceneAt } from '../core/player.js';

const go = (p, calls) => calls.map(([name, args]) => runTool(p, name, args));
const run = (p) => runProgram(fengari, { stage: toStageLua(p.scene), steps: stepsToLua(p.steps, p.scene) }).timeline;
const at = (p, name) => [...endState(p).values()].find((o) => o.name === name);
const err = (p, name, args, re) => assert.throws(() => runTool(p, name, args), (e) => e instanceof ToolError && re.test(e.message), `${name} ${JSON.stringify(args)}`);

test('step by step: one call per instruction, each after the previous one, seconds on the action', () => {
  // "draw circle A at (100, 200) and a box B at (400, 200); move A to (300, 100) in 10 seconds;
  //  at the same time turn B red; then make it blue; wait 1 second; move A back"
  const p = newProject();
  const r = go(p, [
    ['draw', { shape: 'circle', label: 'A', x: 100, y: 200 }],
    ['draw', { shape: 'box', label: 'B', x: 400, y: 200 }],
    ['move', { label: 'A', x: 300, y: 100, seconds: 10 }],
    ['color', { label: 'B', color: 'red', together: true }],
    ['color', { color: 'blue' }],
    ['wait', { seconds: 1 }],
    ['move', { label: 'A', x: 100, y: 200, seconds: '2s' }],
  ]);
  assert.equal(r[0], 'Drew circle A at (100, 200) in the starting picture.');
  assert.equal(r[2], 'A moves from (100, 200) to (300, 100) from 0 to 10 s.');
  assert.equal(r[3], 'B turns red from 0 to 10 s.', 'together takes the length of what it joins');
  assert.equal(r[4], 'B turns blue from 10 to 11 s.', 'no label: the last object; default 1 s');
  assert.equal(r[5], 'Waits 1 s, from 11 to 12 s.');
  assert.equal(r[6], 'A moves from (300, 100) to (100, 200) from 12 to 14 s.');
  assert.equal(p.scene.nodes().length, 2, 'both drawn in the starting picture');
  assert.equal(keyframes(p.steps).length, 4);
  const tl = run(p);
  assert.equal(tl.durationMs, 14000);
  const mid = sceneAt(tl, 5000).nodes.find((n) => n.label === 'A');
  assert.deepEqual([mid.x, mid.y], [200, 150]);
  assert.deepEqual(sceneAt(tl, 14000).nodes.map((n) => [n.label, n.x, n.y, n.color]), [['A', 100, 200, '#cccccc'], ['B', 400, 200, 'blue']]);
});

test('together with its own seconds keeps them; drawing after something happened appears then', () => {
  const p = newProject();
  go(p, [
    ['draw', { shape: 'circle', label: 'A', x: 100, y: 100 }],
    ['move', { right: 200, seconds: 4 }],
    ['color', { color: 'red', seconds: 1, together: true }],
    ['draw', { shape: 'triangle', label: 'T', x: 500, y: 300, color: 'green' }],
    ['draw', { shape: 'circle', x: 50, y: 300 }],
    ['connect', { from: 'T', to: 'circle 1' }],
  ]);
  assert.deepEqual(p.steps.slice(0, 2).map((s) => s.dur), [4000, 1000]);
  assert.equal(p.scene.nodes().length, 1);
  assert.deepEqual(keyframes(p.steps).length, 2, 'the appearing shapes and their line come together, after the move');
  assert.match(describeProject(p), /0–4 s: A moves to \(300, 100\); A turns red\.\n4 s: T \(triangle\) appears at \(500, 300\); T turns green; circle 1 \(circle\) appears at \(50, 300\); T – circle 1 get connected\./);
  assert.doesNotThrow(() => run(p));
});

test('pointing at objects: sets, "all circles", "the red ones", "everything", "them", "selected"', () => {
  const p = newProject();
  go(p, [
    ['draw', { shape: 'circle', label: 'A', x: 100, y: 100 }],
    ['draw', { shape: 'circle', label: 'B', x: 200, y: 100, color: 'red' }],
    ['draw', { shape: 'box', label: 'C', x: 300, y: 100, color: 'red' }],
  ]);
  assert.equal(runTool(p, 'move', { label: 'all circles', down: 100, seconds: 2 }), 'A and B move by (0, 100) together from 0 to 2 s.');
  assert.equal(runTool(p, 'color', { label: 'them', color: 'green' }), 'A and B turn green from 2 to 3 s.');
  assert.equal(runTool(p, 'color', { label: 'the red ones', color: 'blue' }), 'C turns blue from 3 to 4 s.');
  assert.equal(runTool(p, 'move', { label: 'A, C', y: 300 }), 'A and C move by (0, 150) together from 4 to 5 s.', 'a set keeps its arrangement: its middle goes to y 300');
  assert.equal(runTool(p, 'remove', { label: ['b', 'c'] }), 'B and C disappear at 5 s.');
  p.selected = [1];
  assert.equal(runTool(p, 'resize', { label: 'these', scale: 2 }), 'Resizes from 5 to 6 s: A 96×96 px.');
  assert.match(runTool(p, 'color', { label: 'everything', color: 'black' }), /^A turns black/);
  assert.deepEqual([at(p, 'A').x, at(p, 'A').y], [100, 350]);
  assert.doesNotThrow(() => run(p));
  p.selected = [];
  err(p, 'color', { label: 'selected', color: 'red' }, /Nothing is selected on the Stage/);
  err(p, 'color', { label: 'the purple ones', color: 'red' }, /No objects match "the purple ones"\. Objects: A \(black\)/);
});

test('unnamed shapes are "circle 1", "box 1"; "the circle" when there is one; arcs and via make curves', () => {
  const p = newProject();
  const r = runTool(p, 'draw', { shape: 'circle', x: 100, y: 200 });
  assert.match(r, /^Drew circle 1 \(no label: call it "circle 1"/);
  runTool(p, 'draw', { shape: 'square', x: 400, y: 200 });
  runTool(p, 'move', { label: 'the circle', x: 300, y: 200, arc: 80 });
  const s = p.steps[0];
  assert.equal(s.op, 'path');
  assert.ok(Math.min(...s.points.map((q) => q.y)) < 200 - 60, 'a positive arc curves upwards');
  assert.deepEqual(s.points.at(-1), { x: 300, y: 200 });
  runTool(p, 'move', { label: 'box 1', x: 500, y: 100, via: '[[450, 50]]' });
  assert.deepEqual(p.steps[1].points, [{ x: 450, y: 50 }, { x: 500, y: 100 }]);
  runTool(p, 'draw', { shape: 'circle', x: 50, y: 50 });
  err(p, 'color', { label: 'the circle', color: 'red' }, /There are 2 of those \(circle 1, circle 2\): say which one/);
});

test('undo takes back the last action, also a starting-picture change; write, rename, clear', () => {
  const p = newProject();
  go(p, [['draw', { shape: 'circle', label: 'A', x: 100, y: 100 }], ['color', { color: 'red' }], ['move', { x: 200 }]]);
  assert.equal(runTool(p, 'undo'), 'Took back: move.');
  assert.equal(p.steps.length, 0);
  runTool(p, 'undo');
  assert.equal(p.scene.nodes()[0].color, '#cccccc');
  assert.match(runTool(p, 'write', { text: 'Bubble sort', x: 320, y: 30 }), /^Drew text "Bubble sort" at \(320, 30\)/);
  runTool(p, 'rename', { label: 'A', text: 'root' });
  assert.equal(p.scene.nodes()[0].label, 'root');
  runTool(p, 'clear');
  assert.equal(p.scene.nodes().length, 0);
  runTool(p, 'undo');
  assert.equal(p.scene.nodes().length, 2);
});

test('forgiving: other tool names, numbers as text, "square", "light grey", only x, JSON strings', () => {
  const p = newProject();
  runTool(p, 'add', '{"shape": "Square", "label": "B", "x": "200", "y": "100", "color": "Light Grey", "width": "128"}');
  const b = p.scene.nodes()[0];
  assert.deepEqual([b.shape, b.x, b.y, b.color, b.size], ['rect', 200, 100, 'lightgrey', 2]);
  runTool(p, 'move', { label: 'b', x: '300' });
  assert.deepEqual([p.steps[0].x, p.steps[0].y], [300, 100], 'only x: y stays');
  runTool(p, 'colour', { label: 'it', color: 'Red' });
  runTool(p, 'delete', {});
  runTool(p, 'pause', { seconds: 1 });
  assert.deepEqual(p.steps.map((s) => s.op), ['move', 'color', 'remove', 'wait']);
});

test('errors say how to fix the call', () => {
  const p = newProject();
  err(p, 'move', { x: 1, y: 1 }, /There are no objects yet: draw one first/);
  runTool(p, 'draw', { shape: 'circle', label: 'A', x: 10, y: 10 });
  err(p, 'move', { label: 'Z', x: 1, y: 1 }, /No object called "Z"\. Objects: A\./);
  err(p, 'move', { label: 'A', x: 900, y: 1 }, /x must be between 0 and 640 \(the canvas is 640×360/);
  err(p, 'move', { label: 'A', right: 700 }, /right must be between/);
  err(p, 'move', { label: 'A', left: 50 }, /off the canvas/);
  err(p, 'move', { label: 'A', x: 10, y: 10 }, /already there \(10, 10\)\. x and y say where TO; to move by a distance use right, left, up or down/);
  runTool(p, 'move', { label: 'A', dy: 5, arc: 'true' });
  assert.equal(p.steps.at(-1).op, 'path', 'arc: true bends it; dx/dy still work');
  runTool(p, 'undo');
  err(p, 'move', { label: 'A' }, /Say where to: x and y, or how far/);
  err(p, 'draw', { shape: 'star' }, /Unknown shape "star"\. Use circle, box, triangle or text/);
  err(p, 'draw', { shape: 'circle', label: 'a' }, /There is already an object called A\. To change it, use move, color or resize/);
  err(p, 'color', { label: 'A', color: 'sparkly' }, /Unknown colour "sparkly"/);
  err(p, 'resize', { label: 'A' }, /Say how big/);
  err(p, 'move', { label: 'A', x: 50, seconds: 99 }, /seconds must be a number from 0\.1 to 60/);
  err(p, 'dance', {}, /There is no tool called "dance"\. Tools: draw, write, move/);
  err(p, 'connect', { from: 'A', to: 'A' }, /two different objects/);
});

test('every tool has a schema and an example; the recipe is rules plus examples', () => {
  for (const t of TOOLS) {
    assert.equal(schemaOf(t).type, 'object');
    assert.ok(t.description.length > 20, t.name);
  }
  assert.match(RECIPE, /one tool call per instruction/);
  assert.match(RECIPE, /"together": true/);
  assert.doesNotMatch(RECIPE, /next_keyframe|start_over/);
});
