import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run, example } from './helpers.js';
import { ScriptError } from '../core/lua_api.js';
import { frameTimes } from '../core/player.js';

test('DFS example: command count, duration, frame count and visit order', () => {
  const r = run(example('stage.lua'), example('dfs.lua'));
  const cmds = r.timeline.commands;
  assert.equal(r.stageCommands, 7);
  assert.equal(cmds.length, 18);
  assert.equal(r.timeline.durationMs, 4300);
  assert.equal(frameTimes(r.timeline.durationMs, 25).length, 109); // the last frame (4.32 s) shows the finished search
  const visits = cmds.filter((c) => c.op === 'set' && c.value === 'red' && r.scene.get(c.id).kind === 'node');
  assert.deepEqual(visits.map((c) => r.scene.nameOf(c.id)), ['A', 'B', 'D', 'C']);
  assert.deepEqual(visits.map((c) => c.t), [0, 800, 1600, 3000]);
});

test('neighbors and edge_of are available from Lua', () => {
  const r = run('A = node("A",0,0) B = node("B",0,0) C = node("C",0,0) edge(A,B) edge(C,A)',
    'print(#neighbors(A), neighbors(A)[2] == C, edge_of(B, A) == edge_of(A, B), edge_of(B, C))');
  assert.deepEqual(r.log, ['2\ttrue\ttrue\tnil']);
});

test('errors report the file and line', () => {
  const stage = 'A = node("A", 0, 0)';
  assert.throws(() => run(stage, '\ncolor(A, "redd")'), (e) => e instanceof ScriptError && /^script\.lua:2: unknown colour 'redd'/.test(e.message));
  assert.throws(() => run(stage, 'color(99, "red")'), /script\.lua:1: .*no object with id 99/);
  assert.throws(() => run('node("A")'), /stage\.lua:1: bad argument #2/);
  assert.throws(() => run(stage, 'wait(-1)'), /wait time must be >= 0/);
});

test('infinite loops are stopped', () => {
  assert.throws(() => run('', 'while true do end'), /ran too long/);
});

test('scripts have no file or OS access', () => {
  const r = run('', 'print(io, os, require, dofile, loadfile)');
  assert.deepEqual(r.log, ['nil\tnil\tnil\tnil\tnil']);
});
