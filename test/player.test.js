import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { sceneAt, frameTimes } from '../core/player.js';

const nodeAt = (tl, t, id = 1) => sceneAt(tl, t).nodes.find((n) => n.id === id);

test('colour is interpolated halfway through a tween and exact at the end', () => {
  const { timeline } = run('A = node("A", 0, 0)', 'color(A, "#ffffff", 1)');
  assert.equal(nodeAt(timeline, 0).color, '#cccccc');
  assert.equal(nodeAt(timeline, 500).color, '#e6e6e6');
  assert.equal(nodeAt(timeline, 1000).color, '#ffffff');
});

test('move interpolates position linearly', () => {
  const { timeline } = run('A = node("A", 0, 0)', 'move(A, 100, 50, 2)');
  const n = nodeAt(timeline, 500);
  assert.deepEqual([n.x, n.y], [25, 12.5]);
});

test('a second tween starting mid-way continues from the current value', () => {
  // move to x=100 over 1 s; at 0.5 s (x=50) start moving back to x=0 over 1 s
  const { timeline } = run('A = node("A", 0, 0)', 'move(A, 100, 0, 1); wait(0.5); move(A, 0, 0, 1)');
  assert.equal(nodeAt(timeline, 500).x, 50);
  assert.equal(nodeAt(timeline, 1000).x, 25);
  assert.equal(nodeAt(timeline, 1500).x, 0);
});

test('objects only exist after their create command', () => {
  const { timeline } = run('', 'wait(1); node("X", 0, 0)');
  assert.equal(sceneAt(timeline, 999).nodes.length, 0);
  assert.equal(sceneAt(timeline, 1000).nodes.length, 1);
});

test('frameTimes covers the whole duration', () => {
  assert.deepEqual(frameTimes(100, 25), [0, 40, 80]);
  assert.equal(frameTimes(4300, 25).length, 108);
});

test('rendered colours use the engine palette, so a finished tween matches its last blended frame', async () => {
  const { renderSVG } = await import('../core/svg.js');
  const { timeline } = run('A = node("A", 0, 0)', 'color(A, "red", 1)');
  const fill = (t) => /<circle[^>]*fill="([^"]+)"/.exec(renderSVG(sceneAt(timeline, t)))[1];
  assert.equal(fill(1000), '#e53935');
  assert.equal(fill(990), '#e53a37'); // 99% of the way from #cccccc: next to it, not a jump to CSS red
});
