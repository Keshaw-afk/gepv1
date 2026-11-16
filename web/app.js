// Page wiring: 1 Stage (editor) -> 2 Behaviour (steps + code) -> 3 Result (frames, moments, downloads).
// Everything the GUI makes is turned into Lua (stage.lua, steps.lua) and run by the same engine
// as hand-written code (script.lua).

import { runProgram } from '../core/lua_api.js';
import { toStageLua } from '../core/stage_file.js';
import { buildSteps, stepsToLua, pruneSteps, toEditorIds } from '../core/steps.js';
import { sceneAt, frameTimes } from '../core/player.js';
import { renderSVG, paint } from '../core/svg.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { formatTrace } from '../core/trace.js';
import { outputSettings } from '../core/output.js';
import { frameAt, landmarks, renderFrame, frameName } from '../core/frames.js';
import { Editor } from './editor.js';
import { CodeView } from './codeview.js';

const fengari = window.fengari;
const $ = (id) => document.getElementById(id);
const PALETTE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'black', 'lightgrey'];
const HINTS = {
  stage: 'Click empty space: add a node · Drag: move · Shift-drag or right-drag from node to node: connect · Double-click: rename · Delete key: remove',
  behaviour: 'Showing the picture after your steps. Click a node or line, then pick a colour · Drag a node to record a move',
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
const editor = new Editor($('editor'), {
  onChange: () => {
    stageView.set(toStageLua(editor.scene));
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

const saveStage = () => saveText(toStageLua(editor.scene), 'stage.lua');
$('save').addEventListener('click', saveStage);
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (f) loadStage(await f.text());
  $('file').value = '';
});
$('clear').addEventListener('click', () => loadStage(''));

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

/** "A colour → ● red" / "B move → (50, 60)" / "p1 appears", for the steps list and the moments list. */
function describeChange(name, c) {
  const what = el('span', 'what');
  what.append(el('b', null, name), ' ');
  if (c.op === 'color') {
    const sw = el('i', 'dot');
    sw.style.background = paint(c.color);
    what.append('colour → ', sw, ` ${c.color}`);
  } else if (c.op === 'move') {
    what.append(`move → (${Math.round(c.x)}, ${Math.round(c.y)})`);
  } else {
    what.append('appears');
  }
  return what;
}

function describe(s) {
  if (s.op === 'wait') { const w = el('span', 'what'); w.append(el('b', null, 'Pause')); return w; }
  return describeChange(editor.scene.nameOf(s.target), s);
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
  if (c.op === 'create') return { op: 'create' };
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
      changes.append(describeChange(player.result.scene.nameOf(c.id), changeOf(c)));
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
window.addEventListener('keydown', (e) => {
  const active = document.activeElement;
  const typing = active?.matches('textarea, select, input:not([type=range]):not([type=checkbox]):not([type=color])');
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveStage(); return; }
  if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); $('file').click(); return; }
  if (typing || e.ctrlKey || e.metaKey || e.altKey) return;
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
  if (tab === 'stage' && (e.key === 'Delete' || e.key === 'Backspace')) editor.deleteSelected();
  else if (e.key === 'Escape') editor.select(null);
});

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

  if (editing) {
    editor.select(null);
    editor.setMode(tab, tab === 'behaviour' ? behaviourView() : null);
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

// ---------- Start with the example graph, no steps and no code ----------
loadStage(await fetch('/examples/stage.lua').then((r) => r.text()));
updateRunOrder();
showTab('stage');
