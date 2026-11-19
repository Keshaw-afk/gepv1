import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyframes, keyframeEndAt, removeStep, recordSteps, stepsToLua } from '../core/steps.js';
import { Scene } from '../core/scene.js';

const ops = (steps) => steps.map((s) => `${s.together ? '+' : ''}${s.op}:${s.target ?? ''}`);

test('changes join the keyframe at the point until a new one is started', () => {
  let r = recordSteps([], 0, [{ op: 'move', target: 1, x: 10, y: 0 }]);
  r = recordSteps(r.steps, r.point, [{ op: 'move', target: 2, x: 20, y: 0 }]);
  r = recordSteps(r.steps, r.point, [{ op: 'color', target: 3, color: 'red' }]);
  assert.deepEqual(ops(r.steps), ['move:1', '+move:2', '+color:3']);
  r = recordSteps(r.steps, r.point, [{ op: 'move', target: 1, x: 50, y: 0 }], { join: false }); // Next keyframe
  r = recordSteps(r.steps, r.point, [{ op: 'size', target: 2, size: 2 }]);
  assert.deepEqual(ops(r.steps), ['move:1', '+move:2', '+color:3', 'move:1', '+size:2']);
  assert.deepEqual(keyframes(r.steps), [{ start: 0, end: 3 }, { start: 3, end: 5 }]);
  const s = new Scene();
  for (const l of ['A', 'B', 'C']) s.addNode(l, 0, 0);
  assert.match(stepsToLua(r.steps, s), /move\(A, 10, 0, 0\.5\)\nmove\(B, 20, 0, 0\.5\)\ncolor\(C, "red", 0\.5\); wait\(0\.5\)\nmove\(A, 50, 0, 0\.5\)\nsize\(B, 2, 2, 0\.5\); wait\(0\.5\)/);
});

test('a second change to the same thing in a keyframe updates it: moves carry on as one curve', () => {
  let r = recordSteps([], 0, [{ op: 'move', target: 1, x: 10, y: 0 }, { op: 'color', target: 1, color: 'red' }]);
  r = recordSteps(r.steps, r.point, [{ op: 'path', target: 1, points: [{ x: 20, y: 10 }, { x: 30, y: 0 }] }, { op: 'color', target: 1, color: 'blue' }]);
  assert.equal(r.steps.length, 2);
  assert.deepEqual(r.steps[0], { op: 'path', target: 1, points: [{ x: 10, y: 0 }, { x: 20, y: 10 }, { x: 30, y: 0 }], dur: 500, together: false });
  assert.equal(r.steps[1].color, 'blue');
  r = recordSteps(r.steps, r.point, [{ op: 'move', target: 1, x: 99, y: 0 }]);
  assert.deepEqual(r.steps[0].points.at(-1), { x: 99, y: 0 });
  const two = recordSteps(recordSteps([], 0, [{ op: 'move', target: 1, x: 10, y: 0 }]).steps, 1, [{ op: 'move', target: 1, x: 10, y: 10 }]);
  assert.deepEqual(two.steps, [{ op: 'path', target: 1, points: [{ x: 10, y: 0 }, { x: 10, y: 10 }], dur: 500, together: false }], 'two straight drags: one move round the corner');
});

test('a pause is a keyframe of its own; points snap to keyframe ends; removing a first step keeps the keyframe', () => {
  let r = recordSteps([], 0, [{ op: 'move', target: 1, x: 1, y: 1 }, { op: 'move', target: 2, x: 2, y: 2 }]);
  r = recordSteps(r.steps, r.point, [{ op: 'wait' }]);
  r = recordSteps(r.steps, r.point, [{ op: 'color', target: 1, color: 'red' }]); // after a pause: a new keyframe
  assert.deepEqual(keyframes(r.steps), [{ start: 0, end: 2 }, { start: 2, end: 3 }, { start: 3, end: 4 }]);
  assert.equal(keyframeEndAt(r.steps, 1), 2);
  assert.equal(keyframeEndAt(r.steps, 0), 0);
  const left = removeStep(r.steps, 0);
  assert.deepEqual(ops(left), ['move:2', 'wait:', 'color:1']);
  assert.deepEqual(keyframes(left).length, 3);
});
