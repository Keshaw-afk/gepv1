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

test('a code keyframe plays exactly like the same Lua as script.lua', async () => {
  const { toEditorIds, sourceOf, isLocked } = await import('../core/steps.js');
  const { sceneAt } = await import('../core/player.js');
  const stageScene = runProgram(fengari, { stage: example('stage.lua') }).scene;
  const first = [{ op: 'move', target: stageScene.nodes()[0].id, x: 120, y: 200, dur: 700 }]; // a GUI step first
  const same = (c) => [c.op, c.id, c.t, c.dur, JSON.stringify(c.value ?? c.props)];
  for (const [name, scene] of [['dfs.lua', stageScene], ['bfs.lua', stageScene], ['packets.lua', stageScene], ['sort.lua', new Scene()]]) {
    const stage = (await import('../core/stage_file.js')).toStageLua(scene);
    const before = scene === stageScene ? first : [];
    const asScript = runProgram(fengari, { stage, steps: buildSteps(before, scene).code, script: example(name) });
    const steps = [...before, { op: 'code', id: 's9', lua: example(name) }];
    const built = buildSteps(steps, scene);
    const asStep = runProgram(fengari, { stage, steps: built.code });
    assert.deepEqual(asStep.timeline.commands.map(same), asScript.timeline.commands.map(same), name);
    assert.equal(asStep.timeline.durationMs, asScript.timeline.durationMs, name);
    // what a code keyframe makes is shown, with ids of its own, and can't be edited
    const view = toEditorIds(sceneAt(asStep.timeline, asStep.timeline.durationMs), asStep, scene, steps, built.stepAtLine);
    if (name === 'sort.lua') assert.ok(view.nodes.length && view.nodes.every((n) => n.locked && /^s9\.\d+$/.test(n.id)), 'sort makes its cells');
    else assert.ok(view.nodes.filter((n) => typeof n.id === 'number').every((n) => !n.locked && !isLocked(n.id)), 'stage objects stay editable');
    assert.equal(sourceOf(steps, steps.length, stageScene.nodes()[0].id, 'color'), steps.length - 1, 'a code keyframe decides what comes after it');
  }
});

test('REPL entries keep the variable names typed, so the next entry can use them', () => {
  const a = codeToSteps(fengari, new Scene(), [], 'b = node("ball", 100, 100)');
  assert.equal(a.scene.nodes()[0].name, 'b', 'at Start: the starting picture keeps the name');
  const b = codeToSteps(fengari, a.scene, [], 'move(b, 300, 100, 1)');
  const c = codeToSteps(fengari, b.scene, b.steps, 'q = rect("queue", 320, 300)\ncolor(b, "red")');
  assert.equal(c.steps.find((s) => s.op === 'add').name, 'q', 'later: the add step keeps it');
  const d = codeToSteps(fengari, c.scene, c.steps, 'color(q, "red")\nmove(b, 100, 100, 1)', { taken: [{ op: 'add', id: 's7' }] });
  assert.match(buildSteps(d.steps, d.scene).code, /q = rect\("queue", 320, 300\)[\s\S]*color\(q, "red"/);
  assert.ok(d.steps.slice(-2).every((s) => s.id === undefined || s.id === 's8'));
});
