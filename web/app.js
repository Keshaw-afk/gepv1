// Page wiring: editor (stage) -> script -> run (trace + preview) -> export video.

import { runProgram } from '../core/lua_api.js';
import { toStageLua } from '../core/stage_file.js';
import { sceneAt } from '../core/player.js';
import { renderSVG } from '../core/svg.js';
import { formatTrace } from '../core/trace.js';
import { Editor } from './editor.js';

const fengari = window.fengari;
const $ = (id) => document.getElementById(id);

// ---------- 1. Stage editor ----------
const labelInput = $('label');
const editor = new Editor($('editor'), {
  onChange: () => { $('stage-code').textContent = toStageLua(editor.scene); },
  onSelect: (obj) => {
    const isNode = obj?.kind === 'node';
    labelInput.disabled = !isNode;
    labelInput.value = isNode ? obj.label : '';
    $('delete').disabled = !obj;
    $('selection').textContent = !obj ? 'Nothing selected' : isNode ? 'Node' : `Edge ${editor.scene.nameOf(obj.id)}`;
  },
  onRename: () => { labelInput.focus(); labelInput.select(); },
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

function saveStage() {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([toStageLua(editor.scene)], { type: 'text/plain' }));
  a.download = 'stage.lua';
  a.click();
  URL.revokeObjectURL(a.href);
}

$('save').addEventListener('click', saveStage);
$('load').addEventListener('click', () => $('file').click());
$('file').addEventListener('change', async () => {
  const f = $('file').files[0];
  if (f) loadStage(await f.text());
  $('file').value = '';
});
$('clear').addEventListener('click', () => loadStage(''));

window.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); saveStage(); }
  else if ((e.ctrlKey || e.metaKey) && e.key === 'o') { e.preventDefault(); $('file').click(); }
  else if (!typing && (e.key === 'Delete' || e.key === 'Backspace')) editor.deleteSelected();
  else if (!typing && e.key === 'Escape') editor.select(null);
});

// ---------- 2. Script ----------
const scriptBox = $('script');
scriptBox.addEventListener('keydown', (e) => {
  if (e.key !== 'Tab') return;
  e.preventDefault();
  scriptBox.setRangeText('  ', scriptBox.selectionStart, scriptBox.selectionEnd, 'end');
});

// ---------- 3. Run: trace + preview ----------
const player = { timeline: null, t: 0, playing: false, last: 0 };

function showError(msg) {
  $('error').hidden = !msg;
  $('error').textContent = msg ?? '';
}

function drawPreview() {
  if (!player.timeline) return;
  $('preview').innerHTML = renderSVG(sceneAt(player.timeline, player.t));
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

function run() {
  try {
    const result = runProgram(fengari, { stage: toStageLua(editor.scene), script: scriptBox.value });
    showError(null);
    $('trace').textContent = formatTrace(result).join('\n');
    player.timeline = result.timeline;
    player.t = 0;
    $('scrub').max = result.timeline.durationMs;
    $('result').hidden = false;
    $('result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    play();
    drawPreview();
  } catch (e) {
    showError(e.message);
  }
}

$('run').addEventListener('click', run);
$('play').addEventListener('click', () => { if (player.playing) player.playing = false; else play(); drawPreview(); });
$('scrub').addEventListener('input', () => { player.playing = false; player.t = Number($('scrub').value); drawPreview(); });

// ---------- 4. Export video (server runs ffmpeg) ----------
$('export').addEventListener('click', async () => {
  const status = $('export-status');
  $('export').disabled = true;
  status.textContent = 'Rendering frames and encoding with ffmpeg…';
  try {
    const res = await fetch('/api/export', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stage: toStageLua(editor.scene), script: scriptBox.value }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
    const url = URL.createObjectURL(await res.blob());
    $('video').src = url;
    $('video').hidden = false;
    $('download').href = url;
    $('download').hidden = false;
    status.textContent = 'Done.';
  } catch (e) {
    status.textContent = `Export failed: ${e.message}`;
  } finally {
    $('export').disabled = false;
  }
});

// ---------- Start with the DFS example ----------
const [stage, script] = await Promise.all(['stage.lua', 'dfs.lua'].map((f) => fetch(`/examples/${f}`).then((r) => r.text())));
loadStage(stage);
scriptBox.value = script;
