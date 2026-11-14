import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from './helpers.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';

test('a colour tween becomes one <animate> starting from the current colour', () => {
  const { timeline } = run('A = node("A", 0, 0)', 'wait(1); color(A, "red", 0.5)');
  const svg = renderAnimatedSVG(timeline);
  assert.match(svg, /<animate attributeName="fill" from="#cccccc" to="#e53935" begin="1s" dur="0.5s" fill="freeze"\/>/);
});

test('moving a node also moves the ends of its edges', () => {
  const { timeline } = run('A = node("A", 0, 0); B = node("B", 100, 0); edge(A, B)', 'move(B, 100, 50, 1)');
  const line = /<line[\s\S]*?<\/line>/.exec(renderAnimatedSVG(timeline))[0];
  assert.match(line, /attributeName="x2" from="100" to="100"/);
  assert.match(line, /attributeName="y2" from="0" to="50"/);
});

test('objects created later stay hidden until then', () => {
  const { timeline } = run('', 'wait(2); node("P", 5, 5)');
  const svg = renderAnimatedSVG(timeline);
  assert.match(svg, /<circle [^>]*visibility="hidden">\s*<set attributeName="visibility" to="visible" begin="2s"/);
});
