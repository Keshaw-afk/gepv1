// Tables (cell, grid), label changes and maths in labels.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fengari from 'fengari';
import { run, example } from './helpers.js';
import { labelParts, labelText, labelMarkup } from '../core/labels.js';
import { sceneAt } from '../core/player.js';
import { renderSVG, esc } from '../core/svg.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { codeToSteps, ConvertError } from '../core/code_steps.js';
import { Scene } from '../core/scene.js';
import { toStageLua } from '../core/stage_file.js';
import { halfSize } from '../core/shapes.js';

test('maths: symbols, shortcuts, subscripts and superscripts; text outside $ is as written', () => {
  assert.equal(labelText('$a \\le b$'), 'a ≤ b');
  assert.equal(labelText('$i-1 <= n != m -> k$'), 'i−1 ≤ n ≠ m → k');
  assert.equal(labelText('cost $5 and x-y'), 'cost $5 and x-y', 'an unclosed $ and text outside maths stay');
  assert.equal(labelText('\\$5'), '$5');
  assert.equal(labelText('$\\alpha + \\Omega \\nwarrow \\foo$'), 'α + Ω ↖ \\foo', 'an unknown command is shown as typed');
  assert.deepEqual(labelParts('$c_{i,j} = x^2$'), [{ s: 'c', shift: 0 }, { s: 'i,j', shift: 'sub' }, { s: ' = x', shift: 0 }, { s: '2', shift: 'sup' }]);
  assert.deepEqual(labelParts('$c_{i-1}$')[1], { s: 'i−1', shift: 'sub' }, 'maths inside a group');
  // what a Lua escape made of a command is read back: "\times" is a tab and "imes"
  assert.equal(labelText('$a \times b \to c$'), 'a × b → c');
  assert.equal(labelMarkup('$x_i < y$', esc), 'x<tspan dy="4" font-size="12">i</tspan><tspan dy="-4"> &lt; y</tspan>');
  assert.equal(labelMarkup('a<b', esc), 'a&lt;b', 'a plain label is only escaped');
  assert.ok(halfSize('text', '$\\alpha$').x < halfSize('text', '$\\alpha$ long words').x);
  assert.equal(halfSize('text', '$\\alpha \\le \\beta$').x, halfSize('text', 'α ≤ β').x, 'the width is the shown text');
});

test('grid makes rows of cells from the top-left corner; t[r][c] counts from 1', () => {
  const r = run('', 't = grid(2, 3, 100, 50, 1.5, 1)\nlabel(t[2][3], 7)');
  const cells = r.scene.nodes();
  assert.equal(cells.length, 6);
  assert.ok(cells.every((n) => n.shape === 'cell' && n.color === '#ffffff'));
  assert.deepEqual([cells[0].x, cells[0].y], [130, 65], 'first cell centre: 100 + 60/2, 50 + 30/2');
  assert.deepEqual([cells[5].x, cells[5].y, cells[5].label], [250, 95, '7']);
  assert.throws(() => run('', 'grid(0, 3, 0, 0)'), /at least 1 row/);
  assert.throws(() => run('', 'grid(30, 30, 0, 0)'), /at most 400 cells/);
  assert.throws(() => run('', 'label(A, "x")'), /number expected|no node/);
});

test('label changes at once, in the player, in stage.lua (a starting label) and in a saved stage', () => {
  const r = run('A = node("A", 100, 100)\nlabel(A, "start")', 'wait(1)\nlabel(A, "$x^2$")\nwait(1)\nlabel(A, "A")');
  assert.equal(r.timeline.commands.filter((c) => c.prop === 'label').length, 2, 'the stage label is the starting label, not a change');
  assert.equal(sceneAt(r.timeline, 999).nodes[0].label, 'start');
  assert.equal(sceneAt(r.timeline, 1000).nodes[0].label, '$x^2$');
  assert.equal(sceneAt(r.timeline, 2000).nodes[0].label, 'A');
  const cellStage = new Scene();
  cellStage.addNode('7', 120, 80, 'cell');
  assert.match(toStageLua(cellStage), /cell\("7", 120, 80\)/, 'a cell saves as cell()');
});

test('frames draw maths labels with tspans and keep the spaces', () => {
  const r = run('t = text("$c_{i,j} = 1$", 320, 60)');
  const svg = renderSVG(sceneAt(r.timeline, 0), { export: true });
  assert.match(svg, /<text y="6" xml:space="preserve" fill="[^"]+">c<tspan dy="4" font-size="12">i,j<\/tspan><tspan dy="-4"> = 1<\/tspan><\/text>/);
});

test('the animated SVG shows each label for exactly its stretch of time', () => {
  const r = run('B = rect("0", 300, 100)', 'label(B, "1"); wait(0.3); label(B, "2"); label(B, "3"); wait(0.2); label(B, "1")');
  const svg = renderAnimatedSVG(r.timeline);
  const texts = svg.match(/<text[^>]*>[^<]*(?:<set[^>]*\/>)*<\/text>/g);
  // "0" lasts no time (changed at once), "2" lasts no time either
  assert.deepEqual(texts.map((t) => />([^<]*)</.exec(t)[1]), ['1', '3', '1']);
  assert.match(texts[0], /to="none" begin="0.3s"/);
  assert.match(texts[1], /display="none".*to="inline" begin="0.3s".*to="none" begin="0.5s"/);
  assert.match(texts[2], /display="none".*to="inline" begin="0.5s"/);
  assert.match(svg, /<g class="label" fill="#000000">/);
  const plain = renderAnimatedSVG(run('A = node("A", 1, 1)', 'move(A, 50, 50, 1)').timeline);
  assert.doesNotMatch(plain, /class="label"/, 'a label that never changes is drawn as before');
});

test('code that changes a label stays a code keyframe; a grid at the start goes into the picture', () => {
  const scene = run('A = node("A", 100, 100)').scene;
  assert.throws(() => codeToSteps(fengari, scene, [], 'label(A, "x")'), (e) => e instanceof ConvertError && /changes a label/.test(e.message));
  const r = codeToSteps(fengari, new Scene(), [], 't = grid(1, 2, 100, 100)\nlabel(t[1][2], "5")');
  assert.deepEqual(r.scene.nodes().map((n) => [n.shape, n.label]), [['cell', ''], ['cell', '5']]);
  assert.equal(r.steps.length, 0);
});

test('the LCS example fills the textbook table and finds BCBA', () => {
  const r = run('', example('lcs.lua'));
  const end = sceneAt(r.timeline, r.timeline.durationMs);
  const cells = end.nodes.filter((nd) => nd.shape === 'cell').map((nd) => nd.label);
  assert.equal(cells.length, 9 * 8);
  assert.deepEqual(cells.slice(8 * 8), ['B', '0', '↖1', '↑2', '↑2', '↑3', '↖4', '↑4'], 'the last row');
  assert.ok(end.nodes.some((nd) => nd.label === 'LCS = BCBA  (length 4)'));
});
