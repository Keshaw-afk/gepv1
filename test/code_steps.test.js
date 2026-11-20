// Code -> steps (core/code_steps.js): exact or refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fengari from 'fengari';
import { codeToSteps, ConvertError } from '../core/code_steps.js';
import { Scene } from '../core/scene.js';
import { buildSteps } from '../core/steps.js';
import { example } from './helpers.js';
import { runProgram } from '../core/lua_api.js';

test('code that plays one change after another becomes the starting picture and steps', () => {
  const r = codeToSteps(fengari, new Scene(), [], 'ball = node("ball", 80, 180)\nmove(ball, 560, 180, 2)\nwait(2)\ncolor(ball, "red")\nwait(0.5)\nmove(ball, 80, 180, 2, "smooth")');
  assert.deepEqual(r.scene.nodes().map((n) => [n.label, n.x, n.y]), [['ball', 80, 180]], 'made at once: the starting picture');
  assert.deepEqual(r.steps.map((s) => s.op), ['move', 'color', 'move']);
  assert.equal(r.steps[2].ease, 'smooth');
  assert.match(buildSteps(r.steps, r.scene).code, /move\(ball, 80, 180, 2, "smooth"\)/);
});

test('curves keep the points they were given; lines go with their node', () => {
  const r = codeToSteps(fengari, new Scene(), [], 'a = node("a", 60, 300)\nb = node("b", 300, 300)\nedge(a, b)\npath(a, {{320, 60}, {580, 300}}, 2)\nwait(2)\nremove(a)');
  assert.deepEqual(r.steps.find((s) => s.op === 'path').points, [{ x: 320, y: 60 }, { x: 580, y: 300 }]);
  assert.equal(r.steps.filter((s) => s.op === 'remove').length, 1);
});

test('the Router network example converts exactly; overlapping code is refused with the line to change', () => {
  assert.ok(codeToSteps(fengari, new Scene(), [], example('network.lua')).steps.length > 10);
  const stage = runProgram(fengari, { stage: example('stage.lua') }).scene;
  assert.throws(() => codeToSteps(fengari, stage, [], example('dfs.lua')), (e) => e instanceof ConvertError && /^Line \d+ starts at .* still going/.test(e.message));
  assert.throws(() => codeToSteps(fengari, new Scene(), [], 'a = node("a", 1, 1)\nwait(1)\nmove(a, 5, 5, 0)'), /at once \(0 s\)/);
  assert.throws(() => codeToSteps(fengari, new Scene(), [], 'print("hi")'), /changes nothing/);
});
