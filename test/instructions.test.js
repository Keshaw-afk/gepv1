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
  assert.deepEqual(calls.map((c) => [c.name, !!c.error]), [['draw', false], ['draw', false], ['move', false], ['color', false], ['remove', false]], 'the made-up label 9 is fixed from the words ("make 1 red")');
  assert.match(seen[2], /Objects: 1 \(circle at 100, 100\); 2 \(circle at 300, 100\)\. "it" = 2\.\nThis is instruction 2 of 4/);
  const end = endState(p);
  assert.deepEqual([...end.values()].map((o) => [o.name, o.x]), [['2', 350]], '1 and 2 moved by 50 together; 1 is hidden at the end');
  assert.equal(calls[2].args.label, 'them');
  assert.equal(calls.at(-1).guessed, true);
});

test('plain words: rename, sizes in pixels, no invented colour or place', async () => {
  const { toolFromWords } = await import('../core/instructions.js');
  assert.deepEqual(splitInstructions('name the circle Bomb and increase its radius by 50'), ['name the circle Bomb', 'increase its radius by 50']);
  assert.deepEqual(splitInstructions('Draw a triangle and label it T'), ['Draw a triangle', 'label it T']);
  assert.equal(toolFromWords('name the circle Bomb'), 'rename');
  assert.equal(toolFromWords('increase its radius by 50'), 'resize');
  assert.equal(toolFromWords('move it right by 50'), null);
  assert.deepEqual(fromWords('name the circle Bomb', 'rename', { label: 'A' }, ['circle 1']), { label: 'the circle', text: 'Bomb' });
  assert.deepEqual(fromWords('rename circle 1 to Sun', 'rename', {}, ['circle 1']), { label: 'circle 1', text: 'Sun' });
  assert.deepEqual(fromWords('call it queue', 'rename', { label: 'box' }, ['box 1']), { text: 'queue' });
  assert.deepEqual(fromWords('increase its radius by 50', 'resize', { scale: 2 }), { add_size: 100 });
  assert.deepEqual(fromWords('make it 100 pixels wider', 'resize', {}), { add_width: 100 });
  assert.deepEqual(fromWords('reduce its height by 20', 'resize', {}), { add_height: -20 });
  assert.deepEqual(fromWords('make its radius 60', 'resize', { scale: 60 }), { radius: 60 });
  assert.deepEqual(fromWords('draw a circle', 'draw', { shape: 'circle', color: 'red', x: 0, y: 0, label: 'circle', size: 30 }), { shape: 'circle' });
  assert.equal(fromWords('make A red', 'color', { label: 'Q', color: 'red' }, ['A']).label, 'A', 'a made-up name: the one the user said');

  const p = newProject();
  runTool(p, 'draw', { shape: 'circle' });
  runTool(p, 'rename', fromWords('name the circle Bomb', 'rename', {}, objectNames(p)));
  runTool(p, 'resize', fromWords('increase its radius by 50', 'resize', {}, objectNames(p)));
  const bomb = [...endState(p).values()].find((o) => o.name === 'Bomb');
  assert.equal(bomb.size, 3.08, 'radius 24 + 50 = 74');
  runTool(p, 'draw', { shape: 'box', label: 'Q' });
  runTool(p, 'resize', { label: 'Q', add_width: 100 });
  assert.deepEqual([...endState(p).values()].find((o) => o.name === 'Q').size, { w: 2.56, h: 1 }, '64 + 100 wide, same height');
});

test('the loop refuses a colour change the words never asked for', async () => {
  const p = newProject();
  runTool(p, 'draw', { shape: 'circle' });
  const ask = async () => ({ content: '', tool_calls: [{ id: '1', function: { name: 'color', arguments: '{"label":"A","color":"red"}' } }] });
  const run = (name, args) => { try { return { text: runTool(p, name, args) }; } catch (e) { return { error: e.message }; } };
  const { calls } = await carryOut('make it pulse', { ask, run, brief: () => briefState(p), names: () => objectNames(p), retries: 0 });
  assert.ok(calls.every((c) => c.error), 'nothing turned red');
  assert.equal([...endState(p).values()][0].color, '#cccccc');
});

test('"centre the bomb" and "different colours … 6 times"', () => {
  const p = newProject();
  runTool(p, 'draw', { shape: 'circle', label: 'bomb' });
  runTool(p, 'color', { label: 'bomb', color: 'blue' });
  assert.equal(toolFromWords('center the bomb'), 'move');
  runTool(p, 'move', fromWords('center the bomb', 'move', { label: 'bomb', x: 80, y: 60 }, objectNames(p)));
  const step = 'change the color of the bomb to different colors in 0.6 seconds, 6 times';
  assert.equal(toolFromWords(step), 'color');
  const args = fromWords(step, 'color', { label: 'bomb', color: 'red' }, objectNames(p));
  assert.deepEqual(args, { label: 'bomb', color: 'different', times: 6, seconds: 0.6 });
  runTool(p, 'color', args);
  const colours = p.steps.filter((s) => s.op === 'color').map((s) => s.color);
  assert.equal(colours.length, 6);
  assert.ok(colours.every((c, i) => c !== (colours[i - 1] ?? '#1e88e5')), 'each one new, starting from blue');
  assert.ok(p.steps.filter((s) => s.op === 'color').every((s) => s.dur === 600));
  const bomb = [...endState(p).values()][0];
  assert.deepEqual([bomb.x, bomb.y], [320, 180]);
  assert.equal(fromWords('make A flash red three times', 'color', { label: 'A', color: 'red' }, ['A']).times, 3);
  assert.equal(fromWords('make A three times as big', 'resize', {}, ['A']).times, undefined);
});

test('"flash red three times" is a colour change, "three times as big" a resize', () => {
  assert.equal(toolFromWords('Make it flash red three times'), 'color');
  assert.equal(toolFromWords('Make it three times as big'), 'resize');
});
