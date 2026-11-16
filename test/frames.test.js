import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import fengari from 'fengari';
import { run, example } from './helpers.js';
import { runProgram } from '../core/lua_api.js';
import { buildSteps } from '../core/steps.js';
import { Scene } from '../core/scene.js';
import { sceneAt, frameTimes } from '../core/player.js';
import { renderSVG } from '../core/svg.js';
import { outputSettings } from '../core/output.js';
import { frameAt, frameFrom, landmarks, renderFrame, frameName } from '../core/frames.js';

const ids = (svg) => [...svg.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]);

test('exported SVG: every object has a safe, unique id; awkward labels fall back to node-<id>', () => {
  const { timeline } = run('A = node("A",0,0) T = node("time",0,0) F = node("5",0,0) P = node("p 1",0,0) A2 = node("A",0,0) edge(A, T) edge(F, P)');
  const svg = renderSVG(sceneAt(timeline, 0), { export: true });
  assert.deepEqual(ids(svg), ['A-time', 'node-3-node-4', 'A', 'time', 'node-3', 'node-4', 'node-5']);
  assert.match(svg, /<g id="node-4" class="node circle" transform="translate\(0 0\)">\n {4}<circle r="24" [^>]*\/>\n {4}<text [^>]*>p 1<\/text>\n {2}<\/g>/);
  assert.match(svg, /<style>[\s\S]*\.node circle, \.node rect, \.node polygon \{ stroke: #333333/);
});

test('exported ids stay the same in every frame, even when objects appear later', () => {
  const { timeline } = run(example('stage.lua'), example('packets.lua'));
  const times = frameTimes(timeline.durationMs, 25);
  const first = ids(renderFrame(timeline, times, 0, outputSettings()));
  const last = ids(renderFrame(timeline, times, times.length - 1, outputSettings()));
  assert.deepEqual(last.slice(0, first.length), first);
  assert.ok(last.includes('p3'));
});

test('the page (inline) flavour has no ids or <style> that could leak into the page', () => {
  const { timeline } = run('X = node("time", 0, 0)');
  const svg = renderSVG(sceneAt(timeline, 0), { interactive: true });
  assert.doesNotMatch(svg, / id=|<style/);
});

test('output settings: size, background, font and frame rate are adjustable and validated', () => {
  const { timeline } = run('A = node("A", 0, 0)');
  const svg = renderSVG(sceneAt(timeline, 0), { export: true, output: outputSettings({ scale: 2, background: 'transparent', font: 'monospace' }) });
  assert.match(svg, /width="1280" height="720" viewBox="0 0 640 360"/);
  assert.doesNotMatch(svg, /<rect/);
  assert.match(svg, /font-family: monospace/);
  assert.equal(outputSettings({ background: 'navy' }).background, '#283593');
  assert.equal(outputSettings({ fps: '30' }).fps, 30);
  for (const bad of [{ scale: 4 }, { fps: 0 }, { fps: 2.5 }, { font: 'Comic Sans' }, { background: 'nope' }]) {
    assert.throws(() => outputSettings(bad));
  }
});

test('frameAt / frameFrom find frames on the grid; the last frame shows the finished state', () => {
  const times = frameTimes(4300, 25); // 0, 40, ..., 4320
  assert.equal(frameAt(times, 0), 0);
  assert.equal(frameAt(times, 79), 1);
  assert.equal(frameAt(times, 80), 2);
  assert.equal(frameFrom(times, 81), 3);
  assert.equal(frameFrom(times, 99999), times.length - 1);
  const { timeline } = run(example('stage.lua'), example('dfs.lua'));
  const end = sceneAt(timeline, times.at(-1));
  assert.ok(end.nodes.every((nd) => nd.color === 'black'));
  assert.equal(frameName(43), 'frame_00043.svg');
});

test('landmarks: the frames where changes have just finished, with their source lines', () => {
  const { timeline } = run(example('stage.lua'), example('dfs.lua'));
  const times = frameTimes(timeline.durationMs, 25);
  const marks = landmarks(timeline, times);
  assert.equal(marks.length, 11); // the 11 colour changes all finish on different frames
  assert.deepEqual(marks.slice(0, 3).map((m) => m.frame), [13, 25, 33]); // 0.50 s, 1.00 s, 1.30 s
  for (const m of marks) {
    for (const c of m.cmds) {
      const end = c.t + c.dur; // the first frame at or after the end of the change
      assert.ok(times[m.frame] >= end && times[m.frame - 1] < end);
    }
  }
  const visitA = sceneAt(timeline, marks[0].t).nodes.find((nd) => nd.label === 'A');
  assert.equal(visitA.color, 'red');
  assert.deepEqual(marks[0].cmds[0].src, { file: 'script.lua', line: 6 });
});

test('steps.lua lines map back to steps, including steps that play together', () => {
  const s = new Scene();
  const A = s.addNode('A', 0, 0), B = s.addNode('B', 100, 0);
  const steps = [
    { op: 'color', target: A, color: 'red', dur: 500 },
    { op: 'color', target: B, color: 'red', dur: 500, together: true },
    { op: 'wait', dur: 200 },
    { op: 'move', target: B, x: 50, y: 60, dur: 500 },
  ];
  const { code, stepAtLine } = buildSteps(steps, s);
  const r = runProgram(fengari, { stage: 'A = node("A", 0, 0)\nB = node("B", 100, 0)', steps: code });
  const fromSteps = r.timeline.commands.filter((c) => c.src?.file === 'steps.lua');
  assert.deepEqual(fromSteps.map((c) => stepAtLine[c.src.line]), [0, 1, 3]);
});

test('CLI --frame N writes that one frame, numbered like the page and --frames', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gepv1-test-'));
  try {
    const out = path.join(dir, 'f.svg');
    const ex = (f) => new URL(`../examples/${f}`, import.meta.url).pathname;
    const cli = new URL('../node/cli.js', import.meta.url).pathname;
    const r = spawnSync(process.execPath, [cli, ex('stage.lua'), ex('dfs.lua'), '--frame', '54', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(fs.readFileSync(out, 'utf8'), /<!-- GEPV1 frame 54 \/ 108, t = 2\.16 s -->/);
    const bad = spawnSync(process.execPath, [cli, ex('stage.lua'), ex('dfs.lua'), '--frame', '109', out], { encoding: 'utf8' });
    assert.match(bad.stderr, /--frame must be 0 to 108/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
