// Page wiring: 1 Stage (editor) -> 2 Behaviour (steps + code) -> 3 Result (frames, moments, downloads).
// Everything the GUI makes is turned into Lua (stage.lua, steps.lua) and run by the same engine
// as hand-written code (script.lua).

import { runProgram } from '../core/lua_api.js';
import { toStageLua } from '../core/stage_file.js';
import { buildSteps, stepsToLua, pruneSteps, toEditorIds, stepNames, nextStepId, INSTANT, RUNS_TIME } from '../core/steps.js';
import { Scene } from '../core/scene.js';
import { ARRANGE_KINDS } from '../core/arrange.js';
import { sceneAt, frameTimes, tweens } from '../core/player.js';
import { renderSVG, paint } from '../core/svg.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { formatTrace } from '../core/trace.js';
import { outputSettings } from '../core/output.js';
import { frameAt, landmarks, renderFrame, frameName } from '../core/frames.js';
import { Editor } from './editor.js';
import { History } from './history.js';
import { CodeView } from './codeview.js';

const fengari = window.fengari;
const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'lightgrey'];
const HINTS = {
  stage: 'Click empty space to add a shape · Drag on empty space: select several · Drag: move · Corner handle: resize · Line or arrow tool (or Shift-drag): connect · Double-click: rename · Ctrl+Z: undo',
  behaviour: 'The picture after your steps · Click or drag a box to select · Pick a colour · Drag: record a move · Corner handle: resize · Shapes add objects',
  result: '← →: previous / next frame (Shift: 10) · Home / End · [ ]: previous / next moment · Space: play / pause',
};

let tab = 'stage';
let steps = [];

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg ?? '';
}

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
const saveText = (text, name) => download(new Blob([text], { type: name.endsWith('.svg') ? 'image/svg+xml' : 'text/plain' }), name);

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

const stageView = new CodeView($('stage-code'), { lang: 'lua', filename: 'stage.lua', onSave: saveText });
const stepsView = new CodeView($('steps-code'), { lang: 'lua', filename: 'steps.lua', onSave: saveText });

// ---------- 1. Stage ----------
const labelInput = $('label');
let history = null; // undo / redo and autosave (set up at the bottom)
const projectChanged = () => { history?.touch(); updateHistoryButtons(); };

const editor = new Editor($('editor'), {
  onChange: () => {
    stageView.set(toStageLua(editor.scene));
    steps = pruneSteps(steps, editor.scene); // a deleted node takes its steps with it
    renderSteps();
    syncInspector();
    projectChanged();
  },
  onSelect: () => syncInspector(),
  // after the click has finished (the browser moves focus on mousedown)
  onRename: () => setTimeout(() => { labelInput.focus(); labelInput.select(); }),
  onRecordMoves: (moves) => addSteps(moves.map((m) => ({ op: 'move', target: m.id, x: m.x, y: m.y }))),
  onResize: (list) => addSteps(list.map(({ id, size }) => ({ op: 'size', target: id, size }))),
  onAddObject: (shape, label, x, y) => {
    const id = nextStepId(steps);
    addSteps([{ op: 'add', id, shape, label, x, y }]);
    editor.popIn(id);
  },
  onPaste: pasteSteps,
  onConnect: (a, b, directed) => {
    const id = nextStepId(steps);
    addSteps([{ op: 'connect', id, a, b, directed }]);
    editor.popIn(id);
  },
  onTool: (tool) => {
    for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  },
});
for (const b of $$('[data-tool]')) b.addEventListener('click', () => editor.setTool(b.dataset.tool));
$('snap').addEventListener('click', toggleSnap);
function toggleSnap() {
  editor.setSnap(!editor.snap);
  $('snap').setAttribute('aria-pressed', String(editor.snap));
}

/** "Circle", "Rectangle", …, "Line", "Arrow". */
function kindName(obj) {
  if (obj.kind === 'edge') return obj.directed ? 'Arrow' : 'Line';
  return { circle: 'Circle', rect: 'Rectangle', triangle: 'Triangle', text: 'Text' }[obj.shape ?? 'circle'];
}

// The selection controls (both panels): what is selected, its size, arrange, duplicate, delete.
// They follow whatever is selected, on either tab.
function syncInspector({ typing = false } = {}) {
  const sel = editor.selection();
  const nodes = sel.filter((o) => o.kind === 'node');
  const one = sel.length === 1 ? sel[0] : null;
  const name = one ? stepNames(steps, editor.scene).nameOf(one.id) : '';
  $('selection').textContent = !sel.length ? 'Nothing selected' : !one ? `${sel.length} selected` : one.kind === 'node' ? kindName(one) : `${kindName(one)} ${name}`;

  const single = one?.kind === 'node';
  labelInput.disabled = !single;
  if (document.activeElement !== labelInput) labelInput.value = single ? one.label : '';

  const sizes = new Set(nodes.map((n) => n.size ?? 1));
  for (const input of $$('.size-input')) {
    input.disabled = !nodes.length;
    input.placeholder = sizes.size > 1 ? 'mixed' : '';
    if (document.activeElement !== input) input.value = sizes.size === 1 ? String(Number([...sizes][0].toFixed(2))) : '';
  }
  for (const b of $$('[data-arrange-kind]')) b.disabled = nodes.length < (b.dataset.arrangeKind.endsWith('spread') ? 3 : 2);
  for (const b of $$('.dup')) b.disabled = !nodes.length;
  for (const b of $$('.del')) b.disabled = !sel.length;

  // Behaviour
  $('target').textContent = !sel.length
    ? 'Click an object, or drag a box around several. Pick a colour, drag to record a move, or use the corner handle to resize.'
    : !one ? `${sel.length} selected: a colour, a drag, a size or an arrangement applies to all of them at once.`
      : `${kindName(one)} ${name}: pick a colour${single ? ', drag it to record a move, resize it' : ''}, or remove it.`;
  for (const b of $('palette').children) b.disabled = !sel.length;
  const made = single && typeof one.id === 'string'; // created by a step: its label can still change
  $('step-label-wrap').hidden = !made;
  if (made && !typing) $('step-label').value = one.label;
}

// Arrange buttons: align to an edge or centre, spread evenly.
const ARRANGE = {
  left: ['Align left edges', 'M3 2v12M6 4h7v3H6zM6 9h4v3H6z'],
  hcenter: ['Centre horizontally', 'M8 2v12M3.5 4h9v3h-9zM5 9h6v3H5z'],
  right: ['Align right edges', 'M13 2v12M3 4h7v3H3zM6 9h4v3H6z'],
  top: ['Align top edges', 'M2 3h12M4 6v7h3V6zM9 6v4h3V6z'],
  vcenter: ['Centre vertically', 'M2 8h12M4 3.5v9h3v-9zM9 5v6h3V5z'],
  bottom: ['Align bottom edges', 'M2 13h12M4 3v7h3V3zM9 6v4h3V6z'],
  hspread: ['Spread evenly across', 'M2 3v10M14 3v10M6.5 5h3v6h-3z'],
  vspread: ['Spread evenly down', 'M3 2h10M3 14h10M5 6.5h6v3H5z'],
};
for (const slot of $$('[data-arrange]')) {
  ARRANGE_KINDS.forEach((kind, i) => {
    if (i === 3 || i === 6) slot.append(el('span', 'gap'));
    const b = el('button');
    b.type = 'button';
    b.disabled = true;
    b.dataset.arrangeKind = kind;
    b.title = ARRANGE[kind][0];
    b.setAttribute('aria-label', ARRANGE[kind][0]);
    b.innerHTML = `<svg viewBox="0 0 16 16" aria-hidden="true"><path d="${ARRANGE[kind][1]}"/></svg>`;
    b.addEventListener('click', () => editor.arrangeSelected(kind));
    slot.append(b);
  });
}
for (const input of $$('.size-input')) {
  input.addEventListener('change', () => {
    const v = Number(input.value);
    if (input.value.trim() !== '' && Number.isFinite(v) && v > 0) editor.setSize(v);
    syncInspector();
  });
}
for (const b of $$('.dup')) b.addEventListener('click', () => editor.duplicate());
for (const b of $$('.del')) b.addEventListener('click', deleteSelection);
function deleteSelection() {
  if (tab === 'stage') { editor.deleteSelected(); return; }
  // Behaviour: the objects disappear at this step. A node takes its lines along, so only lines
  // whose nodes stay need a step of their own.
  const sel = editor.selection();
  const nodes = new Set(sel.filter((o) => o.kind === 'node').map((o) => o.id));
  const lines = sel.filter((o) => o.kind === 'edge' && !nodes.has(o.a) && !nodes.has(o.b));
  addSteps([...nodes, ...lines.map((e) => e.id)].map((id) => ({ op: 'remove', target: id })));
  editor.setSelection([]);
}
$('step-label').addEventListener('input', () => {
  const add = steps.find((s) => s.op === 'add' && s.id === editor.selected);
  if (!add) return;
  add.label = $('step-label').value;
  stepsChanged({ keepSelection: true });
  syncInspector({ typing: true }); // the hint shows the new name
});
labelInput.addEventListener('input', () => editor.setLabel(labelInput.value));

function loadStage(text) {
  try {
    editor.setScene(runProgram(fengari, { stage: text }).scene);
    showError(null);
  } catch (e) {
    showError(e.message);
  }
}

const saveStage = () => saveText(toStageLua(editor.scene), 'stage.lua');
$('save').addEventListener('click', saveStage);
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (f) loadStage(await f.text());
  $('file').value = '';
});
$('clear').addEventListener('click', () => loadStage(''));
// Start again: an empty stage, no steps, no code (Undo brings it all back)
$('new').addEventListener('click', () => {
  steps = [];
  scriptBox.value = '';
  loadStage('');
  stepsChanged();
  updateRunOrder();
});

// ---------- 2. Behaviour: steps ----------
for (const c of PALETTE) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.title = c;
  b.style.background = paint(c);
  b.disabled = true;
  b.addEventListener('click', () => addSteps(editor.selectedIds().map((id) => ({ op: 'color', target: id, color: c }))));
  $('palette').append(b);
}

function stepDur() {
  const v = Number($('dur').value);
  return Math.round(Math.min(10, Math.max(0, Number.isFinite(v) ? v : 0.5)) * 1000);
}

let justAdded = new Set(); // the steps that slide into the list
/** Adds steps; when there are several (a selection of many objects) they all play together. */
function addSteps(list) {
  if (!list.length) return;
  const dur = stepDur();
  const added = list.map((s, i) => ({ dur, together: i > 0, ...s }));
  steps.push(...added);
  justAdded = new Set(added);
  stepsChanged();
  justAdded = new Set();
}
$('pause').addEventListener('click', () => addSteps([{ op: 'wait' }]));
$('clear-steps').addEventListener('click', () => { steps = []; stepsChanged(); });

/** Paste in Behaviour: the copies appear (and their lines), all at once. Returns their ids. */
function pasteSteps(plan) {
  const dur = stepDur();
  const added = [];
  const push = (s) => { const step = { dur, together: added.length > 0, ...s }; steps.push(step); added.push(step); };
  const ids = plan.nodes.map((n) => {
    const id = nextStepId(steps);
    push({ op: 'add', id, shape: n.shape, label: n.label, x: n.x, y: n.y, size: n.size });
    return id;
  });
  const lines = plan.edges.map((e) => {
    const id = nextStepId(steps);
    push({ op: 'connect', id, a: ids[e.a], b: ids[e.b], directed: e.directed });
    return id;
  });
  justAdded = new Set(added);
  stepsChanged();
  justAdded = new Set();
  return [...ids, ...lines];
}

function stepsChanged({ keepSelection = false } = {}) {
  steps = pruneSteps(steps, editor.scene); // a step whose object is gone goes too
  renderSteps();
  projectChanged();
  if (tab !== 'behaviour') return;
  showBehaviour();
  if (!keepSelection) editor.setSelection(editor.selectedIds()); // drops objects that are gone
}

// The picture after all steps (what you are building on), plus faint trails of the moves.
function showBehaviour() {
  try {
    const built = buildSteps(steps, editor.scene);
    const result = runProgram(fengari, { stage: toStageLua(editor.scene), steps: built.code });
    showError(null);
    const view = toEditorIds(sceneAt(result.timeline, result.timeline.durationMs), result, editor.scene, steps, built.stepAtLine);
    const trails = tweens(result.timeline)
      .filter((tw) => tw.prop === 'pos' && (tw.from.x !== tw.to.x || tw.from.y !== tw.to.y))
      .map((tw) => [tw.from, tw.to]);
    editor.setView(view, trails);
  } catch (e) {
    showError(e.message);
    editor.setView(null);
  }
}

/**
 * "A colour → ● red" / "B move → (50, 60)" / "+ p1 appears" / "− C disappears", for the steps
 * list and the moments list. Objects appearing and disappearing get a small marker.
 */
function describeChange(name, c) {
  const what = el('span', 'what');
  if (c.op === 'create' || c.op === 'add' || c.op === 'connect') what.append(el('i', 'op appear', '+'));
  if (c.op === 'remove') what.append(el('i', 'op disappear', '−'));
  what.append(el('b', null, name), ' ');
  if (c.op === 'color') {
    const sw = el('i', 'dot');
    sw.style.background = paint(c.color);
    what.append('colour → ', sw, ` ${c.color}`);
  } else if (c.op === 'move') {
    what.append(`move → (${Math.round(c.x)}, ${Math.round(c.y)})`);
  } else if (c.op === 'size') {
    what.append(`size → ×${Number(c.size.toFixed(2))}`);
  } else if (c.op === 'remove') {
    what.append('disappears');
  } else {
    what.append(c.kind ? `${c.kind} appears` : 'appears');
  }
  return what;
}

function describe(s, names) {
  if (s.op === 'wait') { const w = el('span', 'what'); w.append(el('b', null, 'Pause')); return w; }
  if (s.op === 'add') return describeChange(s.label, { op: 'add', kind: kindName({ kind: 'node', shape: s.shape }).toLowerCase() });
  if (s.op === 'connect') return describeChange(names.nameOf(s.id), { op: 'connect', kind: s.directed ? 'arrow' : 'line' });
  return describeChange(names.nameOf(s.target), s);
}


function renderSteps() {
  const list = $('steps');
  list.replaceChildren();
  const names = stepNames(steps, editor.scene);
  steps.forEach((s, i) => {
    const li = el('li');
    const prev = steps[i - 1];
    li.append(el('span', 'num', String(i + 1)), describe(s, names));

    const remove = el('button', 'x', '×');
    remove.type = 'button';
    remove.title = 'Remove step';
    remove.addEventListener('click', () => { steps.splice(i, 1); stepsChanged(); });
    li.append(remove);

    const opts = el('div', 'opts');
    const dur = el('input');
    Object.assign(dur, { type: 'number', min: 0, max: 10, step: 0.1, value: s.dur / 1000, title: 'seconds' });
    dur.setAttribute('aria-label', 'duration in seconds');
    dur.addEventListener('change', () => {
      const v = Number(dur.value);
      s.dur = Math.round(Math.min(10, Math.max(0, Number.isFinite(v) ? v : 0)) * 1000);
      stepsChanged();
    });
    const durLabel = el('label');
    durLabel.append(dur, ' s');
    if (!INSTANT.has(s.op)) opts.append(durLabel);

    if (!RUNS_TIME.has(s.op) && prev && !RUNS_TIME.has(prev.op)) {
      const when = el('select');
      when.setAttribute('aria-label', 'when');
      when.append(new Option('after previous', ''), new Option('with previous', '1'));
      when.value = s.together ? '1' : '';
      when.addEventListener('change', () => { s.together = when.value === '1'; stepsChanged(); });
      opts.append(when);
    }
    li.append(opts);
    if (s.together && prev && !RUNS_TIME.has(prev.op)) li.classList.add('together');
    if (justAdded.has(s)) li.classList.add('new');
    list.append(li);
  });
  $('steps-empty').hidden = steps.length > 0;
  stepsView.set(stepsToLua(steps, editor.scene) || '-- no steps yet');
  updateRunOrder();
}

// ---------- 2. Behaviour: code ----------
const scriptBox = $('script');
scriptBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  scriptBox.setRangeText('  ', scriptBox.selectionStart, scriptBox.selectionEnd, 'end');
});
scriptBox.addEventListener('input', updateRunOrder);
const clearCode = () => { scriptBox.value = ''; updateRunOrder(); };
$('clear-code').addEventListener('click', clearCode);
$('clear-code-note').addEventListener('click', clearCode);
$('save-code').addEventListener('click', () => saveText(scriptBox.value, 'script.lua'));
$('example').addEventListener('change', async () => {
  const name = $('example').value;
  $('example').value = '';
  scriptBox.value = await fetch(`/examples/${name}`).then((r) => r.text());
  updateRunOrder();
});

function codeLines() {
  return scriptBox.value.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).length;
}

function updateRunOrder() {
  const lines = codeLines();
  $('code-badge').textContent = lines ? `${lines} lines` : '';
  $('code-count').textContent = lines;
  $('code-note').hidden = !lines; // never let code play after the steps without saying so
  const parts = ['stage', `${steps.length} step${steps.length === 1 ? '' : 's'}`];
  if (lines) parts.push(`code (${lines} lines)`);
  $('run-order').textContent = `Run plays: ${parts.join(' → ')}`;
}

for (const b of document.querySelectorAll('[data-sub]')) {
  b.addEventListener('click', () => {
    for (const o of document.querySelectorAll('[data-sub]')) o.setAttribute('aria-selected', String(o === b));
    for (const p of document.querySelectorAll('[data-subpanel]')) p.hidden = p.dataset.subpanel !== b.dataset.sub;
  });
}

// ---------- 3. Result: frames, moments, downloads ----------
// The player works in frames: frame i is at times[i], the same grid as the MP4 and `--frames`.
const player = { result: null, times: [0], marks: [], frame: 0, playing: false, startT: 0, startNow: 0 };
let output = outputSettings();
let lastProgram = null, lastKey = null, stepAtLine = [];
const svgView = new CodeView($('svg-code'), { lang: 'xml', filename: () => frameName(player.frame), onSave: saveText });
const traceView = new CodeView($('trace'), { lang: 'text', filename: 'trace.txt', onSave: saveText });

/** Runs the program. Returns 'changed', 'same' (nothing changed since the last run) or null on error. */
function run() {
  try {
    const built = buildSteps(steps, editor.scene);
    const prog = { stage: toStageLua(editor.scene), steps: built.code, script: scriptBox.value };
    const key = JSON.stringify(prog);
    if (key === lastKey && player.result) { showError(null); return 'same'; }
    const result = runProgram(fengari, prog);
    showError(null);
    Object.assign(player, { result, playing: false });
    lastProgram = prog;
    lastKey = key;
    stepAtLine = built.stepAtLine;
    retime(0);
    $('export-status').textContent = '';
    return 'changed';
  } catch (e) {
    showError(e.message);
    return null;
  }
}

/** Rebuilds the frame grid (after a run or a frame-rate change) and stays near time tMs. */
function retime(tMs) {
  const { timeline } = player.result;
  player.times = frameTimes(timeline.durationMs, output.fps);
  player.marks = landmarks(timeline, player.times);
  player.frame = frameAt(player.times, tMs);
  const last = player.times.length - 1;
  $('scrub').max = last;
  $('frame').max = last;
  $('last-frame').textContent = last;
  traceView.set(formatTrace(player.result, { fps: output.fps }).join('\n'));
  renderMoments();
}

const lastFrame = () => player.times.length - 1;
const timeline = () => player.result.timeline;

function draw() {
  if (!player.result) return;
  const { times, frame } = player;
  $('preview').innerHTML = renderSVG(sceneAt(timeline(), times[frame]), { output });
  if ($('svg-details').open) svgView.set(renderFrame(timeline(), times, frame, output));
  $('scrub').value = frame;
  $('scrub').style.setProperty('--p', `${lastFrame() ? (frame / lastFrame()) * 100 : 0}%`);
  if (document.activeElement !== $('frame')) $('frame').value = frame;
  $('time').textContent = `${(times[frame] / 1000).toFixed(2)} s`;
  $('play').textContent = player.playing ? 'Pause' : 'Play';
  highlightMoment();
}

function go(frame) {
  player.playing = false;
  player.frame = Math.min(lastFrame(), Math.max(0, Math.round(frame) || 0));
  draw();
}

function tick(now) {
  if (!player.playing) return;
  const t = player.startT + Math.max(0, now - player.startNow);
  const f = Math.min(lastFrame(), frameAt(player.times, t));
  const changed = f !== player.frame;
  player.frame = f;
  if (f >= lastFrame()) player.playing = false;
  if (changed || !player.playing) draw();
  if (player.playing) requestAnimationFrame(tick);
}

function play() {
  if (player.frame >= lastFrame()) player.frame = 0;
  player.playing = true;
  player.startT = player.times[player.frame];
  player.startNow = performance.now();
  requestAnimationFrame(tick);
  draw();
}
const togglePlay = () => (player.playing ? go(player.frame) : play());

$('play').addEventListener('click', togglePlay);
$('prev').addEventListener('click', () => go(player.frame - 1));
$('next').addEventListener('click', () => go(player.frame + 1));
$('scrub').addEventListener('input', () => go(Number($('scrub').value)));
$('frame').addEventListener('change', () => { go(Number($('frame').value)); $('frame').value = player.frame; });
$('frame').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('frame').blur(); }); // then ← → work again
$('svg-details').addEventListener('toggle', draw);

// Moments: frames where a change has just finished (core/frames.js landmarks).
function sourceLabel(src) {
  if (!src) return '';
  if (src.file === 'steps.lua' && stepAtLine[src.line] !== undefined) return `Step ${stepAtLine[src.line] + 1}`;
  return `${src.file}:${src.line}`;
}

function changeOf(c) {
  if (c.op === 'create') return { op: 'create', kind: c.kind === 'edge' ? (c.props.directed ? 'arrow' : 'line') : null };
  if (c.op === 'remove') return { op: 'remove' };
  if (c.prop === 'size') return { op: 'size', size: c.value };
  return c.prop === 'color' ? { op: 'color', color: c.value } : { op: 'move', x: c.value.x, y: c.value.y };
}

function renderMoments() {
  const list = $('moments'), ticks = $('ticks');
  list.replaceChildren();
  ticks.replaceChildren();
  const last = lastFrame();
  for (const m of player.marks) {
    const b = el('button');
    b.type = 'button';
    b.append(el('span', 't', `${(m.t / 1000).toFixed(2)} s`));
    const changes = el('span', 'changes');
    m.cmds.forEach((c, i) => {
      if (i) changes.append(', ');
      changes.append(describeChange(c.name, changeOf(c))); // the name when it happened
    });
    b.append(changes, el('span', 'src', [...new Set(m.cmds.map((c) => sourceLabel(c.src)))].filter(Boolean).join(', ')));
    b.title = `Frame ${m.frame}`;
    b.addEventListener('click', () => go(m.frame));
    const li = el('li');
    li.dataset.frame = m.frame;
    li.append(b);
    list.append(li);

    const tick = el('span');
    tick.style.setProperty('--f', last ? m.frame / last : 0);
    ticks.append(tick);
  }
  $('moments-count').textContent = player.marks.length || '';
  $('moments-empty').hidden = player.marks.length > 0;
}

function currentMoment() {
  let cur = -1;
  player.marks.forEach((m, i) => { if (m.frame <= player.frame) cur = i; });
  return cur;
}

function highlightMoment() {
  const cur = currentMoment();
  const list = $('moments');
  [...list.children].forEach((li, i) => {
    const on = i === cur;
    li.classList.toggle('current', on);
    if (on) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current');
    // keep the current moment visible inside the list without scrolling the page
    if (on && $('moments-details').open) {
      if (li.offsetTop < list.scrollTop) list.scrollTop = li.offsetTop;
      else if (li.offsetTop + li.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = li.offsetTop + li.offsetHeight - list.clientHeight;
    }
  });
}

function jumpMoment(dir) {
  const { marks, frame } = player;
  const m = dir > 0 ? marks.find((x) => x.frame > frame) : marks.findLast((x) => x.frame < frame);
  go(m ? m.frame : dir > 0 ? lastFrame() : 0);
}

// Output settings: size, frame rate, font, background. They apply to the preview and every download.
function readOutput() {
  const transparent = $('out-transparent').checked;
  output = outputSettings({
    scale: $('out-scale').value, fps: $('out-fps').value, font: $('out-font').value,
    background: transparent ? 'transparent' : $('out-bg').value,
  });
  $('out-bg').disabled = transparent;
  $('preview').classList.toggle('transparent', transparent);
  $('output-summary').textContent = `${640 * output.scale} × ${360 * output.scale} · ${output.fps} fps · ${output.font} · ${transparent ? 'transparent' : output.background}`;
}
for (const id of ['out-scale', 'out-fps', 'out-font', 'out-bg', 'out-transparent']) {
  $(id).addEventListener('input', () => {
    const fps = output.fps;
    readOutput();
    if (!player.result) return;
    if (output.fps !== fps) retime(player.times[player.frame]); // stay at the same moment on the new grid
    draw();
  });
}
readOutput();

$('dl-frame').addEventListener('click', () => {
  saveText(renderFrame(timeline(), player.times, player.frame, output), frameName(player.frame));
});
$('dl-svg').addEventListener('click', () => saveText(renderAnimatedSVG(timeline(), output), 'gepv1.svg'));
$('dl-mp4').addEventListener('click', async () => {
  const status = $('export-status');
  $('dl-mp4').disabled = true;
  status.textContent = 'Rendering frames and encoding with ffmpeg…';
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...lastProgram, output }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    download(await res.blob(), 'gepv1.mp4');
    status.textContent = 'MP4 downloaded.';
  } catch (e) {
    status.textContent = `Export failed: ${e.message}`;
  } finally {
    $('dl-mp4').disabled = false;
  }
});

// ---------- Keyboard ----------
const TOOL_KEYS = { v: 'select', c: 'circle', r: 'rect', t: 'triangle', x: 'text', l: 'line', a: 'arrow' };
window.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const typing = active?.matches('textarea, select, input:not([type=range]):not([type=checkbox]):not([type=color])');
  const mod = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (mod && key === 's') { e.preventDefault(); saveStage(); return; }
  if (mod && key === 'o') { e.preventDefault(); $('file').click(); return; }
  if (typing) return; // text boxes keep their own undo, copy and select all
  if (mod && !e.altKey && tab !== 'result') {
    const act = { z: () => (e.shiftKey ? redo() : undo()), y: redo, a: () => editor.selectAll(), c: () => editor.copy(), v: () => editor.paste(), d: () => editor.duplicate() }[key];
    if (act) { e.preventDefault(); act(); }
    return;
  }
  if (mod || e.altKey) return;
  if (tab === 'result' && player.result) {
    const keys = {
      ArrowLeft: () => go(player.frame - (e.shiftKey ? 10 : 1)),
      ArrowRight: () => go(player.frame + (e.shiftKey ? 10 : 1)),
      Home: () => go(0),
      End: () => go(lastFrame()),
      '[': () => jumpMoment(-1),
      ']': () => jumpMoment(1),
      ' ': () => (active?.matches('button, summary, input:not([type=range]), select, textarea') ? false : togglePlay()),
    };
    if (keys[e.key] && keys[e.key]() !== false) e.preventDefault();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelection();
  } else if (e.key === 'Escape') {
    editor.select(null);
  } else if (tab === 'stage' && editor.sel.size && e.key.startsWith('Arrow')) {
    // nudge the selection; Shift = 10 px (in Behaviour a nudge would add a step per key press, so drag instead)
    const d = e.shiftKey ? 10 : 1;
    editor.nudge(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
    e.preventDefault();
  } else if (key === 'g' && !e.shiftKey) {
    toggleSnap();
  } else if (TOOL_KEYS[key] && !e.shiftKey) {
    editor.setTool(TOOL_KEYS[key]);
  }
});

// ---------- Undo, redo and autosave ----------
// Snapshots of the whole project (stage, steps, code). The latest one is also kept in this browser, so
// a reload picks up where you were.
const SAVE_KEY = 'gepv1.project';
const snapshot = () => JSON.stringify({ v: 1, scene: editor.scene, steps, script: scriptBox.value });

function restoreProject(text) {
  const p = JSON.parse(text);
  editor.setScene(Scene.from(p.scene)); // (this prunes the old steps; they are replaced next)
  steps = p.steps;
  scriptBox.value = p.script ?? '';
  renderSteps();
  if (tab === 'behaviour') showBehaviour();
  syncInspector();
  updateRunOrder();
}

function updateHistoryButtons() {
  if (!history) return;
  $('undo').disabled = !history.canUndo;
  $('redo').disabled = !history.canRedo;
}
function undo() { if (tab !== 'result' && history.undo()) updateHistoryButtons(); }
function redo() { if (tab !== 'result' && history.redo()) updateHistoryButtons(); }
$('undo').addEventListener('click', undo);
$('redo').addEventListener('click', redo);
scriptBox.addEventListener('input', projectChanged);

// ---------- Tabs ----------
function showTab(next, { replay = false } = {}) {
  let ran = null;
  if (next === 'result' && !(ran = run())) return; // stay put and show the error
  if (tab === 'result') player.playing = false;
  tab = next;
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;

  const editing = tab !== 'result';
  $('editor').hidden = !editing;
  $('preview').hidden = editing;
  $('player').hidden = editing;
  $('canvas-hint').textContent = HINTS[tab] ?? '';
  $('tools').hidden = !editing;
  $('tools').dataset.mode = tab;

  if (editing) {
    editor.select(null);
    editor.setMode(tab);
    if (tab === 'behaviour') showBehaviour();
  } else if (ran === 'changed' || replay) {
    player.frame = 0;
    play(); // Run, or a new or changed program: play from the start
  } else {
    draw(); // nothing changed: stay on the same frame
  }
}

for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
for (const b of document.querySelectorAll('[data-goto]')) b.addEventListener('click', () => showTab(b.dataset.goto));
$('run').addEventListener('click', () => showTab('result', { replay: true }));

// ---------- Start where you left off, or with the example graph ----------
function restoreSaved() {
  try {
    const text = localStorage.getItem(SAVE_KEY);
    if (!text) return false;
    const p = JSON.parse(text);
    if (p.v !== 1) return false;
    editor.setScene(Scene.from(p.scene));
    steps = Array.isArray(p.steps) ? p.steps : [];
    scriptBox.value = p.script ?? '';
    return true;
  } catch {
    return false;
  }
}
if (!restoreSaved()) loadStage(await fetch('/examples/stage.lua').then((r) => r.text()));
steps = pruneSteps(steps, editor.scene);
renderSteps();
updateRunOrder();
showTab('stage');
history = new History({
  snapshot,
  restore: restoreProject,
  onCommit: (text) => { try { localStorage.setItem(SAVE_KEY, text); } catch { /* private window or storage full: just no autosave */ } },
});
updateHistoryButtons();
window.addEventListener('pagehide', () => history.commit());
