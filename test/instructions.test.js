import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitInstructions, fromWords, obviousCall, namesIn, placesIn, toolFromWords } from '../core/instructions.js';
import { carryOut } from '../core/ai_loop.js';
import { newProject, runTool, endState, briefState, objectNames } from '../core/ai_tools.js';

test('a message is split into single instructions; coordinates, decimals and "A and B" stay whole', () => {
  assert.deepEqual(splitInstructions('Draw a circle A at (100, 100) and a box B at (400, 100). Then move A to (300, 250) in 2.5 seconds and at the same time turn B red; wait 1 second\nhide it'), [
    'Draw a circle A at (100, 100)', 'Draw a box B at (400, 100)', 'move A to (300, 250) in 2.5 seconds',
    'at the same time turn B red', 'wait 1 second', 'hide it',
  ]);
  assert.deepEqual(splitInstructions('Draw A and B, then move them'), ['Draw A and B', 'move them']);
  assert.deepEqual(splitInstructions('Draw three circles called 1, 2 and 3 at (1, 2), (3, 4) and (5, 6).'), ['Draw three circles called 1, 2 and 3 at (1, 2), (3, 4) and (5, 6)']);
  assert.equal(placesIn('at (1, 2), (3, 4) and (5, 6)'), 3);
});

test("the user's words win over a small model's guesses", () => {
  // together only when said; seconds as said; "by" is a distance; "these" and "them"
  assert.deepEqual(fromWords('move them right by 100', 'move', { label: 'P', x: 100, seconds: 100, together: true }), { label: 'them', right: 100 });
  assert.deepEqual(fromWords('move it 50 pixels to the left in 2.5 s', 'move', { x: 1, arc: true }), { seconds: 2.5, left: 50 });
  assert.deepEqual(fromWords('at the same time turn B red', 'color', { label: 'A', color: 'red' }, ['A', 'B']), { label: 'B', color: 'red', together: true });
  assert.deepEqual(fromWords('Make these red', 'color', { label: 'P', color: 'red' }), { label: 'selected', color: 'red' });
  assert.deepEqual(fromWords('turn the red ones blue', 'color', { label: 'A', color: 'red' }), { label: 'the red ones', color: 'blue' });
  assert.deepEqual(fromWords('Move everything down by 50', 'move', { label: 'A', down: 50 }), { label: 'everything', down: 50 });
  // drawing copies what was typed and never invents a label
  assert.deepEqual(fromWords('Draw a circle Y at (500, 300)', 'draw', { shape: 'circle', label: 'X', x: 5, y: 3 }, ['X']), { shape: 'circle', label: 'Y', x: 500, y: 300 });
  assert.deepEqual(fromWords('draw a green triangle at (320, 200)', 'draw', { shape: 'circle', label: 'A' }), { shape: 'triangle', color: 'green', x: 320, y: 200 });
  assert.deepEqual(fromWords('an arrow from it to the circle', 'connect', { from: 'O', to: 'circle' }), { from: 'it', to: 'circle', arrow: true });
  assert.deepEqual(namesIn('Make A1 and a red', ['A', 'A1']), ['A1'], 'a one-letter name only as a capital');
  assert.deepEqual(obviousCall('hide it'), { name: 'remove', args: {} });
  assert.deepEqual(obviousCall('wait 2 seconds'), { name: 'wait', args: { seconds: 2 } });
  assert.equal(obviousCall('dance'), null);
  // the verb, when the words leave no doubt; scale words
  assert.equal(toolFromWords('at the same time make queue yellow'), 'color');
  assert.equal(toolFromWords('make it twice as big'), 'resize');
  assert.equal(toolFromWords('hide it'), 'remove');
  assert.equal(toolFromWords('move them right by 100'), null);
  assert.equal(toolFromWords('draw a green triangle'), null);
  assert.equal(toolFromWords('Draw a line from start to end'), 'connect');
  assert.equal(toolFromWords('Make the triangles yellow'), 'color');
  assert.deepEqual(fromWords('Draw a line from start to end', 'connect', { from: 'start' }, ['start', 'end']), { from: 'start', to: 'end', arrow: false });
  assert.deepEqual(fromWords('an arrow from it to the circle', 'connect', {}, ['O']), { from: 'it', to: 'circle', arrow: true });
  assert.deepEqual(fromWords('Grow them to three times their size', 'resize', { label: 'M', size: 3 }), { label: 'them', scale: 3 });
  assert.deepEqual(fromWords('make it half the size', 'resize', { width: 10 }), { scale: 0.5 });
});

test('describing a shape just drawn sets its look; changing one that was there already is animated', () => {
  const p = newProject();
  runTool(p, 'draw', { shape: 'circle', label: 'A', x: 100, y: 100 });
  runTool(p, 'color', { color: 'red' });
  assert.equal(p.scene.get(1).color, 'red');
  assert.equal(p.steps.length, 0);
  p.fresh = []; // as if the user had drawn it by hand
  runTool(p, 'color', { label: 'A', color: 'blue' });
  runTool(p, 'remove', {});
  assert.deepEqual(p.steps.map((s) => s.op), ['color', 'remove'], 'it turns blue, then disappears');
});

test('the loop gives a model one instruction at a time, fixes its guesses, retries errors, finishes lists', async () => {
  const p = newProject();
  // a scripted "model": answers by the instruction it is given
  const script = {
    'Draw circles called 1 and 2 at (100, 100) and (300, 100)': [[['draw', { shape: 'circle', label: '1', x: 100, y: 100 }]], [['draw', { shape: 'circle', label: '2', x: 300, y: 100 }]]],
    'move them right by 50 in 2 seconds': [[['move', { label: '1', x: 50 }]]],
    'at the same time make 1 red': [[['color', { label: '9', color: 'red' }]], [['color', { label: '1', color: 'red' }]]],
    'hide it': [[], []],
  };
  const seen = [];
  const ask = async (messages) => {
    const said = messages[1].content.split('Instruction: ')[1];
    seen.push(messages[1].content);
    const k = messages.filter((m) => m.role === 'assistant').length;
    const calls = script[said][k] ?? [];
    return { content: calls.length ? '' : 'I will hide it.', tool_calls: calls.map(([name, args], i) => ({ id: `${k}${i}`, function: { name, arguments: JSON.stringify(args) } })) };
  };
  const run = (name, args) => { try { return { text: runTool(p, name, args) }; } catch (e) { return { error: e.message }; } };
  const { calls, failed } = await carryOut('Draw circles called 1 and 2 at (100, 100) and (300, 100). Then move them right by 50 in 2 seconds, and at the same time make 1 red; then hide it.',
    { ask, run, brief: () => briefState(p), names: () => objectNames(p) });
  assert.deepEqual(failed, []);
  assert.deepEqual(calls.map((c) => [c.name, !!c.error]), [['draw', false], ['draw', false], ['move', false], ['color', true], ['color', false], ['remove', false]]);
  assert.match(seen[2], /Objects: 1 \(circle at 100, 100\); 2 \(circle at 300, 100\)\. "it" = 2\.\nThis is instruction 2 of 4/);
  const end = endState(p);
  assert.deepEqual([...end.values()].map((o) => [o.name, o.x]), [['2', 350]], '1 and 2 moved by 50 together; 1 is hidden at the end');
  assert.equal(calls[2].args.label, 'them');
  assert.equal(calls.at(-1).guessed, true);
});
