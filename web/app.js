// Page wiring: 1 Stage (editor) -> 2 Behaviour (steps + code) -> 3 Result (frames, moments, downloads).
// Everything the GUI makes is turned into Lua (stage.lua, steps.lua) and run by the same engine
// as hand-written code (script.lua).

import { runProgram, ScriptError } from '../core/lua_api.js';
import { toStageLua } from '../core/stage_file.js';
import { buildSteps, stepsToLua, pruneSteps, toEditorIds, stepNames, nextStepId, sourceOf, reshapePath, keyframes, keyframeEndAt, keepKeyframes, removeStep, recordSteps, INSTANT, RUNS_TIME } from '../core/steps.js';
import { Scene, DEFAULT_EDGE_COLOR } from '../core/scene.js';
import { sizeOf, defaultColor } from '../core/shapes.js';
import { ARRANGE_KINDS } from '../core/arrange.js';
import { sceneAt, frameTimes, tweens } from '../core/player.js';
import { renderSVG, paint } from '../core/svg.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { formatTrace } from '../core/trace.js';
import { outputSettings } from '../core/output.js';
import { frameAt, landmarks, renderFrame, frameName } from '../core/frames.js';
import { Editor } from './editor.js';
import { codeToSteps, ConvertError } from '../core/code_steps.js';
import { runTool, briefState, objectNames } from '../core/ai_tools.js';
import '../core/plugins/index.js'; // registers the plugin tools
import { setupAssistant } from './assistant.js';
import { History } from './history.js';
import { CodeView } from './codeview.js';

const fengari = window.fengari;
const $ = (id) => document.getElementById(id);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'lightgrey'];
const HINTS = {
  arrange: 'Arrange: changes adjust what is there · Click empty space to add a shape (it appears at the moment shown) · Draw a loop: select several · Drag: move · Handles: width, height, both (Shift keeps the shape) · Line or arrow tool (or Shift-drag): connect · Double-click: rename · Ctrl+Z: undo',
  record: 'Record: changes go into the current keyframe and play together · N: new keyframe at the end · Drag in a curve for a curved move · Drag again to carry on a move · Ctrl+Z: undo',
  start: 'The starting picture · Click empty space to add a shape · Draw a loop: select several · Drag: move · Handles: width, height, both (Shift keeps the shape) · Line or arrow tool (or Shift-drag): connect · Double-click: rename · Ctrl+Z: undo',
  steps: 'Every change here becomes a step · Click, or draw a loop to select · Pick a colour · Drag: record a move · Handles: resize · Shapes add objects · Ctrl+Z: undo',
  code: 'From the code (read-only) · Change it in the Code tab, or turn it into steps · Click Start or a keyframe to edit again',
  result: '← →: previous / next frame (Shift: 10) · Home / End · [ ]: previous / next moment · Space: play / pause',
};

let tab = 'build';
let steps = [];
// Where you are working: after the first `point` steps (0 = the start). The canvas shows the picture
// there. In Record mode every change becomes a step inserted at that point; in Arrange mode nothing is
// recorded: a change adjusts whatever already decides it there (the starting picture, or the step that
// moved, sized, coloured or added the object).
let point = 0;
let mode = 'arrange';
// Record: changes join the keyframe that ends at the point, until "+ New keyframe" starts one at the end
let newKeyframe = false;
// The moment of the code shown on the canvas (an index into codeMoments().marks), or null
let codeAt = null;
const recording = () => mode === 'record' && codeAt === null;
const stageEditing = () => mode === 'arrange' && point === 0 && codeAt === null; // the editor edits the Scene directly

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

// ---------- Build: the picture ----------
const labelInput = $('label');
let history = null; // undo / redo and autosave (set up at the bottom)
const projectChanged = () => { history?.touch(); updateHistoryButtons(); };

const editor = new Editor($('editor'), {
  onChange: () => {
    stageView.set(toStageLua(editor.scene));
    prune(); // a deleted node takes its steps with it
    renderSteps();
    syncInspector();
    projectChanged();
  },
  onSelect: () => syncInspector(),
  // after the click has finished (the browser moves focus on mousedown)
  onRename: () => setTimeout(() => { labelInput.focus(); labelInput.select(); }),
  onRecordMoves: (moves) => {
    if (!recording()) { adjustMoves(moves); return; }
    addSteps(moves.map((m) => (m.points
      ? { op: 'path', target: m.id, points: m.points }
      : { op: 'move', target: m.id, x: m.x, y: m.y })));
  },
  onResize: (list) => {
    if (!recording()) { adjustSizes(list); return; }
    addSteps(list.map(({ id, size }) => ({ op: 'size', target: id, size })));
  },
  onAddObject: (shape, label, x, y) => {
    if (!recording() && point === 0) { // Arrange at the start: it is part of the starting picture
      const id = editor.scene.addNode(label, x, y, shape);
      everythingChanged();
      editor.popIn(id);
      return;
    }
    const id = nextStepId(steps);
    addSteps([{ op: 'add', id, shape, label, x, y }]);
    editor.popIn(id);
  },
  // later than the start, even in Arrange, new things appear at that moment (not from 0 s)
  onPaste: (plan) => (recording() || point > 0 ? pasteSteps(plan) : pasteOnStage(plan)),
  onConnect: (a, b, directed) => {
    if (!recording()) { connectUnrecorded(a, b, directed); return; }
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
// the coordinate guide: the numbers an instruction like "draw a circle at (100, 180)" means
$('coords').addEventListener('click', () => {
  editor.setCoords(!editor.coords);
  $('coords').setAttribute('aria-pressed', String(editor.coords));
  $('coords-at').hidden = true;
  try { localStorage.setItem('gepv1.coords', editor.coords ? '1' : ''); } catch { /* no storage */ }
});
editor.onLocked = () => { $('canvas-hint').textContent = 'Made by a code keyframe: change it in the Code tab (Edit on that keyframe).'; };
editor.onPointer = (x, y) => {
  const at = $('coords-at');
  at.hidden = x === null || !editor.coords;
  if (!at.hidden) at.textContent = `(${x}, ${y})`;
};
try { if (localStorage.getItem('gepv1.coords')) $('coords').click(); } catch { /* no storage */ }
function toggleSnap() {
  editor.setSnap(!editor.snap);
  $('snap').setAttribute('aria-pressed', String(editor.snap));
}

/** "Circle", "Rectangle", …, "Line", "Arrow". */
function kindName(obj) {
  if (obj.kind === 'edge') return obj.directed ? 'Arrow' : 'Line';
  return { circle: 'Circle', rect: 'Rectangle', triangle: 'Triangle', text: 'Text', cell: 'Cell' }[obj.shape ?? 'circle'];
}

// The selection controls: what is selected, its colour, size, arrangement, duplicate, delete.
// At the start they change the picture; at a later point they add steps.
function syncInspector() {
  const sel = editor.selection();
  const nodes = sel.filter((o) => o.kind === 'node');
  const one = sel.length === 1 ? sel[0] : null;
  const name = one ? stepNames(steps, editor.scene).nameOf(one.id) : '';
  $('selection').textContent = !sel.length ? 'Nothing selected' : !one ? `${sel.length} selected` : one.kind === 'node' ? kindName(one) : `${kindName(one)} ${name}`;

  const single = one?.kind === 'node';
  // a label can change at the start, or later for an object a step added
  const renamable = single;
  labelInput.disabled = !renamable;
  if (document.activeElement !== labelInput) labelInput.value = single ? one.label : '';

  for (const dim of ['w', 'h']) {
    const values = new Set(nodes.map((n) => sizeOf(n.size)[dim]));
    for (const input of $$(`.size-${dim}`)) {
      input.disabled = !nodes.length;
      input.placeholder = values.size > 1 ? 'mixed' : '';
      if (document.activeElement !== input) input.value = values.size === 1 ? String(Number([...values][0].toFixed(2))) : '';
    }
  }
  for (const b of $$('[data-arrange-kind]')) b.disabled = nodes.length < (b.dataset.arrangeKind.endsWith('spread') ? 3 : 2);
  for (const b of $$('.dup')) b.disabled = !nodes.length;
  for (const b of $$('.del')) {
    b.disabled = !sel.length;
    b.textContent = recording() ? 'Remove' : 'Delete';
    b.title = recording() ? 'The selection disappears at this step (Delete)' : 'Delete the selection for good (Delete)';
  }
  for (const b of $('palette').children) b.disabled = !sel.length;
  $('dur').disabled = $('pause').disabled = !recording();
  const frames = keyframes(steps.slice(0, point)), last = frames.at(-1);
  const where = point === 0 ? 'the start' : steps[last.start].op === 'wait' ? 'a pause' : `keyframe ${frames.filter((f) => steps[f.start].op !== 'wait').length}`;
  $('target').innerHTML = codeAt !== null
    ? `<b>Showing the code</b> at ${(codeMoments()?.marks[codeAt]?.t / 1000).toFixed(2)} s. It can only be changed in the <b>Code</b> tab; click <b>Start</b> or a keyframe to edit the picture again.`
    : recording()
    ? newKeyframe || point === 0 || steps[point - 1]?.op === 'wait'
      ? `<b>Recording</b> a new keyframe after ${where}. Everything you change now plays together.`
      : `<b>Recording</b> into keyframe ${keyframes(steps).filter((f) => steps[f.start].op !== 'wait' && f.end <= point).length}: everything you change plays together. <b>+ New keyframe</b> (N) for the next one.`
    : point === 0
      ? '<b>Arranging</b> the starting picture: place, drag, resize and colour freely. Nothing is recorded.'
      : `<b>Arranging</b> at ${where}: a change adjusts the step (or the starting picture) that put things there; a new shape appears at this moment.`;
}

// Arrange buttons: align to an edge or centre, spread evenly.
const ARRANGE = {
  left: ['Align left edges', 'M3 2v12M6 4h7v3H6zM6 9h4v3H6z'],
  hcenter: ['Centres in a column', 'M8 2v12M3.5 4h9v3h-9zM5 9h6v3H5z'],
  right: ['Align right edges', 'M13 2v12M3 4h7v3H3zM6 9h4v3H6z'],
  top: ['Align top edges', 'M2 3h12M4 6v7h3V6zM9 6v4h3V6z'],
  vcenter: ['Centres in a row', 'M2 8h12M4 3.5v9h3v-9zM9 5v6h3V5z'],
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
for (const dim of ['w', 'h']) {
  for (const input of $$(`.size-${dim}`)) {
    input.addEventListener('change', () => {
      const v = Number(input.value);
      if (input.value.trim() !== '' && Number.isFinite(v) && v > 0) editor.setSize({ [dim]: v });
      syncInspector();
    });
  }
}
for (const b of $$('.dup')) b.addEventListener('click', () => editor.duplicate());
for (const b of $$('.del')) b.addEventListener('click', deleteSelection);
function deleteSelection() {
  if (stageEditing()) { editor.deleteSelected(); return; }
  if (!recording()) { deleteUnrecorded(); return; }
  // Record: the objects disappear at this step. A node takes its lines along, so only lines
  // whose nodes stay need a step of their own.
  const sel = editor.selection();
  const nodes = new Set(sel.filter((o) => o.kind === 'node').map((o) => o.id));
  const lines = sel.filter((o) => o.kind === 'edge' && !nodes.has(o.a) && !nodes.has(o.b));
  addSteps([...nodes, ...lines.map((e) => e.id)].map((id) => ({ op: 'remove', target: id })));
  editor.setSelection([]);
}
// A label isn't animated: renaming always changes the object itself (on the stage, or its add step).
labelInput.addEventListener('input', () => {
  if (stageEditing()) { editor.setLabel(labelInput.value); return; }
  const id = editor.selected;
  const add = steps.find((s) => s.op === 'add' && s.id === id);
  if (add) add.label = labelInput.value;
  else if (editor.scene.get(id)) editor.scene.get(id).label = labelInput.value;
  else return;
  everythingChanged({ keepSelection: true });
});

// ---------- Arrange at a later point: adjust instead of record ----------
/** The stage and the steps both changed (Arrange mode away from the start). */
function everythingChanged(opts) {
  stageView.set(toStageLua(editor.scene));
  stepsChanged(opts);
}

/** Inserts a step right after step j (for things Arrange has to add, e.g. a colour for a new object). */
function insertAfter(j, step) {
  steps.splice(j + 1, 0, { dur: 0, together: true, ...step });
  if (j + 1 < point || (j + 1 === point && j >= 0)) point++;
}

// A code keyframe may set anything after it: Arrange can't adjust code, so it says what to do instead.
let codeBarrier = null;
const blockedByCode = (j) => {
  if (steps[j]?.op !== 'code') return false;
  codeBarrier = keyframes(steps).findIndex((f) => f.start === j) + 1;
  return true;
};
function sayCodeBarrier() {
  if (codeBarrier === null) return;
  showError(`Keyframe ${codeBarrier} is code and may set this, so Arrange can't adjust it here. Use Record to add a change, or click a keyframe before it.`);
  codeBarrier = null;
}

function adjustMoves(moves) {
  for (const m of moves) {
    const j = sourceOf(steps, point, m.id, 'pos');
    if (blockedByCode(j)) continue;
    if (j < 0) Object.assign(editor.scene.get(m.id) ?? {}, { x: m.x, y: m.y });
    else if (steps[j].op === 'path') steps[j].points = reshapePath(steps[j].points, m.x, m.y);
    else Object.assign(steps[j], { x: m.x, y: m.y });
  }
  everythingChanged();
  sayCodeBarrier();
}

function adjustSizes(list) {
  for (const { id, size } of list) {
    const j = sourceOf(steps, point, id, 'size');
    if (blockedByCode(j)) continue;
    if (j < 0) { if (editor.scene.get(id)) editor.scene.get(id).size = size; } else steps[j].size = size;
  }
  everythingChanged();
  sayCodeBarrier();
}

function adjustColors(ids, color) {
  for (const id of ids) {
    const j = sourceOf(steps, point, id, 'color');
    if (blockedByCode(j)) continue;
    if (j < 0) { if (editor.scene.get(id)) editor.scene.get(id).color = color; } else if (steps[j].op === 'color') steps[j].color = color;
    else insertAfter(j, { op: 'color', target: id, color }); // an object a step added: colour it as it appears
  }
  everythingChanged();
  sayCodeBarrier();
}

/**
 * Arrange: a line between two stage objects, drawn at the start, is part of the stage; drawn later it
 * appears at that moment; between objects that steps add, it appears with the later one.
 */
function connectUnrecorded(a, b, directed) {
  if (point > 0) {
    const id = nextStepId(steps);
    addSteps([{ op: 'connect', id, a, b, directed }]);
    editor.popIn(id);
    return;
  }
  if (editor.scene.isNode(a) && editor.scene.isNode(b)) {
    const id = editor.scene.addEdge(a, b, directed);
    everythingChanged();
    editor.popIn(id);
    return;
  }
  const j = Math.max(...[a, b].map((id) => steps.findIndex((s) => s.op === 'add' && s.id === id)));
  const id = nextStepId(steps);
  insertAfter(j, { op: 'connect', id, a, b, directed });
  everythingChanged();
  editor.popIn(id);
}

/** Arrange: copies go into the starting picture. */
function pasteOnStage(plan) {
  const ids = plan.nodes.map((n) => {
    const id = editor.scene.addNode(n.label, n.x, n.y, n.shape, n.size);
    if (n.color) editor.scene.get(id).color = n.color;
    return id;
  });
  const lines = plan.edges.map((e) => {
    const id = editor.scene.addEdge(ids[e.a], ids[e.b], e.directed);
    if (e.color) editor.scene.get(id).color = e.color;
    return id;
  });
  everythingChanged();
  return [...ids, ...lines];
}

/** Arrange: deleting takes the object away for good (from the stage, or the step that added it). */
function deleteUnrecorded() {
  for (const id of editor.selectedIds()) {
    if (editor.scene.get(id)) { editor.scene.remove(id); continue; }
    const j = steps.findIndex((s) => (s.op === 'add' || s.op === 'connect') && s.id === id);
    if (j >= 0) { steps = removeStep(steps, j); if (j < point) point--; }
  }
  editor.setSelection([]);
  everythingChanged();
}

/**
 * A new starting picture (a loaded stage.lua, or empty for Clear picture). Goes to Start to show it,
 * and redraws everything: the steps that used objects no longer there are dropped (Undo brings them back).
 */
function loadStage(text) {
  try {
    editor.setScene(runProgram(fengari, { stage: text }).scene);
    point = 0;
    newKeyframe = false;
    everythingChanged();
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
  point = 0;
  aiLast = [];
  aiFresh = [];
  aiHistory = [];
  scriptBox.value = '';
  loadStage('');
  stepsChanged();
  updateRunOrder();
});

// ---------- Build: the steps ----------
// Colour swatches: at the start they colour the selection, later they add colour steps.
for (const c of PALETTE) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.title = c;
  b.style.background = paint(c);
  b.disabled = true;
  b.addEventListener('click', () => {
    if (stageEditing()) editor.setColor(c);
    else if (!recording()) adjustColors(editor.selectedIds(), c);
    else addSteps(editor.selectedIds().map((id) => ({ op: 'color', target: id, color: c })));
  });
  $('palette').append(b);
}

// A duration typed into a field, in ms: 0.1 to 60 s, the default 0.5 s when empty or not a number.
// (A change that takes 0 s can't be seen happening: a curved move would just jump to its end.)
const MIN_DUR = 100, MAX_DUR = 60;
function seconds(text) {
  const v = String(text).trim() === '' ? NaN : Number(text);
  return Math.round(Math.min(MAX_DUR, Math.max(MIN_DUR / 1000, Number.isFinite(v) ? v : 0.5)) * 1000);
}
function stepDur() {
  return seconds($('dur').value);
}

let justAdded = new Set(); // the steps that slide into the list
/**
 * Records changes at the current point: they join the keyframe there (a second change to the same
 * thing updates it), or begin a new keyframe after "+ New keyframe" (at the end), at the start or after a pause.
 */
function addSteps(list) {
  if (!list.length) return;
  // a shape or line added here appears at the moment the canvas shows, not at the start of a keyframe
  const r = recordSteps(steps, point, list, { join: !newKeyframe, dur: stepDur(), appearAtEnd: true });
  steps = r.steps;
  point = r.point;
  newKeyframe = false;
  justAdded = new Set(r.added);
  stepsChanged();
  justAdded = new Set();
}
$('pause').addEventListener('click', () => addSteps([{ op: 'wait' }]));
$('next-key').addEventListener('click', nextKeyframe);
/** + New keyframe: go to the end and record; what is changed next is a new keyframe there. */
function nextKeyframe() {
  if (!recording()) setMode('record');
  setPoint(steps.length);
  newKeyframe = true;
  renderSteps();
  showPoint(); // the new keyframe has no trails yet
}
$('clear-steps').addEventListener('click', () => { steps = []; stepsChanged(); });

/** Paste in Behaviour: the copies appear (and their lines), all at once. Returns their ids. */
function pasteSteps(plan) {
  const changes = [];
  const push = (s) => changes.push(s);
  let k = Number(nextStepId(steps).slice(1)); // one new id each (nextStepId only sees the steps so far)
  const newId = () => `s${k++}`;
  const ids = plan.nodes.map((n) => {
    const id = newId();
    push({ op: 'add', id, shape: n.shape, label: n.label, x: n.x, y: n.y, size: n.size });
    return id;
  });
  const lines = plan.edges.map((e) => {
    const id = newId();
    push({ op: 'connect', id, a: ids[e.a], b: ids[e.b], directed: e.directed });
    return id;
  });
  // the copies keep their colours: an instant colour step each, at the same moment
  plan.nodes.forEach((n, i) => { if (n.color && n.color !== defaultColor(n.shape)) push({ op: 'color', target: ids[i], color: n.color, dur: 0 }); });
  plan.edges.forEach((e, i) => { if (e.color && e.color !== DEFAULT_EDGE_COLOR) push({ op: 'color', target: lines[i], color: e.color, dur: 0 }); });
  addSteps(changes);
  return [...ids, ...lines];
}

/**
 * A step whose object is gone goes too (a deleted object, or a remove inserted before steps that used
 * it). Keeps the current point on the same step and says when later steps were dropped.
 */
function prune() {
  const before = steps.length, upto = new Set(steps.slice(0, point));
  steps = keepKeyframes(steps, pruneSteps(steps, editor.scene));
  point = steps.filter((s) => upto.has(s)).length;
  const dropped = before - steps.length;
  $('dropped-note').hidden = !dropped;
  if (dropped) $('dropped-note').textContent = `${dropped} step${dropped === 1 ? '' : 's'} used an object that is no longer there, so ${dropped === 1 ? 'it was' : 'they were'} removed. Ctrl+Z brings ${dropped === 1 ? 'it' : 'them'} back.`;
}

function stepsChanged({ keepSelection = false } = {}) {
  prune();
  renderSteps();
  projectChanged();
  if (tab !== 'build') return;
  showPoint();
  if (!keepSelection) editor.setSelection(editor.selectedIds()); // drops objects that are gone
  syncInspector();
}

/** Work at a point: after the first k steps (0 = the start). */
function setPoint(k) {
  codeAt = null;
  point = keyframeEndAt(steps, Math.max(0, Math.min(steps.length, k))); // always the end of a keyframe
  newKeyframe = false;
  renderSteps();
  showPoint();
}

/** Arrange (nothing is recorded) or Record (every change becomes a step). */
function setMode(next) {
  mode = next;
  codeAt = null; // Arrange or Record: back to the steps
  for (const b of $$('[data-mode]')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
  $('editor').classList.toggle('recording', recording());
  renderSteps();
  if (tab === 'build') showPoint();
}
for (const b of $$('[data-mode]')) b.addEventListener('click', () => setMode(b.dataset.mode));

// The canvas at the current point: the starting picture, or the picture after the first k steps with
// faint trails of their moves.
function showPoint() {
  $('canvas-hint').textContent = HINTS[mode];
  if (codeAt !== null && showCodeMoment()) return;
  codeAt = null;
  editor.recording = recording();
  if (stageEditing()) { showError(null); editor.setMode('stage'); syncInspector(); return; }
  try {
    const upto = steps.slice(0, point);
    const built = buildSteps(upto, editor.scene);
    let result;
    try { result = runProgram(fengari, { stage: toStageLua(editor.scene), steps: built.code }); } catch (e) { throw new Error(codeKeyframeError(e.message, built)); }
    showError(null);
    const view = toEditorIds(sceneAt(result.timeline, result.timeline.durationMs), result, editor.scene, upto, built.stepAtLine);
    editor.setMode('behaviour', view, keyframeTrails(result, built, upto));
  } catch (e) {
    showError(e.message);
    editor.setMode('behaviour', null);
  }
  syncInspector();
}

/**
 * The trails of the keyframe shown (the one ending at the point): only its own moves, and only of objects
 * still there at its end. A new, still empty keyframe (+ New keyframe) has none yet; nor has a pause.
 */
function keyframeTrails(result, built, upto) {
  const f = keyframes(upto).at(-1);
  if (!f || newKeyframe || upto[f.start].op === 'wait') return [];
  const own = result.timeline.commands.filter((c) => c.src?.file === 'steps.lua' && built.stepAtLine[c.src.line] >= f.start);
  if (!own.length) return [];
  const from = Math.min(...own.map((c) => c.t));
  const end = sceneAt(result.timeline, result.timeline.durationMs);
  const there = new Set(end.nodes.map((n) => n.id));
  return tweens(result.timeline)
    .filter((tw) => tw.prop === 'pos' && tw.t0 >= from && there.has(tw.id) && (tw.from.x !== tw.to.x || tw.from.y !== tw.to.y))
    .map((tw) => tw.path ?? [tw.from, tw.to]); // a curved move draws its curve
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
  } else if (c.op === 'path') {
    const end = c.points.at(-1);
    what.append(`curved move → (${Math.round(end.x)}, ${Math.round(end.y)})`);
  } else if (c.op === 'size') {
    const z = sizeOf(c.size), f = (v) => Number(v.toFixed(2));
    what.append(z.w === z.h ? `size → ×${f(z.w)}` : `size → width ×${f(z.w)}, height ×${f(z.h)}`);
  } else if (c.op === 'label') {
    what.append('label → ', el('code', null, c.label));
  } else if (c.op === 'remove') {
    what.append('disappears');
  } else {
    what.append(c.kind ? `${c.kind} appears` : 'appears');
  }
  if (c.ease === 'smooth') what.append(' (smooth)');
  return what;
}

function describe(s, names) {
  if (s.op === 'code') {
    const w = el('span', 'what');
    const lines = s.lua.split('\n').filter((l) => l.trim());
    w.append(el('i', 'op code', '{ }'), ' ', el('code', null, lines[0] ?? ''), lines.length > 1 ? ` (${lines.length} lines)` : '');
    return w;
  }
  if (s.op === 'wait') { const w = el('span', 'what'); w.append(el('b', null, 'Pause')); return w; }
  if (s.op === 'add') return describeChange(s.label, { op: 'add', kind: kindName({ kind: 'node', shape: s.shape }).toLowerCase() });
  if (s.op === 'connect') return describeChange(names.nameOf(s.id), { op: 'connect', kind: s.directed ? 'arrow' : 'line' });
  return describeChange(names.nameOf(s.target), s);
}


// The list: a Start row, the steps, and a marker where new steps go. Clicking a row works at that point.
function renderSteps() {
  const list = $('steps');
  list.replaceChildren();
  const names = stepNames(steps, editor.scene);
  const pick = (li, k) => {
    li.classList.add('pickable');
    li.addEventListener('click', (e) => { if (!e.target.closest('input, select, button')) setPoint(k); });
  };
  const marker = (text) => {
    const li = el('li', 'marker');
    li.append(el('span', 'num', '▸'), el('span', 'what', text));
    return li;
  };
  const durField = (value, set) => {
    const dur = el('input');
    Object.assign(dur, { type: 'number', min: MIN_DUR / 1000, max: MAX_DUR, step: 0.1, value: value / 1000, title: 'seconds' });
    dur.setAttribute('aria-label', 'duration in seconds');
    dur.addEventListener('change', () => {
      set(seconds(dur.value));
      stepsChanged();
    });
    const label = el('label');
    label.append(dur, ' s');
    return label;
  };
  const removeButton = (i) => {
    const b = el('button', 'x', '×');
    b.type = 'button';
    b.title = 'Remove';
    b.addEventListener('click', () => {
      steps = removeStep(steps, i);
      if (i < point) point--;
      point = keyframeEndAt(steps, point);
      stepsChanged();
    });
    return b;
  };

  const start = el('li', `start${point === 0 && codeAt === null ? ' current' : ''}`);
  const what = el('span', 'what');
  what.append(el('b', null, 'Start'), ' the starting picture');
  start.append(el('span', 'num', '●'), what);
  pick(start, 0);
  list.append(start);
  if (recording() && point === 0) list.append(marker(steps.length ? 'A new keyframe goes here' : 'Keyframe 1: make your first changes'));

  let n = 0;
  for (const f of keyframes(steps)) {
    const first = steps[f.start];
    const here = point === f.end && codeAt === null;
    if (first.op === 'wait') { // a pause: one row
      const li = el('li', `pause${here ? ' current' : ''}`);
      const w = el('span', 'what');
      w.append(el('b', null, 'Pause'));
      li.append(el('span', 'num', '‖'), w, removeButton(f.start));
      const opts = el('div', 'opts');
      opts.append(durField(first.dur, (v) => { first.dur = v; }));
      li.append(opts);
      pick(li, f.end);
      if (justAdded.has(first)) li.classList.add('new');
      list.append(li);
    } else {
      n++;
      const group = steps.slice(f.start, f.end);
      const timed = group.filter((s) => !INSTANT.has(s.op) && s.op !== 'code');
      const head = el('li', `keyframe${here ? ' current' : ''}`);
      const w = el('span', 'what');
      w.append(el('b', null, `Keyframe ${n}`));
      if (recording() && here && !newKeyframe) w.append(el('span', 'rec', ' ● recording'));
      const x = el('button', 'x', '×');
      x.type = 'button';
      x.title = 'Delete this keyframe';
      x.addEventListener('click', (e) => { e.stopPropagation(); deleteKeyframe(group); });
      head.append(el('span', 'num', String(n)), w, x);
      // one duration for the keyframe; when its changes last different times (an AI can make that),
      // each timed change gets its own field instead, so editing one doesn't flatten the others
      const mixed = new Set(timed.map((s) => s.dur)).size > 1;
      if (timed.length && !mixed) {
        const opts = el('div', 'opts');
        opts.append(durField(Math.max(...timed.map((s) => s.dur)), (v) => { for (const s of timed) s.dur = v; }));
        head.append(opts);
      }
      pick(head, f.end);
      list.append(head);
      group.forEach((s, k) => {
        const li = el('li', `change${here ? ' in-current' : ''}`);
        li.append(el('span', 'num', ''), describe(s, names), removeButton(f.start + k));
        if (mixed && !INSTANT.has(s.op)) {
          const opts = el('div', 'opts');
          opts.append(durField(s.dur, (v) => { s.dur = v; }));
          li.append(opts);
        }
        pick(li, f.end);
        if (justAdded.has(s)) li.classList.add('new');
        list.append(li);
      });
    }
    if (recording() && here && (newKeyframe || first.op === 'wait')) list.append(marker('The new keyframe goes here'));
  }
  renderCodeRows(list);
  renderRepl();
  // keep the current point in view by scrolling the list only (scrollIntoView would move the whole page)
  const mark = list.querySelector('.marker') ?? list.querySelector('.current');
  if (mark && (mark.offsetTop < list.scrollTop || mark.offsetTop + mark.offsetHeight > list.scrollTop + list.clientHeight)) {
    list.scrollTop = mark.offsetTop - list.clientHeight / 2;
  }
  stepsView.set(stepsToLua(steps, editor.scene) || '-- no steps yet');
  updateRunOrder();
}

// ---------- What the code does, read-only after the steps ----------
// The Code tab runs after the steps. So that the picture and the list agree with it, the list shows
// its changes (grouped by the time they finish, like Moments) under the steps, and clicking one shows
// the picture then. Nothing here can be edited: the code is changed in the Code tab.
const MAX_CODE_ROWS = 200;
let codeCache = { key: null };

/** { result, built, marks: [{ t, cmds }] } for the code after the current steps, { error }, or null without code. */
function codeMoments() {
  if (!codeLines()) return null;
  let built, prog;
  try {
    built = buildSteps(steps, editor.scene);
    prog = { stage: toStageLua(editor.scene), steps: built.code, script: scriptBox.value };
  } catch (e) { return { error: e.message, marks: [] }; }
  const key = JSON.stringify(prog);
  if (codeCache.key === key) return codeCache;
  try {
    const result = runProgram(fengari, prog);
    const ends = new Map();
    for (const c of result.timeline.commands) {
      if (c.src?.file !== 'script.lua') continue;
      const end = c.t + (c.dur ?? 0);
      if (!ends.has(end)) ends.set(end, []);
      ends.get(end).push(c);
    }
    const marks = [...ends].sort((a, b) => a[0] - b[0]).map(([t, cmds]) => ({ t, cmds }));
    codeCache = { key, result, built, marks };
  } catch (e) {
    codeCache = { key, error: e.message, marks: [] };
  }
  return codeCache;
}

function renderCodeRows(list) {
  const code = codeMoments();
  if (!code) return;
  const head = el('li', 'code-head');
  const w = el('span', 'what');
  w.append(el('b', null, 'From the code'), ' read-only');
  head.append(el('span', 'num', '{ }'), w);
  list.append(head);
  if (code.error) {
    list.append(el('li', 'code-note error', `The code stops with an error: ${code.error}`));
    return;
  }
  if (!code.marks.length) { list.append(el('li', 'code-note', 'The code changes nothing yet.')); return; }
  code.marks.slice(0, MAX_CODE_ROWS).forEach((m, i) => {
    const li = el('li', `code-row pickable${codeAt === i ? ' current' : ''}`);
    const what = el('span', 'what');
    m.cmds.forEach((c, k) => {
      if (k) what.append(', ');
      what.append(describeChange(c.name, changeOf(c)));
    });
    const lines = [...new Set(m.cmds.map((c) => c.src.line))];
    li.append(el('span', 'num', `${(m.t / 1000).toFixed(1)}`), what, el('span', 'src', `line ${lines.slice(0, 3).join(', ')}${lines.length > 3 ? '…' : ''}`));
    li.title = `At ${(m.t / 1000).toFixed(2)} s`;
    li.addEventListener('click', () => { codeAt = i; renderSteps(); showPoint(); });
    list.append(li);
  });
  const more = code.marks.length - MAX_CODE_ROWS;
  if (more > 0) list.append(el('li', 'code-note', `… and ${more} more (all of them are in Result → Moments)`));
}

/** Shows code moment codeAt on the canvas, read-only. False when there is no such moment any more. */
function showCodeMoment() {
  const code = codeMoments();
  const m = code?.marks?.[codeAt];
  if (!m) return false;
  showError(null);
  $('canvas-hint').textContent = HINTS.code;
  const { result, built } = code;
  const view = toEditorIds(sceneAt(result.timeline, m.t), result, editor.scene, steps, built.stepAtLine);
  const moved = new Set(m.cmds.filter((c) => c.prop === 'pos').map((c) => `${c.id} ${c.t}`));
  const trails = tweens(result.timeline)
    .filter((tw) => tw.prop === 'pos' && moved.has(`${tw.id} ${tw.t0}`) && (tw.from.x !== tw.to.x || tw.from.y !== tw.to.y))
    .map((tw) => tw.path ?? [tw.from, tw.to]);
  editor.setMode('view', view, trails);
  syncInspector();
  return true;
}

// ---------- 2. Behaviour: the REPL ----------
// Lua typed here becomes a keyframe at the point shown (like Record). Changes that all start together
// become ordinary steps, editable on the canvas; anything else (waits, loops, algorithms) is one code
// keyframe, played as written. The log above the box is the keyframes as Lua, whoever made them.
const replBox = $('repl');
let replEditing = null; // the keyframe being edited (its steps), or null
const replPast = []; let replBack = 0; // what was typed before (↑ / ↓)

function replSay(text, error = false) {
  $('repl-msg').hidden = !text;
  $('repl-msg').textContent = text ?? '';
  $('repl-msg').classList.toggle('error', error);
}

/** "steps.lua:40: …" from inside a code keyframe -> "Keyframe 3 (code), line 2: …"; other messages unchanged. */
function codeKeyframeError(message, built) {
  const m = /^steps\.lua:(\d+):\s*/.exec(message);
  const j = m ? built.stepAtLine[Number(m[1])] : undefined;
  if (j === undefined || steps[j]?.op !== 'code') return message;
  const n = keyframes(steps).filter((f) => f.start <= j && steps[f.start].op !== 'wait').length;
  return `Keyframe ${n} (code), line ${Number(m[1]) - built.stepAtLine.indexOf(j)}: ${message.slice(m[0].length)} Change it in the Code tab (Edit).`;
}

/** "steps.lua:12: …" in a code keyframe -> "line 3: …" of what was typed. */
function replError(message, built, index) {
  const m = /^steps\.lua:(\d+):\s*/.exec(message);
  if (!m) return message.replace(/^script\.lua:(\d+):\s*/, 'line $1: ');
  if (built.stepAtLine[Number(m[1])] !== index) return `An earlier keyframe fails first: ${codeKeyframeError(message, built)}`;
  const first = built.stepAtLine.indexOf(index); // the "do" line
  return `line ${Number(m[1]) - first}: ${message.slice(m[0].length)}`;
}

/**
 * An edited keyframe that makes the same objects again (same kind and label, in order) gives them their
 * old ids, so later keyframes that use them stay. Changes `added` in place.
 */
function keepIds(old, added) {
  const was = old.filter((s) => s.op === 'add' || s.op === 'connect');
  const map = new Map();
  for (const s of added) {
    if (s.op !== 'add' && s.op !== 'connect') continue;
    const k = was.findIndex((o) => o.op === s.op && (s.op === 'add' ? o.label === s.label && o.shape === s.shape : true));
    if (k < 0) continue;
    map.set(s.id, was[k].id);
    was.splice(k, 1);
  }
  const id = (v) => map.get(v) ?? v;
  for (const s of added) {
    if (s.id !== undefined) s.id = id(s.id);
    if (s.target !== undefined) s.target = id(s.target);
    if (s.a !== undefined) { s.a = id(s.a); s.b = id(s.b); }
  }
}

/**
 * Deletes a whole keyframe or pause (its steps). Later steps that used an object it made go too, as
 * when the object is deleted; one Ctrl+Z brings it all back. Returns what to tell the user.
 */
function deleteKeyframe(group) {
  const gone = new Set(group);
  const before = steps.length - group.length;
  const pause = group[0]?.op === 'wait';
  point = steps.slice(0, point).filter((s) => !gone.has(s)).length;
  const copies = steps.map((s) => ({ ...s })); // as removeStep: the steps in history stay as they were
  steps = keepKeyframes(copies, copies.filter((_, i) => !gone.has(steps[i])));
  point = keyframeEndAt(steps, point);
  replEditing = null;
  stepsChanged();
  const dropped = before - steps.length;
  return `${pause ? 'Pause' : 'Keyframe'} deleted${dropped ? `, and ${dropped} later step${dropped === 1 ? '' : 's'} that used what it made` : ''}. Ctrl+Z brings it back.`;
}

function runEntry({ fromOldCode = false } = {}) {
  const lua = replBox.value.replace(/\s+$/, '');
  if (!lua.trim()) { // an emptied box while editing deletes that keyframe
    if (!replEditing) return false;
    if (!replEditing.every((s) => steps.includes(s))) { replEditing = null; return replSay('That keyframe has changed since; nothing was deleted.', true); }
    replSay(deleteKeyframe(replEditing));
    return true;
  }
  const old = replEditing ?? [];
  const at = replEditing ? steps.indexOf(old[0]) : steps.length; // a new entry always goes at the end
  if (at < 0 || old.some((s, i) => steps[at + i] !== s)) { replEditing = null; return replSay('That keyframe has changed since; nothing was replaced.', true); }
  const upto = steps.slice(0, at), after = steps.slice(at + old.length);
  let added = null, scene = editor.scene;
  const pause = /^\s*wait\(\s*(\d+(?:\.\d+)?)\s*\)\s*;?\s*$/.exec(lua); // a pause stays a pause
  if (pause && Number(pause[1]) > 0) added = [{ op: 'wait', dur: Math.round(Number(pause[1]) * 1000) }];
  else try {
    const r = codeToSteps(fengari, editor.scene, upto, lua, { taken: after });
    const extra = r.steps.slice(upto.length);
    if (keyframes(extra).length <= 1 && !extra.some((s) => s.op === 'wait')) { added = extra; scene = r.scene; }
  } catch (e) {
    if (e instanceof ScriptError) { // the entry's own mistake, or an earlier keyframe that fails
      return replSay(/^steps\.lua:/.test(e.message) ? `An earlier keyframe fails first: ${codeKeyframeError(e.message, buildSteps(upto, editor.scene))}` : replError(e.message), true);
    } // anything else: a code keyframe
  }
  if (!added) { // a code keyframe: check that it runs here (an edited one keeps its id, so its objects do)
    added = [{ op: 'code', id: old[0]?.op === 'code' ? old[0].id : nextStepId([...steps]), lua }];
    const built = buildSteps([...upto, ...added], editor.scene);
    try { runProgram(fengari, { stage: toStageLua(editor.scene), steps: built.code }); } catch (e) { return replSay(replError(e.message, built, upto.length), true); }
  }
  keepIds(old, added);
  replPast.push(lua);
  replBack = replPast.length;
  editor.scene = scene;
  steps = [...upto, ...added, ...after];
  point = steps.length; // the canvas shows the end, where the next entry goes
  codeAt = null;
  newKeyframe = false;
  justAdded = new Set(added);
  const what = !added.length ? 'Added to the starting picture.' : added[0].op === 'code' ? 'A code keyframe: it plays as written.' : 'A keyframe: you can also change it on the canvas.';
  replSay(replEditing ? 'Keyframe replaced.' : what);
  replEditing = null;
  replBox.value = '';
  if (fromOldCode) { scriptBox.value = ''; updateRunOrder(); }
  everythingChanged();
  justAdded = new Set();
  return true;
}

replBox.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); runEntry(); return; }
  if (e.key === 'Escape' && replEditing) { replEditing = null; replBox.value = ''; replSay('Not changed.'); renderRepl(); return; }
  // ↑ / ↓ at the start or end of the box: what was typed before
  const atStart = replBox.selectionStart === 0, atEnd = replBox.selectionEnd === replBox.value.length;
  if (e.key === 'ArrowUp' && atStart && replBack > 0) { e.preventDefault(); replBox.value = replPast[--replBack]; }
  else if (e.key === 'ArrowDown' && atEnd && replBack < replPast.length) { e.preventDefault(); replBox.value = replPast[++replBack] ?? ''; }
});
$('repl-run').addEventListener('click', runEntry);
$('legacy-keyframe').addEventListener('click', () => {
  const keep = point, typed = replBox.value;
  replBox.value = scriptBox.value;
  replEditing = null;
  point = steps.length; // the old code played after everything
  if (!runEntry({ fromOldCode: true })) { point = keep; replBox.value = typed; } // the message says why
});

/** The log: Start and every keyframe as Lua, in the order they play; click one to work there. */
function renderRepl() {
  const log = $('repl-log');
  if (!log) return;
  log.replaceChildren();
  let built;
  try { built = buildSteps(steps, editor.scene); } catch { return; }
  const lines = built.code.split('\n');
  const item = (title, code, k, { current, step, group } = {}) => {
    const li = el('li', `repl-item${current ? ' current' : ''}${step?.op === 'code' ? ' code' : ''}${replEditing && step === replEditing[0] ? ' editing' : ''}`);
    const head = el('div', 'repl-head');
    head.append(el('b', null, title));
    if (group) {
      const edit = el('button', 'repl-edit', 'Edit');
      edit.type = 'button';
      edit.title = 'Put this in the box; Enter replaces the keyframe';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        replEditing = group;
        replBox.value = code;
        replSay('Editing this keyframe: Enter replaces it (empty deletes it), Esc leaves it as it is.');
        replBox.focus();
        renderRepl();
      });
      const del = el('button', 'repl-edit', 'Delete');
      del.type = 'button';
      del.title = 'Delete this keyframe (Ctrl+Z brings it back)';
      del.addEventListener('click', (e) => {
        e.stopPropagation();
        if (replEditing && replEditing[0] === group[0]) replBox.value = '';
        replSay(deleteKeyframe(group));
      });
      head.append(edit, del);
    }
    li.append(head, el('pre', null, code));
    li.addEventListener('click', () => setPoint(k));
    log.append(li);
  };
  const stage = toStageLua(editor.scene).split('\n').filter((l) => l.trim() && !l.startsWith('--')).join('\n');
  item('Start', stage || '-- empty', 0, { current: point === 0 && codeAt === null });
  let n = 0;
  for (const f of keyframes(steps)) {
    const first = steps[f.start];
    const code = first.op === 'code' ? first.lua
      : lines.filter((_, i) => { const j = built.stepAtLine[i + 1]; return j >= f.start && j < f.end; }).join('\n');
    const title = first.op === 'wait' ? 'Pause' : `Keyframe ${++n}${first.op === 'code' ? ' · code' : ''}`;
    item(title, code, f.end, { current: point === f.end && codeAt === null, step: first, group: steps.slice(f.start, f.end) });
  }
  const count = keyframes(steps).filter((f) => steps[f.start].op !== 'wait').length;
  $('repl-where').textContent = replEditing
    ? 'Enter replaces the keyframe being edited (empty: deletes it) · Esc leaves it as it is'
    : !steps.length ? 'Enter adds keyframe 1 (or, for shapes you make, the starting picture)' : `Enter adds keyframe ${count + 1}, at the end`;
  const cur = log.querySelector('.current'); // scroll the log only, not the page
  if (cur && (cur.offsetTop < log.scrollTop || cur.offsetTop + cur.offsetHeight > log.scrollTop + log.clientHeight)) log.scrollTop = cur.offsetTop - 8;
}

// ---------- 2. Behaviour: old code (script.lua) ----------
const scriptBox = $('script');
scriptBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  scriptBox.setRangeText('  ', scriptBox.selectionStart, scriptBox.selectionEnd, 'end');
});
let codeTimer = null;
scriptBox.addEventListener('input', () => {
  updateRunOrder();
  clearTimeout(codeTimer);
  codeTimer = setTimeout(() => { renderSteps(); if (codeAt !== null) showPoint(); }, 400);
});
const clearCode = () => { scriptBox.value = ''; updateRunOrder(); renderSteps(); showPoint(); };
$('clear-code').addEventListener('click', clearCode);
$('clear-code-note').addEventListener('click', clearCode);
$('save-code').addEventListener('click', () => saveText(scriptBox.value, 'script.lua'));
$('example').addEventListener('change', async () => {
  const name = $('example').value;
  $('example').value = '';
  replBox.value = (await fetch(`/examples/${name}`).then((r) => r.text())).replace(/\s+$/, '');
  replSay(name.includes('sort') || name.includes('network') ? 'An example for an empty canvas (New project). Press Enter to make it a keyframe.' : 'Press Enter to make it a keyframe.');
  replBox.focus();
});

function codeLines() {
  return scriptBox.value.split('\n').filter((l) => l.trim() && !l.trim().startsWith('--')).length;
}

function updateRunOrder() {
  const lines = codeLines();
  $('legacy-code').hidden = !lines;
  $('legacy-lines').textContent = lines;
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
    let result;
    try { result = runProgram(fengari, prog); } catch (e) { throw new Error(codeKeyframeError(e.message, built)); }
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
  if (c.prop === 'label') return { op: 'label', label: c.value };
  if (c.path) return { op: 'path', points: c.path };
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

// The SVGs open in a new tab (the animated one plays there); save them from that tab if you want them.
function openSVG(text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  window.open(url, '_blank');
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
$('dl-frame').addEventListener('click', () => openSVG(renderFrame(timeline(), player.times, player.frame, output)));
$('dl-svg').addEventListener('click', () => openSVG(renderAnimatedSVG(timeline(), output)));
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
  } else if (!recording() && editor.sel.size && e.key.startsWith('Arrow')) {
    // Arrange: nudge the selection; Shift = 10 px (Record would add a step per key press, so drag instead)
    const d = e.shiftKey ? 10 : 1;
    const dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
    if (stageEditing()) editor.nudge(dx, dy);
    else adjustMoves(editor.selectedNodes().map((nd) => ({ id: nd.id, x: nd.x + dx, y: nd.y + dy })));
    e.preventDefault();
  } else if (key === 'n' && !e.shiftKey) {
    nextKeyframe();
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

const autosave = (text) => { try { localStorage.setItem(SAVE_KEY, text); } catch { /* private window or storage full: just no autosave */ } };

// Moves saved with 0 s (an empty Duration field used to mean 0) get the default, so they can be seen.
const visibleMoves = (list) => list.map((s) => ((s.op === 'path' || s.op === 'move') && !(s.dur > 0) ? { ...s, dur: 500 } : s));

function restoreProject(text) {
  autosave(text); // undo and redo are saved too, so a reload shows what you see
  const p = JSON.parse(text);
  editor.setScene(Scene.from(p.scene)); // (this prunes the old steps; they are replaced next)
  steps = visibleMoves(p.steps);
  scriptBox.value = p.script ?? '';
  point = Math.min(point, steps.length);
  renderSteps();
  if (tab === 'build') showPoint();
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

  if (editing) {
    showPoint();
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
    steps = visibleMoves(Array.isArray(p.steps) ? p.steps : []);
    scriptBox.value = p.script ?? '';
    return true;
  } catch {
    return false;
  }
}
if (!restoreSaved()) loadStage(await fetch('/examples/stage.lua').then((r) => r.text()));
steps = pruneSteps(steps, editor.scene);
point = steps.length; // carry on at the end (0, the start, for a new project)
setMode('arrange');
renderSteps();
updateRunOrder();
editor.setTool('circle');
showTab('build');
history = new History({
  snapshot,
  restore: restoreProject,
  onCommit: autosave,
});
updateHistoryButtons();
window.addEventListener('pagehide', () => history.commit());

// ---------- AI: tools sent by the server (node/mcp.js) run here, on the live project ----------
// The AI works at the end of the steps: one action after another (together = at the same time), and
// what it draws before anything happens is the starting picture. "it"/"them" (aiLast) and its own
// undo (aiHistory) last between calls, until the user changes something by hand. "selected"/"these"
// are the objects selected on the Stage. Each call is also one step of the app's undo.
let aiLast = [], aiFresh = [], aiHistory = [], aiSeen = null;
let aiNoteTimer = null;

/** Runs one AI tool here. Returns { text } or { error }, plus { svg } (the end picture) for show. */
const aiNow = () => JSON.stringify([editor.scene.toJSON(), steps]);
/** The live project as the AI tools see it. */
function aiProject() {
  if (aiSeen !== aiNow()) { aiLast = []; aiFresh = []; aiHistory = []; } // changed by hand since: start afresh
  return { scene: editor.scene, steps, last: aiLast, fresh: aiFresh, selected: editor.selectedIds(), history: aiHistory };
}

export function runAiTool(name, args) {
  if (tab !== 'build') showTab('build');
  const project = aiProject();
  try {
    const text = runTool(project, name, args);
    aiLast = project.last;
    aiFresh = project.fresh;
    aiHistory = project.history;
    steps = project.steps;
    point = steps.length; // show where the AI is
    if (project.scene !== editor.scene) editor.setScene(project.scene); // clear, undo
    everythingChanged();
    aiSeen = aiNow();
    noteAi(name, args);
    if (name !== 'show') return { text };
    return { text, svg: endPicture() };
  } catch (e) {
    return { error: e.message };
  }
}

/** The last frame of the starting picture + steps, as an SVG (for the AI to look at). */
function endPicture() {
  try {
    const { timeline } = runProgram(fengari, { stage: toStageLua(editor.scene), steps: stepsToLua(steps, editor.scene) });
    return renderFrame(timeline, [timeline.durationMs], 0, outputSettings());
  } catch {
    return undefined;
  }
}

function noteAi(name, args) {
  const note = $('ai-note');
  note.hidden = false;
  note.textContent = `✦ AI is editing: ${name}${args?.label ? ` ${args.label}` : ''}`;
  clearTimeout(aiNoteTimer);
  aiNoteTimer = setTimeout(() => { note.hidden = true; }, 4000);
}

setupAssistant({ runTool: runAiTool, brief: () => briefState(aiProject()), names: () => objectNames(aiProject()) });

if (typeof EventSource === 'function') {
  const live = new EventSource('/api/live');
  live.addEventListener('tool', (e) => {
    const { id, name, args } = JSON.parse(e.data);
    const reply = runAiTool(name, args);
    fetch('/api/tool-result', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...reply }) });
  });
}
