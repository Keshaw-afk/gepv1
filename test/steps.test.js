import { test } from 'node:test';
import assert from 'node:assert/strict';
import fengari from 'fengari';
import { runProgram } from '../core/lua_api.js';
import { toStageLua } from '../core/stage_file.js';
import { stepsToLua, pruneSteps, toEditorIds } from '../core/steps.js';
import { sceneAt } from '../core/player.js';
import { Scene } from '../core/scene.js';

function stage() {
  const s = new Scene();
  const A = s.addNode('A', 0, 0), B = s.addNode('B', 100, 0);
  const AB = s.addEdge(A, B);
  return { s, A, B, AB };
}

test('steps become plain API calls; "with previous" shares one wait', () => {
  const { s, A, B, AB } = stage();
  const steps = [
    { op: 'color', target: A, color: 'red', dur: 500 },
    { op: 'color', target: AB, color: 'red', dur: 300, together: true },
    { op: 'move', target: B, x: 50, y: 60, dur: 1000 },
    { op: 'wait', dur: 200 },
    { op: 'color', target: A, color: 'black', dur: 500 },
  ];
  const lua = stepsToLua(steps, s);
  assert.equal(lua.split('\n').slice(1).join('\n'), [
    'color(A, "red", 0.5)',
    'color(edge_of(A, B), "red", 0.3); wait(0.5)',
    'move(B, 50, 60, 1); wait(1)',
    'wait(0.2)',
    'color(A, "black", 0.5); wait(0.5)',
    '',
  ].join('\n'));

  const { timeline } = runProgram(fengari, { stage: toStageLua(s), steps: lua });
  const sets = timeline.commands.filter((c) => c.op === 'set').map((c) => c.t);
  assert.deepEqual(sets, [0, 0, 500, 1700]);
  assert.equal(timeline.durationMs, 2200);
});

test('deleting a node drops its steps and its edges\' steps', () => {
  const { s, A, B, AB } = stage();
  const steps = [{ op: 'color', target: AB, color: 'red', dur: 500 }, { op: 'wait', dur: 100 },
    { op: 'color', target: A, color: 'red', dur: 500 }, { op: 'move', target: B, x: 1, y: 1, dur: 500 }];
  s.remove(B);
  assert.deepEqual(pruneSteps(steps, s).map((x) => x.op), ['wait', 'color']);
});

test('behaviour view uses editor ids even after a deletion', () => {
  const s = new Scene();
  const gone = s.addNode('X', 0, 0);
  const A = s.addNode('A', 10, 10), B = s.addNode('B', 20, 20);
  const AB = s.addEdge(A, B);
  s.remove(gone); // editor ids now start at 2; the Lua run numbers from 1
  const steps = [{ op: 'move', target: B, x: 99, y: 99, dur: 500 }];
  const result = runProgram(fengari, { stage: toStageLua(s), steps: stepsToLua(steps, s) });
  const view = toEditorIds(sceneAt(result.timeline, result.timeline.durationMs), result, s);
  assert.deepEqual(view.nodes.map((n) => [n.id, n.x]), [[A, 10], [B, 99]]);
  assert.deepEqual(view.edges.map((e) => [e.id, e.a, e.b]), [[AB, A, B]]);
});
