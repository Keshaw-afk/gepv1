import { test } from 'node:test';
import assert from 'node:assert/strict';
import fengari from 'fengari';
import { newProject, runTool, describeProject, endState, TOOLS, schemaOf, ToolError } from '../core/ai_tools.js';
import { keyframes, stepsToLua } from '../core/steps.js';
import { toStageLua } from '../core/stage_file.js';
import { runProgram } from '../core/lua_api.js';
import { sceneAt } from '../core/player.js';

const go = (p, calls) => calls.map(([name, args]) => runTool(p, name, args));
const lua = (p) => runProgram(fengari, { stage: toStageLua(p.scene), steps: stepsToLua(p.steps, p.scene) });

test('the recipe example builds a starting picture and keyframes that run in the engine', () => {
  const p = newProject();
  const replies = go(p, [
    ['start_over'],
    ['add', { shape: 'circle', label: 'A', x: 100, y: 180 }],
    ['add', { shape: 'box', label: 'B', x: 300, y: 180, color: 'blue' }],
    ['connect', { from: 'A', to: 'B' }],
    ['next_keyframe'],
    ['change', { label: 'A', color: 'red' }],
    ['move', { label: 'B', x: 300, y: 80 }],
    ['next_keyframe', { seconds: 0.5 }],
    ['move', { label: 'A', x: 400, y: 180, via: [[250, 60]] }],
  ]);
  assert.match(replies[1], /^Added circle A at \(100, 180\) to the starting picture\. Next: /);
  assert.match(replies[5], /A turns red in keyframe 1/);
  assert.equal(p.scene.nodes().length, 2);
  assert.equal(p.scene.edges().length, 1);
  assert.deepEqual(keyframes(p.steps), [{ start: 0, end: 2 }, { start: 2, end: 3 }]);
  assert.match(stepsToLua(p.steps, p.scene), /color\(A, "red", 1\)\nmove\(B, 300, 80, 1\); wait\(1\)\npath\(A, \{\{250, 60\}, \{400, 180\}\}, 0\.5\); wait\(0\.5\)/);
  const { timeline } = lua(p);
  assert.equal(timeline.durationMs, 1500);
  const end = sceneAt(timeline, 1500);
  assert.deepEqual(end.nodes.map((n) => [n.label, n.x, n.y]), [['A', 400, 180], ['B', 300, 80]]);
});

test('objects added in a keyframe appear there, with their colour; free spots; duplicate labels', () => {
  const p = newProject();
  go(p, [['add', { shape: 'circle', label: 'A' }], ['next_keyframe']]);
  const r = runTool(p, 'add', { shape: 'triangle', label: 'a', color: 'green' });
  assert.match(r, /"a" was taken, so it is called a′/);
  const a = endState(p);
  const [first, second] = [...a.values()];
  assert.ok(Math.hypot(first.x - second.x, first.y - second.y) >= 70, 'the free spot is away from A');
  assert.deepEqual(p.steps.map((s) => s.op), ['add', 'color']);
  assert.equal(p.steps[1].dur, 0, 'it appears in its colour');
  runTool(p, 'connect', { from: 'A', to: "a'", arrow: true });
  runTool(p, 'remove', { label: 'a′-A' });
  assert.doesNotThrow(() => lua(p));
});

test('errors say how to fix the call', () => {
  const p = newProject();
  runTool(p, 'add', { shape: 'circle', label: 'A', x: 10, y: 10 });
  const err = (name, args, re) => assert.throws(() => runTool(p, name, args), (e) => e instanceof ToolError && re.test(e.message));
  err('move', { label: 'Z', x: 1, y: 1 }, /No object called "Z"\. Objects: A\./);
  err('move', { label: 'A', x: 900, y: 1 }, /x must be between 0 and 640 \(the canvas is 640×360/);
  err('add', { shape: 'star', label: 'S' }, /Unknown shape "star"\. Use circle, box, triangle or text/);
  err('add', { shape: 'circle' }, /add needs "label"/);
  err('change', { label: 'A', color: 'sparkly' }, /Unknown colour "sparkly"\. Use one of: red/);
  err('change', { label: 'A' }, /Say what to change/);
  err('next_keyframe', { seconds: 99 }, /seconds must be a number from 0\.1 to 10/);
  err('dance', {}, /There is no tool called "dance"\. Tools: start_over, add/);
  err('connect', { from: 'A', to: 'A' }, /two different objects/);
});

test('forgiving about types and words: numbers as strings, "square", "light grey", JSON strings', () => {
  const p = newProject();
  runTool(p, 'add', '{"shape": "Square", "label": "B", "x": "200", "y": "100", "color": "Light Grey", "width": "128"}');
  const b = p.scene.nodes()[0];
  assert.deepEqual([b.shape, b.x, b.y, b.color, b.size], ['rect', 200, 100, 'lightgrey', 2]);
  runTool(p, 'next_keyframe', { seconds: '0.5' });
  runTool(p, 'move', { label: 'b', x: 300, y: 100, via: '[[250, 50]]' });
  assert.equal(p.steps[0].op, 'path');
  assert.equal(p.steps[0].dur, 500);
});

test('show describes the picture and keyframes; every tool has a schema', () => {
  const p = newProject();
  go(p, [['add', { shape: 'circle', label: 'A', x: 100, y: 100 }], ['next_keyframe'], ['move', { label: 'A', x: 200, y: 100 }], ['pause', { seconds: 1 }], ['remove', { label: 'A' }]]);
  const text = describeProject(p);
  assert.match(text, /Starting picture: circle A at \(100, 100\)\./);
  assert.match(text, /Keyframe 1 \(1 s\): A moves to \(200, 100\)\.\nPause 1 s\.\nKeyframe 2: A disappears\./);
  assert.match(text, /Now adding to keyframe 2\./);
  for (const t of TOOLS) {
    assert.equal(schemaOf(t).type, 'object');
    assert.ok(t.description.length > 20, t.name);
  }
});
