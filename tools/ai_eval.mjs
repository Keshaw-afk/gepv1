// How well does a (small) model use the AI tools? Runs step-by-step prompts, written the way a user
// would, through the same loop as the in-app assistant (core/ai_loop.js), and checks the result.
//
//   node tools/ai_eval.mjs [model] [baseUrl]      default: qwen3:0.6b on Ollama (localhost:11434)
//   OPENAI_API_KEY=… node tools/ai_eval.mjs gpt-4o-mini https://api.openai.com/v1
//   ONLY="some words" node tools/ai_eval.mjs     just the prompts containing them
//
// Prints each case as pass/fail with the calls the model made, then the pass count.

import { newProject, runTool, endState, briefState, objectNames } from '../core/ai_tools.js';
import { carryOut, TOOL_SCHEMAS } from '../core/ai_loop.js';
import { keyframes, INSTANT } from '../core/steps.js';

const model = process.argv[2] ?? 'qwen3:0.6b';
const baseUrl = process.argv[3] ?? 'http://localhost:11434/v1';
const local = /localhost|127\.0\.0\.1/.test(baseUrl);
const tools = TOOL_SCHEMAS();

// ---------- checks on the finished project ----------
const obj = (p, name) => [...endState(p).values()].find((o) => o.name?.toLowerCase() === name.toLowerCase());
const near = (o, x, y) => o && Math.abs(o.x - x) <= 2 && Math.abs(o.y - y) <= 2;
const nodes = (p) => [...endState(p).values()].filter((o) => o.kind === 'node');
const total = (p) => keyframes(p.steps).reduce((t, f) => {
  const timed = p.steps.slice(f.start, f.end).filter((s) => !INSTANT.has(s.op));
  return t + (timed.length ? Math.max(...timed.map((s) => s.dur)) : 0);
}, 0) / 1000;
const colorOf = (p, name) => obj(p, name)?.color;
function expect(cond, why) { if (!cond) throw new Error(why); }

const CASES = [
  {
    prompt: 'Draw a circle A at (100, 180). Move it to (500, 180) in 10 seconds.',
    check(p) {
      expect(p.scene.nodes().length === 1 && near(p.scene.nodes()[0], 100, 180), 'A starts at (100, 180)');
      expect(near(obj(p, 'A'), 500, 180), 'A ends at (500, 180)');
      expect(total(p) === 10, `lasts 10 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Draw a circle A at (100, 100) and a box B at (400, 100). Then move A to (300, 250) in 3 seconds and at the same time turn B red.',
    check(p) {
      expect(nodes(p).length === 2, `2 objects, not ${nodes(p).length}`);
      expect(near(obj(p, 'A'), 300, 250), 'A ends at (300, 250)');
      expect(colorOf(p, 'B') === 'red', 'B is red');
      expect(total(p) === 3, `together: 3 s in all, not ${total(p)}`);
    },
  },
  {
    prompt: 'Draw three circles called 1, 2 and 3 at (100, 180), (300, 180) and (500, 180). Make all circles blue.',
    check(p) {
      expect(nodes(p).length === 3, `3 circles, not ${nodes(p).length}`);
      expect(['1', '2', '3'].every((n) => colorOf(p, n) === 'blue'), 'all blue');
    },
  },
  {
    prompt: 'Draw a triangle T at (320, 300). Move it up by 200 in 2 seconds. Then wait 1 second. Then make it green.',
    check(p) {
      expect(near(obj(p, 'T'), 320, 100), `T ends at (320, 100), not (${obj(p, 'T')?.x}, ${obj(p, 'T')?.y})`);
      expect(colorOf(p, 'T') === 'green', 'T is green');
      expect(total(p) >= 4 - 0.01 && total(p) <= 4.01, `2 + 1 + 1 = 4 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Draw a circle A at (100, 180) and a circle B at (500, 180). Connect A to B with an arrow. Then move B to (500, 60).',
    check(p) {
      const line = [...endState(p).values()].find((o) => o.kind === 'edge');
      expect(line?.directed, 'an arrow');
      expect(near(obj(p, 'B'), 500, 60), 'B ends at (500, 60)');
    },
  },
  {
    prompt: 'Draw a box A at (100, 180). Move it to (500, 180) in an arc in 2 seconds.',
    check(p) {
      expect(p.steps.some((s) => s.op === 'path'), 'a curved move');
      expect(near(obj(p, 'A'), 500, 180), 'A ends at (500, 180)');
    },
  },
  {
    prompt: 'Make these red, then move them right by 100.',
    setup(p) {
      runTool(p, 'draw', { shape: 'circle', label: 'P', x: 100, y: 100 });
      runTool(p, 'draw', { shape: 'circle', label: 'Q', x: 100, y: 250 });
      runTool(p, 'draw', { shape: 'circle', label: 'R', x: 400, y: 250 });
      p.history = [];
      p.last = [];
      p.fresh = []; // drawn before: by the user
      p.selected = [1, 2]; // P and Q selected on the Stage
    },
    check(p) {
      expect(colorOf(p, 'P') === 'red' && colorOf(p, 'Q') === 'red', 'P and Q red');
      expect(colorOf(p, 'R') !== 'red', 'R not red');
      expect(near(obj(p, 'P'), 200, 100) && near(obj(p, 'Q'), 200, 250), 'P and Q moved right by 100');
      expect(near(obj(p, 'R'), 400, 250), 'R stayed');
    },
  },
  {
    prompt: 'Make the circle twice as big in 2 seconds, then remove the box.',
    setup(p) {
      runTool(p, 'draw', { shape: 'circle', label: 'C', x: 200, y: 180 });
      runTool(p, 'draw', { shape: 'box', label: 'K', x: 450, y: 180 });
      p.history = [];
      p.last = [];
      p.fresh = []; // drawn before: by the user
    },
    check(p) {
      expect(obj(p, 'C')?.size === 2, `C size 2, not ${JSON.stringify(obj(p, 'C')?.size)}`);
      expect(!obj(p, 'K'), 'the box is gone');
      expect(nodes(p).length === 1, 'nothing else drawn');
    },
  },
];

// written after the tools were tuned on the cases above, and not tuned on: the honest score
const HELD_OUT = [
  {
    prompt: 'Put a square S at (320, 180). Make it twice as big in 3 seconds. Then turn it orange.',
    check(p) {
      expect(near(obj(p, 'S'), 320, 180), 'S at (320, 180)');
      expect(obj(p, 'S')?.size === 2, `S twice as big, not ${JSON.stringify(obj(p, 'S')?.size)}`);
      expect(colorOf(p, 'S') === 'orange', 'S orange');
      expect(total(p) === 4, `3 + 1 = 4 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Draw a circle X at (100, 100) and a circle Y at (500, 300). Move X to (500, 100) and at the same time move Y to (100, 300). Wait 2 seconds. Remove X.',
    check(p) {
      expect(!obj(p, 'X'), 'X removed');
      expect(near(obj(p, 'Y'), 100, 300), 'Y at (100, 300)');
      expect(total(p) === 3, `1 + 2 = 3 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Write "Hello" at (320, 40). Then draw a green triangle at (320, 200).',
    check(p) {
      expect(nodes(p).some((o) => o.shape === 'text' && o.label === 'Hello' && near(o, 320, 40)), 'text Hello at (320, 40)');
      expect(nodes(p).some((o) => o.shape === 'triangle' && o.color === 'green' && near(o, 320, 200)), 'green triangle at (320, 200)');
    },
  },
  {
    prompt: 'Move everything down by 50 in 2 seconds.',
    setup(p) {
      runTool(p, 'draw', { shape: 'circle', label: 'A', x: 100, y: 100 });
      runTool(p, 'draw', { shape: 'box', label: 'B', x: 300, y: 150 });
      p.history = []; p.last = []; p.fresh = [];
    },
    check(p) {
      expect(near(obj(p, 'A'), 100, 150) && near(obj(p, 'B'), 300, 200), 'both down by 50');
      expect(total(p) === 2, `2 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Draw a box A at (100, 180) and a box B at (300, 180). Connect them. Move A to (100, 300) in 2 seconds.',
    check(p) {
      expect([...endState(p).values()].some((o) => o.kind === 'edge'), 'A and B connected');
      expect(near(obj(p, 'A'), 100, 300), 'A at (100, 300)');
    },
  },
  {
    prompt: 'Turn the triangle blue, then hide it.',
    setup(p) {
      runTool(p, 'draw', { shape: 'circle', label: 'C', x: 100, y: 100 });
      runTool(p, 'draw', { shape: 'triangle', label: 'T', x: 300, y: 100 });
      p.history = []; p.last = []; p.fresh = [];
    },
    check(p) {
      expect(p.steps.some((st) => st.op === 'color' && st.color === 'blue' && st.target === 2) || p.scene.get(2)?.color === 'blue', 'T turned blue');
      expect(!obj(p, 'T') && obj(p, 'C'), 'T hidden, C still there');
    },
  },
];

// a second fresh batch, written before the fixes for HELD_OUT were tested
const FRESH = [
  {
    prompt: 'Draw a blue circle P at (60, 60). Move it to (580, 60) in 5 seconds, then move it down by 200.',
    check(p) {
      expect(colorOf(p, 'P') === 'blue', 'P blue');
      expect(near(obj(p, 'P'), 580, 260), `P ends at (580, 260), not (${obj(p, 'P')?.x}, ${obj(p, 'P')?.y})`);
      expect(total(p) === 6, `5 + 1 = 6 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Draw a box called queue at (320, 180). Draw a circle J at (100, 180). Move J to (320, 180) in 2 seconds and at the same time make queue yellow.',
    check(p) {
      expect(near(obj(p, 'J'), 320, 180), 'J at the queue');
      expect(colorOf(p, 'queue') === 'yellow', 'queue yellow');
      expect(total(p) === 2, `together: 2 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Make the boxes red and wait 2 seconds.',
    setup(p) {
      for (const [l, sh, x] of [['A', 'box', 100], ['B', 'box', 300], ['C', 'circle', 500]]) runTool(p, 'draw', { shape: sh, label: l, x, y: 180 });
      p.history = []; p.last = []; p.fresh = [];
    },
    check(p) {
      expect(colorOf(p, 'A') === 'red' && colorOf(p, 'B') === 'red', 'A and B red');
      expect(colorOf(p, 'C') !== 'red', 'C not red');
    },
  },
  {
    prompt: 'Delete B. Then move A to the right by 150 in 3 seconds.',
    setup(p) {
      runTool(p, 'draw', { shape: 'circle', label: 'A', x: 100, y: 180 });
      runTool(p, 'draw', { shape: 'circle', label: 'B', x: 400, y: 180 });
      p.history = []; p.last = []; p.fresh = [];
    },
    check(p) {
      expect(!obj(p, 'B'), 'B gone');
      expect(near(obj(p, 'A'), 250, 180), `A at (250, 180), not (${obj(p, 'A')?.x}, ${obj(p, 'A')?.y})`);
    },
  },
  {
    prompt: 'Draw a triangle at (320, 300) and an arrow from it to the circle.',
    setup(p) {
      runTool(p, 'draw', { shape: 'circle', label: 'O', x: 320, y: 80 });
      p.history = []; p.last = []; p.fresh = [];
    },
    check(p) {
      expect(nodes(p).some((o) => o.shape === 'triangle' && near(o, 320, 300)), 'a triangle at (320, 300)');
      expect([...endState(p).values()].some((o) => o.kind === 'edge' && o.directed), 'an arrow');
    },
  },
  {
    prompt: 'Grow them to three times their size over 4 seconds.',
    setup(p) {
      runTool(p, 'draw', { shape: 'circle', label: 'M', x: 200, y: 180 });
      runTool(p, 'draw', { shape: 'circle', label: 'N', x: 400, y: 180 });
      p.history = []; p.last = [1, 2]; p.fresh = [];
    },
    check(p) {
      expect(obj(p, 'M')?.size === 3 && obj(p, 'N')?.size === 3, `both 3×, not ${JSON.stringify([obj(p, 'M')?.size, obj(p, 'N')?.size])}`);
      expect(total(p) === 4, `4 s, not ${total(p)}`);
    },
  },
];

// a third batch, written after FRESH had been tuned on: the current honest score
const NEW = [
  {
    prompt: 'Draw a purple triangle K at (500, 80). Move it down by 200 in 4 seconds.',
    check(p) {
      expect(colorOf(p, 'K') === 'purple', 'K purple');
      expect(near(obj(p, 'K'), 500, 280), `K at (500, 280), not (${obj(p, 'K')?.x}, ${obj(p, 'K')?.y})`);
      expect(total(p) === 4, `4 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Draw a circle called start at (80, 180) and a circle called end at (560, 180). Draw a line from start to end.',
    check(p) {
      expect(near(obj(p, 'start'), 80, 180) && near(obj(p, 'end'), 560, 180), 'start and end placed');
      expect([...endState(p).values()].some((o) => o.kind === 'edge' && !o.directed), 'a plain line');
    },
  },
  {
    prompt: 'Make the triangles yellow, then wait 3 seconds, then make them black.',
    setup(p) {
      runTool(p, 'draw', { shape: 'triangle', label: 'T1', x: 100, y: 180 });
      runTool(p, 'draw', { shape: 'triangle', label: 'T2', x: 300, y: 180 });
      runTool(p, 'draw', { shape: 'circle', label: 'O', x: 500, y: 180 });
      p.history = []; p.last = []; p.fresh = [];
    },
    check(p) {
      expect(colorOf(p, 'T1') === 'black' && colorOf(p, 'T2') === 'black', 'triangles black at the end');
      expect(p.steps.some((st) => st.op === 'color' && st.color === 'yellow'), 'they were yellow first');
      expect(colorOf(p, 'O') !== 'black', 'O untouched');
      expect(total(p) === 5, `1 + 3 + 1 = 5 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Move these to the left by 80 in an arc.',
    setup(p) {
      runTool(p, 'draw', { shape: 'box', label: 'U', x: 300, y: 100 });
      runTool(p, 'draw', { shape: 'box', label: 'V', x: 300, y: 250 });
      runTool(p, 'draw', { shape: 'box', label: 'W', x: 500, y: 250 });
      p.history = []; p.last = []; p.fresh = []; p.selected = [1, 2];
    },
    check(p) {
      expect(near(obj(p, 'U'), 220, 100) && near(obj(p, 'V'), 220, 250), 'U and V moved left by 80');
      expect(near(obj(p, 'W'), 500, 250), 'W stayed');
      expect(p.steps.every((st) => st.op === 'path'), 'curved');
    },
  },
  {
    prompt: 'Shrink B to half its size, and at the same time move A to (320, 180).',
    setup(p) {
      runTool(p, 'draw', { shape: 'circle', label: 'A', x: 100, y: 100 });
      runTool(p, 'draw', { shape: 'box', label: 'B', x: 500, y: 300 });
      p.history = []; p.last = []; p.fresh = [];
    },
    check(p) {
      expect(obj(p, 'B')?.size === 0.5, `B half, not ${JSON.stringify(obj(p, 'B')?.size)}`);
      expect(near(obj(p, 'A'), 320, 180), 'A at (320, 180)');
      expect(total(p) === 1, `together: 1 s, not ${total(p)}`);
    },
  },
  {
    prompt: 'Write "Step 1" at (320, 30). Wait 2 seconds. Remove the text.',
    check(p) {
      expect(p.scene.nodes().some((o) => o.shape === 'text' && o.label === 'Step 1'), 'the text in the starting picture');
      expect(nodes(p).length === 0, 'removed at the end');
      expect(total(p) === 2, `2 s, not ${total(p)}`);
    },
  },
];

// ---------- the assistant's loop (core/ai_loop.js) ----------
async function ask(messages) {
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.OPENAI_API_KEY && !local && { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }) },
    body: JSON.stringify({ model, messages, tools, tool_choice: 'auto', temperature: 0, ...(local && { reasoning_effort: 'none' }) }),
  });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error(data.error?.message ?? `HTTP ${res.status}`);
  return data.choices[0].message;
}

async function runCase(c) {
  const p = newProject();
  c.setup?.(p);
  const run = (name, args) => { try { return { text: runTool(p, name, args) }; } catch (e) { return { error: e.message }; } };
  const { calls } = await carryOut(c.prompt, { ask, run, brief: () => briefState(p), names: () => objectNames(p) });
  const lines = calls.map((k) => `${k.error ? '✗ ' : ''}${k.name} ${JSON.stringify(k.args)}${k.error ? ` → ${k.error}` : ''}`);
  try { c.check(p); return { ok: true, calls: lines }; } catch (e) { return { ok: false, why: e.message, calls: lines }; }
}

async function suite(title, cases) {
  let passed = 0;
  console.log(`\n${title}`);
  for (const [i, c] of cases.entries()) {
    if (process.env.ONLY && !c.prompt.includes(process.env.ONLY)) continue;
    const t = Date.now();
    let r;
    try { r = await runCase(c); } catch (e) { r = { ok: false, why: e.message, calls: [] }; }
    if (r.ok) passed++;
    console.log(`${r.ok ? 'PASS' : 'FAIL'} ${i + 1}. ${c.prompt}  (${((Date.now() - t) / 1000).toFixed(1)} s)${r.ok ? '' : `\n     ${r.why}`}`);
    for (const line of r.calls) console.log(`       ${line}`);
  }
  return passed;
}
const a = await suite('Tuned on:', CASES);
const b = await suite('Held out (tuned on after the first run):', HELD_OUT);
const c = await suite('Fresh (tuned on after its first run):', FRESH);
const d = await suite('New (never tuned on):', NEW);
console.log(`\n${a} / ${CASES.length} tuned, ${b} / ${HELD_OUT.length} held out, ${c} / ${FRESH.length} fresh, ${d} / ${NEW.length} new, with ${model}`);
