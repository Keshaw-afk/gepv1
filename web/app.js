// Page wiring: 1 Stage (editor) -> 2 Behaviour (steps + code) -> 3 Result (preview + downloads).
// Everything the GUI makes is turned into Lua (stage.lua, steps.lua) and run by the same engine
// as hand-written code (script.lua).

import { runProgram } from '../core/lua_api.js';
import { toStageLua } from '../core/stage_file.js';
import { stepsToLua, pruneSteps, toEditorIds } from '../core/steps.js';
import { sceneAt } from '../core/player.js';
import { renderSVG, paint } from '../core/svg.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { formatTrace } from '../core/trace.js';
import { Editor } from './editor.js';

const fengari = window.fengari;
const $ = (id) => document.getElementById(id);
const PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'lightgrey'];
const HINTS = {
  stage: 'Click empty space: add a node · Drag: move · Shift-drag or right-drag from node to node: connect · Double-click: rename · Delete key: remove',
  behaviour: 'Showing the picture after your steps. Click a node or line, then pick a colour · Drag a node to record a move',
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

const program = () => ({ stage: toStageLua(editor.scene), steps: stepsToLua(steps, editor.scene), script: scriptBox.value });

// ---------- 1. Stage ----------
const labelInput = $('label');
const editor = new Editor($('editor'), {
  onChange: () => {
    $('stage-code').textContent = toStageLua(editor.scene);
    steps = pruneSteps(steps, editor.scene); // a deleted node takes its steps with it
    renderSteps();
  },
  onSelect: (obj) => {
    const isNode = obj?.kind === 'node';
    const name = obj ? editor.scene.nameOf(obj.id) : '';
    labelInput.disabled = !isNode;
    labelInput.value = isNode ? obj.label : '';
    $('delete').disabled = !obj;
    $('selection').textContent = !obj ? 'Nothing selected' : isNode ? 'Node' : `Line ${name}`;
    $('target').textContent = obj
      ? `Selected ${isNode ? 'node' : 'line'} ${name}: pick a colour${isNode ? ', or drag it to record a move' : ''}.`
      : 'Click a node or line on the canvas, then pick a colour. Drag a node to record a move.';
    for (const b of $('palette').children) b.disabled = !obj;
  },
  onRename: () => { labelInput.focus(); labelInput.select(); },
  onRecordMove: (id, x, y) => addStep({ op: 'move', target: id, x, y }),
});
labelInput.addEventListener('input', () => editor.setLabel(labelInput.value));
$('delete').addEventListener('click', () => editor.deleteSelected());

function loadStage(text) {
  try {
    editor.setScene(runProgram(fengari, { stage: text }).scene);
    showError(null);
  } catch (e) {
    showError(e.message);
  }
}

const saveStage = () => download(new Blob([toStageLua(editor.scene)], { type: 'text/plain' }), 'stage.lua');
$('save').addEventListener('click', saveStage);
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (f) loadStage(await f.text());
  $('file').value = '';
});
$('clear').addEventListener('click', () => loadStage(''));

window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveStage(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); $('file').click(); }
  else if (!typing && tab === 'stage' && (e.key === 'Delete' || e.key === 'Backspace')) editor.deleteSelected();
  else if (!typing && e.key === 'Escape') editor.select(null);
});

// ---------- 2. Behaviour: steps ----------
for (const c of PALETTE) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'swatch';
  b.title = c;
  b.style.background = paint(c);
  b.disabled = true;
  b.addEventListener('click', () => { if (editor.selected) addStep({ op: 'color', target: editor.selected, color: c }); });
  $('palette').append(b);
}

function stepDur() {
  const v = Number($('dur').value);
  return Math.round(Math.min(10, Math.max(0, Number.isFinite(v) ? v : 0.5)) * 1000);
}

function addStep(step) {
  steps.push({ dur: stepDur(), together: false, ...step });
  stepsChanged();
}
$('pause').addEventListener('click', () => addStep({ op: 'wait' }));
$('clear-steps').addEventListener('click', () => { steps = []; stepsChanged(); });

function stepsChanged() {
  renderSteps();
  if (tab === 'behaviour') editor.setView(behaviourView());
}

// The stage as it looks after all steps (what the teacher is building on).
function behaviourView() {
  try {
    const result = runProgram(fengari, { stage: toStageLua(editor.scene), steps: stepsToLua(steps, editor.scene) });
    showError(null);
    return toEditorIds(sceneAt(result.timeline, result.timeline.durationMs), result, editor.scene);
  } catch (e) {
    showError(e.message);
    return null;
  }
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function describe(s) {
  const what = el('span', 'what');
  if (s.op === 'wait') { what.append(el('b', null, 'Pause')); return what; }
  what.append(el('b', null, editor.scene.nameOf(s.target)), ' ');
  if (s.op === 'color') {
    const sw = el('i', 'dot');
    sw.style.background = paint(s.color);
    what.append('colour → ', sw, ` ${s.color}`);
  } else {
    what.append(`move → (${s.x}, ${s.y})`);
  }
  return what;
}

function renderSteps() {
  const list = $('steps');
  list.replaceChildren();
  steps.forEach((s, i) => {
    const li = el('li');
    const prev = steps[i - 1];
    li.append(el('span', 'num', String(i + 1)), describe(s));

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
    opts.append(durLabel);

    if (s.op !== 'wait' && prev && prev.op !== 'wait') {
      const when = el('select');
      when.setAttribute('aria-label', 'when');
      when.append(new Option('after previous', ''), new Option('with previous', '1'));
      when.value = s.together ? '1' : '';
      when.addEventListener('change', () => { s.together = when.value === '1'; stepsChanged(); });
      opts.append(when);
    }
    li.append(opts);
    if (s.together && prev && prev.op !== 'wait') li.classList.add('together');
    list.append(li);
  });
  $('steps-empty').hidden = steps.length > 0;
  $('steps-code').textContent = stepsToLua(steps, editor.scene) || '-- no steps yet';
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
$('clear-code').addEventListener('click', () => { scriptBox.value = ''; updateRunOrder(); });
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

// ---------- 3. Result: run, preview, downloads ----------
const player = { timeline: null, t: 0, playing: false, last: 0 };
let lastProgram = null;

function run() {
  try {
    lastProgram = program();
    const result = runProgram(fengari, lastProgram);
    showError(null);
    $('trace').textContent = formatTrace(result).join('\n');
    player.timeline = result.timeline;
    player.t = 0;
    $('scrub').max = result.timeline.durationMs;
    $('export-status').textContent = '';
    return true;
  } catch (e) {
    showError(e.message);
    return false;
  }
}

function drawPreview() {
  if (!player.timeline) return;
  const svg = renderSVG(sceneAt(player.timeline, player.t));
  $('preview').innerHTML = svg;
  if ($('svg-details').open) $('svg-code').textContent = svg;
  $('scrub').value = player.t;
  $('time').textContent = `${(player.t / 1000).toFixed(2)} / ${(player.timeline.durationMs / 1000).toFixed(2)} s`;
  $('play').textContent = player.playing ? 'Pause' : 'Play';
}

function tick(now) {
  if (!player.playing) return;
  player.t = Math.min(player.timeline.durationMs, player.t + (now - player.last));
  player.last = now;
  if (player.t >= player.timeline.durationMs) player.playing = false;
  drawPreview();
  if (player.playing) requestAnimationFrame(tick);
}

function play() {
  if (player.t >= player.timeline.durationMs) player.t = 0;
  player.playing = true;
  player.last = performance.now();
  requestAnimationFrame(tick);
}

$('play').addEventListener('click', () => { if (player.playing) player.playing = false; else play(); drawPreview(); });
$('scrub').addEventListener('input', () => { player.playing = false; player.t = Number($('scrub').value); drawPreview(); });
$('svg-details').addEventListener('toggle', drawPreview);

$('dl-frame').addEventListener('click', () => {
  const svg = renderSVG(sceneAt(player.timeline, player.t));
  download(new Blob([svg], { type: 'image/svg+xml' }), `frame_${Math.round(player.t)}ms.svg`);
});
$('dl-svg').addEventListener('click', () => {
  download(new Blob([renderAnimatedSVG(player.timeline)], { type: 'image/svg+xml' }), 'gepv1.svg');
});
$('dl-mp4').addEventListener('click', async () => {
  const status = $('export-status');
  $('dl-mp4').disabled = true;
  status.textContent = 'Rendering frames and encoding with ffmpeg…';
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(lastProgram),
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

// ---------- Tabs ----------
function showTab(next) {
  if (next === 'result' && !run()) return; // stay put and show the error
  if (tab === 'result') player.playing = false;
  tab = next;
  for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
  for (const p of document.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== tab;

  const editing = tab !== 'result';
  $('editor').hidden = !editing;
  $('preview').hidden = editing;
  $('player').hidden = editing;
  $('canvas-hint').textContent = HINTS[tab] ?? '';
  $('canvas-hint').hidden = !editing;

  if (editing) {
    editor.select(null);
    editor.setMode(tab, tab === 'behaviour' ? behaviourView() : null);
  } else {
    play();
    drawPreview();
  }
}

for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => showTab(b.dataset.tab));
for (const b of document.querySelectorAll('[data-goto]')) b.addEventListener('click', () => showTab(b.dataset.goto));
$('run').addEventListener('click', () => showTab('result'));

// ---------- Start with the DFS example ----------
const [stage, script] = await Promise.all(['stage.lua', 'dfs.lua'].map((f) => fetch(`/examples/${f}`).then((r) => r.text())));
loadStage(stage);
scriptBox.value = script;
updateRunOrder();
showTab('stage');
