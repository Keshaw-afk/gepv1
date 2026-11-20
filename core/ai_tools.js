// Tools an AI uses to build an animation (over MCP, or the in-app assistant), made for very small,
// cheap models that turn a user's step-by-step instructions into calls:
//
//   "draw a circle A at (100, 200), move it to (400, 200) in 10 seconds, then turn it red"
//     -> draw {shape: "circle", label: "A", x: 100, y: 200}
//        move {x: 400, y: 200, seconds: 10}
//        color {color: "red"}
//
// The design, so a weak model can't get it wrong:
//   - one tool per verb a person uses (draw, write, move, color, resize, connect, remove, wait), so
//     each instruction is one call, with arguments named after the words in it;
//   - no modes: actions happen one after another, in the order called. "At the same time" is
//     `together: true`. Whatever is drawn before anything happens is the starting picture;
//   - `seconds` sits on the action ("move it for 10 seconds");
//   - `label` can be left out: it means the last object used ("it"). Objects without a label are
//     "circle 1", "box 2"…; "the circle" works when there is only one;
//   - forgiving arguments (numbers as text, "square", "light grey", only x given, dx/dy), replies
//     that say what happened and when, errors that say how to fix the call, and undo.
//
// They write exactly what the GUI writes: the starting picture (Scene) and keyframe steps
// (core/steps.js). Each action that takes time is a keyframe; `together` joins the previous one.
// So everything an AI makes shows up in the steps list and can be edited by hand.
//
// Pointing at several objects: a label can be a set, "A, B and C", ["A", "B"], "all circles", "the red
// ones", "everything", "them" (the last ones used) or "selected"/"these" (what the user selected on
// the Stage). Every object in the set changes at the same time.
//
// A project is { scene, steps, last, selected, fresh, history }: last = ids "it"/"them" mean;
// selected = ids selected in the app; fresh = shapes the AI has drawn into the starting picture (a
// colour, size or removal for those just describes the picture; for anything that was already there
// it is something that happens); history = undo snapshots. Tools change the project in place (steps is replaced by a new array).

import { Scene, CANVAS } from './scene.js';
import { recordSteps, keyframes, nextStepId, INSTANT } from './steps.js';
import { parseColor } from './colors.js';
import { RADIUS, RECT, SIZE, FONT_SIZE, sizeOf, defaultColor } from './shapes.js';

export class ToolError extends Error {}

export function newProject(scene = new Scene(), steps = []) {
  return { scene, steps, last: [], selected: [], fresh: [], history: [] };
}

export const MAX_SECONDS = 60;
const DEFAULT_SECONDS = 1;

// ---------- names and what exists at the end ----------

const SHAPE_WORDS = {
  circle: 'circle', node: 'circle', dot: 'circle', ball: 'circle', point: 'circle',
  box: 'rect', rect: 'rect', rectangle: 'rect', square: 'rect',
  triangle: 'triangle', text: 'text', label: 'text', word: 'text',
};
const SHAPE_NAME = { circle: 'circle', rect: 'box', triangle: 'triangle', text: 'text' };
// natural sizes in pixels at size 1
const BASE = { circle: { w: 2 * RADIUS, h: 2 * RADIUS }, rect: { w: RECT.w, h: RECT.h }, triangle: { w: 56, h: 48 }, text: { w: FONT_SIZE, h: FONT_SIZE } };

export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'cyan', 'teal', 'brown',
  'black', 'white', 'grey', 'lightgrey', 'darkgrey'];

/** Every object that ever existed (removed ones too), in the order made, with its name. */
function everything(p) {
  const ever = new Map();
  for (const o of [...p.scene.nodes(), ...p.scene.edges()]) ever.set(o.id, { ...o });
  for (const s of p.steps) {
    if (s.op === 'add') ever.set(s.id, { id: s.id, kind: 'node', label: s.label, shape: s.shape });
    if (s.op === 'connect') ever.set(s.id, { id: s.id, kind: 'edge', a: s.a, b: s.b });
  }
  // an object without a label is "circle 1", "box 2"… counted per shape, removed ones too (stable)
  const count = {};
  for (const o of ever.values()) {
    if (o.kind !== 'node' || String(o.label ?? '').trim()) continue;
    const word = SHAPE_NAME[o.shape] ?? 'object';
    count[word] = (count[word] ?? 0) + 1;
    o.name = `${word} ${count[word]}`;
  }
  for (const o of ever.values()) if (o.kind === 'node' && !o.name) o.name = o.label;
  for (const o of ever.values()) if (o.kind === 'edge') o.name = `${ever.get(o.a)?.name}-${ever.get(o.b)?.name}`;
  return ever;
}

/** Every object alive after all the steps: id -> { id, kind, name, label, shape, x, y, size, color, a, b, fromStep }. */
export function endState(project) {
  const ever = everything(project);
  const objs = new Map();
  for (const o of project.scene.nodes()) objs.set(o.id, { ...o, name: ever.get(o.id).name });
  for (const o of project.scene.edges()) objs.set(o.id, { ...o, name: ever.get(o.id).name });
  for (const s of project.steps) {
    if (s.op === 'add') objs.set(s.id, { id: s.id, kind: 'node', name: ever.get(s.id).name, label: s.label, shape: s.shape, x: s.x, y: s.y, size: s.size ?? 1, color: defaultColor(s.shape), fromStep: true });
    else if (s.op === 'connect') objs.set(s.id, { id: s.id, kind: 'edge', name: ever.get(s.id).name, a: s.a, b: s.b, directed: !!s.directed, color: '#888888', fromStep: true });
    else if (s.op === 'remove') {
      objs.delete(s.target);
      for (const [id, o] of objs) if (o.kind === 'edge' && (o.a === s.target || o.b === s.target)) objs.delete(id);
    } else if (!objs.has(s.target)) continue;
    else if (s.op === 'move') Object.assign(objs.get(s.target), { x: s.x, y: s.y });
    else if (s.op === 'path') Object.assign(objs.get(s.target), s.points.at(-1));
    else if (s.op === 'size') objs.get(s.target).size = s.size;
    else if (s.op === 'color') objs.get(s.target).color = s.color;
  }
  return objs;
}

const IT = new Set(['it', 'this', 'that', 'him', 'her', 'last', 'the last one', 'same', 'the same', 'them', 'they', 'those ones', 'both']);
const SELECTED = new Set(['selected', 'selection', 'the selected', 'the selected ones', 'selected ones', 'these', 'those', 'this one', 'that one', 'these ones', 'chosen', 'highlighted']);
const ALL = new Set(['all', 'everything', 'every object', 'every shape', 'every thing', 'all objects', 'all shapes', 'all things', 'all of them', 'everyone']);
const lastOf = (p) => (Array.isArray(p.last) ? p.last : p.last == null ? [] : [p.last]);
const norm = (v) => String(v).trim().toLowerCase().replace(/[–—]/g, '-').replace(/''/g, '″').replace(/'/g, '′').replace(/\s+/g, ' ');

/**
 * The object called `label` at the end. Forgiving: case, ' for ′, "A-B" or "B-A" for a line,
 * "circle 1", "the circle" (when there is one), "it" or nothing (the last object used).
 */
export function find(project, label, { kind } = {}) {
  const objs = endState(project);
  const all = [...objs.values()].filter((o) => !kind || o.kind === kind);
  const nodes = () => [...objs.values()].filter((o) => o.kind === 'node').map((o) => o.name);
  let want = label === undefined || label === null ? '' : norm(label).replace(/^the /, '');
  if (want === '' || IT.has(want) || SELECTED.has(want)) {
    const ids = SELECTED.has(want) ? project.selected ?? [] : lastOf(project);
    const hits = ids.map((id) => objs.get(id)).filter((o) => o && (!kind || o.kind === kind));
    if (hits.length === 1) return { obj: hits[0], objs };
    if (hits.length > 1) throw new ToolError(`"${label || 'it'}" means ${hits.length} objects (${hits.map((o) => o.name).join(', ')}): say which one.`);
    if (SELECTED.has(want)) throw new ToolError('Nothing is selected on the Stage: select objects there first, or give labels.');
    throw new ToolError(nodes().length
      ? `Say which object: give its label. Objects: ${nodes().join(', ')}.`
      : 'There are no objects yet: draw one first.');
  }
  want = want.replace(/^(circle|box|square|rect|rectangle|triangle|text)\s*#?(\d+)$/, (_, s, n) => `${SHAPE_NAME[SHAPE_WORDS[s]]} ${n}`);
  const exact = String(label).trim();
  let hit = all.find((o) => o.name === exact) ?? all.find((o) => norm(o.name) === want)
    // a line can also be named the other way round: "B-A"
    ?? all.find((o) => o.kind === 'edge' && norm(`${objs.get(o.b)?.name}-${objs.get(o.a)?.name}`) === want);
  if (!hit) { // "circle", "line": fine when there is exactly one
    const shape = SHAPE_WORDS[want];
    const ofKind = want === 'line' || want === 'arrow' ? all.filter((o) => o.kind === 'edge')
      : shape ? all.filter((o) => o.kind === 'node' && o.shape === shape) : [];
    if (ofKind.length === 1) hit = ofKind[0];
    else if (ofKind.length > 1) throw new ToolError(`There are ${ofKind.length} of those (${ofKind.map((o) => o.name).join(', ')}): say which one.`);
  }
  if (!hit) {
    throw new ToolError(`No object called "${label}". ${nodes().length ? `Objects: ${nodes().join(', ')}.` : 'There are no objects yet: draw one first.'}`
      + (kind === 'edge' || /-/.test(want) ? ' A line is named "A-B" after the objects it joins.' : ''));
  }
  return { obj: hit, objs };
}

const PLURAL = { circles: 'circle', dots: 'circle', balls: 'circle', nodes: 'circle', boxes: 'rect', squares: 'rect', rects: 'rect', rectangles: 'rect', triangles: 'triangle', texts: 'text', words: 'text', labels: 'text' };

/**
 * The objects a label points at: one name, or a set ("A, B and C", a list, "all circles", "the red
 * ones", "everything", "them", "selected"). Nodes only unless `lines` is true.
 */
export function findMany(project, label, { lines = false } = {}) {
  const kind = lines ? undefined : 'node';
  if (Array.isArray(label)) {
    const out = label.flatMap((l) => findMany(project, l, { lines }));
    return [...new Map(out.map((o) => [o.id, o])).values()];
  }
  if (typeof label === 'string' && /^\s*\[/.test(label)) { try { return findMany(project, JSON.parse(label), { lines }); } catch { /* a plain name */ } }
  const objs = endState(project);
  const want = given(label) ? norm(label).replace(/^all (of )?(the )?/, 'all ').replace(/^the /, '') : '';
  const nodes = [...objs.values()].filter((o) => o.kind === 'node');
  if (IT.has(want) || SELECTED.has(want) || want === '') {
    const ids = SELECTED.has(want) ? project.selected ?? [] : lastOf(project);
    const hits = ids.map((id) => objs.get(id)).filter((o) => o && (!kind || o.kind === kind));
    if (hits.length) return hits;
    return [find(project, label, { kind }).obj]; // the helpful error
  }
  if (ALL.has(want)) {
    if (!nodes.length) throw new ToolError('There are no objects yet: draw one first.');
    return nodes;
  }
  try { return [find(project, label, { kind }).obj]; } catch (e) { if (!(e instanceof ToolError) || !e.message.startsWith('No object called')) throw e; }
  // "all circles", "red ones", "the blue boxes", "all red"
  const m = /^(?:all )?(?:the )?(?:([a-z#0-9]+) )?(circles|dots|balls|nodes|boxes|squares|rects|rectangles|triangles|texts|words|labels|ones|objects|shapes|things)$/.exec(want)
    ?? /^all ([a-z#0-9]+)$/.exec(want);
  if (m) {
    const shape = PLURAL[m[2]] ?? (m[2] === undefined && PLURAL[m[1]]);
    const col = m[2] === undefined && PLURAL[m[1]] ? undefined : m[1] && parseColor(m[1].replace('gray', 'grey'));
    if (m[1] && !col && !shape) throw new ToolError(`Unknown colour "${m[1]}" in "${label}".`);
    const hits = nodes.filter((o) => (!shape || o.shape === shape) && (!col || sameColor(o.color, m[1])));
    if (hits.length) return hits;
    throw new ToolError(`No objects match "${label}". Objects: ${nodes.map((o) => `${o.name} (${o.color})`).join(', ') || 'none'}.`);
  }
  // "A, B and C"
  const parts = String(label).split(/\s*(?:,|;|&|\band\b|\+)\s*/i).map((s) => s.trim()).filter(Boolean);
  if (parts.length > 1) return findMany(project, parts, { lines });
  return [find(project, label, { kind }).obj]; // throws the helpful error
}

const sameColor = (a, b) => {
  const x = parseColor(String(a).replace('gray', 'grey')), y = parseColor(String(b).replace('gray', 'grey'));
  return !!x && !!y && JSON.stringify(x) === JSON.stringify(y);
};
const names = (list) => (list.length === 1 ? list[0].name : `${list.slice(0, -1).map((o) => o.name).join(', ')} and ${list.at(-1).name}`);

// ---------- argument helpers: forgiving about types, clear when something is wrong ----------

const given = (v) => v !== undefined && v !== null && String(v).trim() !== '';
const yes = (v) => v === true || /^(true|yes|1)$/i.test(String(v ?? '').trim());

function num(v, what, lo, hi, fallback) {
  if (!given(v)) {
    if (fallback !== undefined) return fallback;
    throw new ToolError(`${what} is missing: give a number between ${lo} and ${hi}.`);
  }
  const n = Number(String(v).replace(/px$/i, ''));
  if (!Number.isFinite(n)) throw new ToolError(`${what} must be a number between ${lo} and ${hi}, not "${v}".`);
  if (n < lo || n > hi) throw new ToolError(`${what} must be between ${lo} and ${hi} (the canvas is ${CANVAS.width}×${CANVAS.height}, (0, 0) is the top left); got ${n}.`);
  return Math.round(n);
}

/** Seconds, 0.1 to 60, rounded to 0.1; undefined when not given. */
function secondsOf(v, fallback) {
  if (!given(v)) return fallback;
  const n = Number(String(v).replace(/\s*(s|sec|secs|seconds?)$/i, ''));
  if (!Number.isFinite(n) || n < 0.1 || n > MAX_SECONDS) throw new ToolError(`seconds must be a number from 0.1 to ${MAX_SECONDS}, not "${v}".`);
  return Math.round(n * 10) / 10;
}
const X = (v, fb) => num(v, 'x', 0, CANVAS.width, fb);
const Y = (v, fb) => num(v, 'y', 0, CANVAS.height, fb);

function colour(v) {
  if (!given(v)) return undefined;
  const c = String(v).trim().toLowerCase().replace(/[\s_-]+/g, '').replace('gray', 'grey');
  if (!parseColor(c)) throw new ToolError(`Unknown colour "${v}". Use a colour name like ${COLORS.slice(0, 8).join(', ')}, or a hex colour like #ff8800.`);
  return c;
}

function shapeOf(v) {
  const s = SHAPE_WORDS[String(v ?? 'circle').trim().toLowerCase()];
  if (!s) throw new ToolError(`Unknown shape "${v}". Use circle, box, triangle or text.`);
  return s;
}

const clampSize = (v) => Math.round(Math.min(SIZE.max, Math.max(SIZE.min, v)) * 100) / 100;
const packSize = (z) => (z.w === z.h ? z.w : z);

/**
 * The engine's size {w, h} (1 = natural) from what the AI said: size (px, the width, or the font
 * size for text), width/height (px), or scale (times the current size). undefined when none given.
 */
function sizeFrom(shape, a, current = 1) {
  const now = sizeOf(current), base = BASE[shape];
  if (given(a.scale)) {
    const k = Number(a.scale);
    if (!Number.isFinite(k) || k <= 0) throw new ToolError('scale must be a number above 0, e.g. 2 for twice as big.');
    return packSize({ w: clampSize(now.w * k), h: clampSize(now.h * k) });
  }
  let width = a.width, height = a.height;
  // in pixels from the instruction's words (core/instructions.js): "radius 60", "100 pixels wider",
  // "increase its radius by 50" (add_size: the width/diameter grows, proportions kept)
  if (given(a.radius) && !given(a.size)) a = { ...a, size: num(a.radius, 'radius', 3, 180) * 2 };
  const nowW = now.w * base.w, nowH = now.h * base.h;
  if (given(a.add_size)) { width = nowW + Number(a.add_size); height = (nowH * width) / nowW; }
  if (given(a.add_width)) { width = nowW + Number(a.add_width); height ??= nowH; }
  if (given(a.add_height)) { height = nowH + Number(a.add_height); width ??= nowW; }
  if (given(a.size) && !given(width) && !given(height)) {
    if (shape === 'text' || shape === 'circle') { // one number: the font size, or the diameter
      const k = num(a.size, 'size', 5, 360) / (shape === 'text' ? FONT_SIZE : base.w);
      return packSize({ w: clampSize(k), h: clampSize(k) });
    }
    width = a.size;
  }
  if (!given(width) && !given(height)) return undefined;
  const w = given(width) ? num(width, 'width', 5, 640) / base.w : null;
  const h = given(height) ? num(height, 'height', 5, 360) / base.h : null;
  // one of them given: keep the shape's proportions
  return packSize({ w: clampSize(w ?? (h * now.w) / now.h), h: clampSize(h ?? (w * now.h) / now.w) });
}

const pixels = (shape, size) => { const z = sizeOf(size), b = BASE[shape] ?? BASE.circle; return `${Math.round(b.w * z.w)}×${Math.round(b.h * z.h)}`; };

/** The first free spot on a grid, away from everything already there. */
function freeSpot(objs) {
  const nodes = [...objs.values()].filter((o) => o.kind === 'node');
  for (let y = 60; y <= 300; y += 80) {
    for (let x = 80; x <= 560; x += 80) {
      if (nodes.every((n) => Math.hypot(n.x - x, n.y - y) >= 70)) return { x, y };
    }
  }
  return { x: CANVAS.width / 2, y: CANVAS.height / 2 };
}

function uniqueLabel(objs, label) {
  const taken = new Set([...objs.values()].filter((o) => o.kind === 'node').map((o) => o.label.toLowerCase()));
  if (!taken.has(label.toLowerCase())) return label;
  // a prime, not a number: a second "3" in an array must not read as "32"
  for (const mark of ['′', '″', '‴']) if (!taken.has(`${label}${mark}`.toLowerCase())) return `${label}${mark}`;
  let k = 4;
  while (taken.has(`${label}(${k})`.toLowerCase())) k++;
  return `${label}(${k})`;
}

/** Points through which a move bends by `arc` px: positive upwards, negative downwards. */
function arcPoints(from, to, arc, n = 5) {
  const dx = to.x - from.x, dy = to.y - from.y, len = Math.hypot(dx, dy) || 1;
  let nx = dy / len, ny = -dx / len;
  if (ny > 0 || (ny === 0 && nx > 0)) { nx = -nx; ny = -ny; } // the normal that points up (or left)
  return Array.from({ length: n }, (_, k) => {
    const t = (k + 1) / (n + 1), h = 4 * t * (1 - t) * arc;
    return { x: Math.round(from.x + dx * t + nx * h), y: Math.round(from.y + dy * t + ny * h) };
  });
}

// ---------- the timeline: one action after another ----------

/** Start and end (seconds) of each keyframe. */
function spans(steps) {
  let t = 0;
  return keyframes(steps).map((f) => {
    const timed = steps.slice(f.start, f.end).filter((s) => !INSTANT.has(s.op));
    const len = timed.length ? Math.max(...timed.map((s) => s.dur ?? 0)) / 1000 : 0;
    const span = { ...f, from: t, to: t + len };
    t += len;
    return span;
  });
}
const sec = (v) => `${Math.round(v * 10) / 10}`;
const when = (p) => {
  const s = spans(p.steps).at(-1);
  if (!s) return 'in the starting picture';
  // a code keyframe's length is known only when it runs: say what it comes after, not a time
  const code = p.steps.slice(0, s.start).findLastIndex((x) => x.op === 'code');
  if (code >= 0) {
    const k = keyframes(p.steps).filter((f) => f.start <= code && p.steps[f.start].op !== 'wait').length;
    const len = s.to - s.from, gap = s.from - spans(p.steps).find((f) => f.start === code).to;
    return `${gap > 0 ? `${sec(gap)} s ` : ''}after code keyframe ${k}${len > 0 ? `, for ${sec(len)} s` : ''}`;
  }
  return s.to > s.from ? `from ${sec(s.from)} to ${sec(s.to)} s` : `at ${sec(s.from)} s`;
};
const total = (p) => spans(p.steps).at(-1)?.to ?? 0;

/**
 * Records changes. An action that takes time starts after everything before it, unless together;
 * an instant one (appear, connect, disappear) joins a run of instant ones, or the previous action
 * when together.
 */
function record(p, changes, { together, seconds } = {}) {
  const takesTime = changes.some((c) => !INSTANT.has(c.op) && c.dur !== 0);
  const lastFrame = keyframes(p.steps).at(-1);
  const lastGroup = lastFrame ? p.steps.slice(lastFrame.start, lastFrame.end) : [];
  const onlyInstant = lastGroup.length && lastGroup.every((s) => INSTANT.has(s.op) || s.dur === 0);
  const join = yes(together) || (!takesTime && onlyInstant);
  const dur = seconds === undefined ? undefined : Math.round(seconds * 1000);
  const withDur = changes.map((c) => (dur !== undefined && !INSTANT.has(c.op) && c.dur === undefined ? { ...c, dur } : c));
  p.steps = recordSteps(p.steps, p.steps.length, withDur, { join, dur: DEFAULT_SECONDS * 1000 }).steps;
}

const starting = (p) => p.steps.length === 0; // nothing has happened yet: drawing builds the starting picture
/** Changing these objects only describes the starting picture: nothing has happened yet and the AI just drew them. */
const describing = (p, objs) => starting(p) && objs.every((o) => (p.fresh ?? []).includes(o.id));

// ---------- the tools ----------

const CYCLE = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'cyan']; // "different colours"

const S = (description) => ({ type: 'string', description });
const N = (description) => ({ type: 'number', description });
const LABEL = S('which object, e.g. "A"; or several: "A, B", "all circles", "the red ones", "everything", "selected" (what the user selected). Leave it out to mean the last one ("it", "them")');
const SECONDS = N(`how long it takes, 0.1 to ${MAX_SECONDS} seconds (default ${DEFAULT_SECONDS})`);
const TOGETHER = { type: 'boolean', description: 'only when the user says "at the same time", "while" or "meanwhile": true. Otherwise leave it out (it happens after the previous action)' };

function drawTool(p, a, shapeWord) {
  const shape = shapeOf(shapeWord);
  const objs = endState(p);
  const wanted = given(a.label) ? String(a.label).trim() : '';
  const same = wanted && [...objs.values()].find((o) => o.kind === 'node' && o.label.toLowerCase() === wanted.toLowerCase());
  if (same && !yes(a.duplicate)) {
    throw new ToolError(`There is already an object called ${same.name}. To change it, use move, color or resize with label "${same.name}"; to draw another one, use a different label.`);
  }
  const label = wanted ? uniqueLabel(objs, wanted) : '';
  const spot = freeSpot(objs);
  const x = X(a.x, given(a.y) ? CANVAS.width / 2 : spot.x), y = Y(a.y, given(a.x) ? CANVAS.height / 2 : spot.y);
  const color = colour(a.color);
  const size = sizeFrom(shape, a);
  let id;
  if (starting(p)) {
    id = p.scene.addNode(label, x, y, shape, size ?? 1);
    if (color) p.scene.get(id).color = color;
    (p.fresh ??= []).push(id);
  } else {
    id = nextStepId(p.steps);
    const changes = [{ op: 'add', id, shape, label, x, y, ...(size && { size }) }];
    if (color) changes.push({ op: 'color', target: id, color, dur: 0 });
    record(p, changes, { together: a.together });
  }
  p.last = [id];
  const name = endState(p).get(id).name;
  const what = shape === 'text' ? `text "${label}"` : `${color ? `${color} ` : ''}${label ? `${SHAPE_NAME[shape]} ${name}` : name}`;
  const called = !label && shape !== 'text' ? '' : label !== wanted ? ` ("${wanted}" was taken, so it is called ${label})` : '';
  return `Drew ${what}${called} at (${x}, ${y}) ${when(p)}.`;
}

export const TOOLS = [
  {
    name: 'draw',
    description: `Draws a shape at (x, y). The canvas is ${CANVAS.width}×${CANVAS.height}, (0, 0) is the top left. Shapes drawn before anything moves are the starting picture; later ones appear after the previous action. Example: draw a blue circle A at (100, 200) = {"shape": "circle", "label": "A", "x": 100, "y": 200, "color": "blue"}`,
    params: {
      shape: S('circle, box, triangle or text'),
      label: S('optional name written on it, e.g. "A"; use it to refer to the shape later'),
      x: N(`0 to ${CANVAS.width} (optional: a free spot)`),
      y: N(`0 to ${CANVAS.height} (optional)`),
      color: S('optional colour, e.g. red'),
      size: N('optional size in pixels (circle 48, box 64 wide, triangle 56 wide)'),
      width: N('optional width in pixels'),
      height: N('optional height in pixels'),
      together: TOGETHER,
    },
    required: ['shape'],
    run: (p, a) => drawTool(p, a, a.shape),
  },
  {
    name: 'write',
    description: 'Writes text at (x, y), e.g. a title or a note. Example: write "Bubble sort" at (320, 40) = {"text": "Bubble sort", "x": 320, "y": 40}',
    params: {
      text: S('the words'),
      x: N(`0 to ${CANVAS.width} (optional)`),
      y: N(`0 to ${CANVAS.height} (optional)`),
      color: S('optional colour'),
      size: N(`optional font size in pixels (default ${FONT_SIZE})`),
      together: TOGETHER,
    },
    required: ['text'],
    run: (p, a) => drawTool(p, { ...a, label: a.text, duplicate: true }, 'text'),
  },
  {
    name: 'move',
    description: 'Moves an object to (x, y), or by a distance (right, left, up, down), over `seconds`. Examples: move A to (400, 200) in 3 seconds = {"label": "A", "x": 400, "y": 200, "seconds": 3}; move it up by 50 = {"up": 50}; move it right by 100 in an arc = {"right": 100, "arc": true}',
    params: {
      label: LABEL,
      x: N(`move TO this x, 0 to ${CANVAS.width}`),
      y: N(`move TO this y, 0 to ${CANVAS.height}`),
      right: N('or: move right BY this many pixels'),
      left: N('or: move left by this many pixels'),
      up: N('or: move up by this many pixels'),
      down: N('or: move down by this many pixels'),
      seconds: SECONDS,
      arc: { type: 'boolean', description: 'true for "in an arc" or "curved" (or a number: how many pixels it bends, negative bends down)' },
      together: TOGETHER,
    },
    run(p, a) {
      const objs = findMany(p, a.label);
      const by = (k) => (given(a[k]) ? Math.abs(num(a[k], k, -CANVAS.width, CANVAS.width)) : 0);
      const relative = ['right', 'left', 'up', 'down', 'dx', 'dy'].some((k) => given(a[k]));
      if (!relative && !given(a.x) && !given(a.y)) throw new ToolError('Say where to: x and y, or how far: right, left, up or down, e.g. {"up": 50}.');
      // several objects keep their arrangement: their middle goes to (x, y)
      const mid = { x: Math.round(objs.reduce((t, o) => t + o.x, 0) / objs.length), y: Math.round(objs.reduce((t, o) => t + o.y, 0) / objs.length) };
      const ddx = relative ? by('right') - by('left') + (given(a.dx) ? num(a.dx, 'dx', -CANVAS.width, CANVAS.width) : 0) : X(a.x, mid.x) - mid.x;
      const ddy = relative ? by('down') - by('up') + (given(a.dy) ? num(a.dy, 'dy', -CANVAS.height, CANVAS.height) : 0) : Y(a.y, mid.y) - mid.y;
      let via = a.via ?? [];
      if (typeof via === 'string') { try { via = JSON.parse(via); } catch { throw new ToolError('via must be a list of [x, y] points, e.g. [[250, 80], [300, 60]].'); } }
      if (!Array.isArray(via)) throw new ToolError('via must be a list of [x, y] points, e.g. [[250, 80]].');
      const viaPts = via.map((pt, i) => {
        const [px, py] = Array.isArray(pt) ? pt : [pt?.x, pt?.y];
        return { x: num(px, `via point ${i + 1} x`, 0, CANVAS.width), y: num(py, `via point ${i + 1} y`, 0, CANVAS.height) };
      });
      const bend = yes(a.arc) && !/^1$/.test(String(a.arc)) ? 60 : given(a.arc) && !/^(false|no)$/i.test(String(a.arc)) ? num(a.arc, 'arc', -CANVAS.height, CANVAS.height) : 0;
      if (!ddx && !ddy && !viaPts.length) {
        throw new ToolError(`${names(objs)} ${objs.length > 1 ? 'are' : 'is'} already there${objs.length === 1 ? ` (${objs[0].x}, ${objs[0].y})` : ''}. x and y say where TO; to move by a distance use right, left, up or down, e.g. move it up by 50 = {"up": 50}.`);
      }
      const inside = (q) => ({ x: Math.min(CANVAS.width, Math.max(0, q.x)), y: Math.min(CANVAS.height, Math.max(0, q.y)) });
      const changes = objs.map((o) => {
        const to = { x: Math.round(o.x + ddx), y: Math.round(o.y + ddy) };
        if (to.x < 0 || to.x > CANVAS.width || to.y < 0 || to.y > CANVAS.height) {
          throw new ToolError(`That would take ${o.name} to (${to.x}, ${to.y}), off the canvas (${CANVAS.width}×${CANVAS.height}, (0, 0) is the top left).`);
        }
        // via points are for one object; the others follow the same shape of path
        const pts = viaPts.length ? viaPts.map((q) => inside({ x: q.x + o.x - objs[0].x, y: q.y + o.y - objs[0].y })) : bend ? arcPoints(o, to, bend).map(inside) : [];
        return pts.length ? { op: 'path', target: o.id, points: [...pts, to] } : { op: 'move', target: o.id, x: to.x, y: to.y };
      });
      record(p, changes, { together: a.together, seconds: secondsOf(a.seconds) });
      p.last = objs.map((o) => o.id);
      const curve = changes.some((c) => c.op === 'path') ? 'along a curve ' : '';
      if (objs.length === 1) {
        const o = objs[0], c = changes[0], e = c.op === 'path' ? c.points.at(-1) : c;
        return `${o.name} moves ${curve}from (${Math.round(o.x)}, ${Math.round(o.y)}) to (${e.x}, ${e.y}) ${when(p)}.`;
      }
      return `${names(objs)} move ${curve}by (${ddx}, ${ddy}) together ${when(p)}.`;
    },
  },
  {
    name: 'color',
    description: 'Changes the colour of an object (or of a line "A-B"). Example: turn B red = {"label": "B", "color": "red"}',
    params: {
      label: LABEL,
      color: S('the new colour, e.g. red, blue, lightgrey or #ff8800; "different" for a new colour each time'),
      times: N('optional: how many colour changes, one after another, e.g. 6'),
      seconds: SECONDS,
      together: TOGETHER,
    },
    required: ['color'],
    run(p, a) {
      const objs = findMany(p, a.label, { lines: true });
      const seconds = secondsOf(a.seconds);
      const varied = /^(different|random|various|other|new|rainbow|many|several)( colou?rs?)?$/i.test(String(a.color ?? '').trim());
      const times = given(a.times) ? Math.round(num(a.times, 'times', 1, 50)) : varied ? 6 : 1;
      if (times > 1 || varied) {
        // one change after another: a new colour each time ("different colours"), or the colour and back
        const start = objs[0].color ?? '#cccccc';
        const one = varied ? null : colour(a.color);
        const others = CYCLE.filter((c) => colour(c) !== colour(start));
        const seq = Array.from({ length: times }, (_, i) => (one ? (i % 2 === 0 ? one : start) : others[i % others.length]));
        seq.forEach((c, i) => record(p, objs.map((o) => ({ op: 'color', target: o.id, color: colour(c) })), { together: i === 0 && a.together, seconds }));
        p.last = objs.map((o) => o.id);
        return `${names(objs)} turn${objs.length > 1 ? '' : 's'} ${seq.join(', ')} in turn (${seconds ?? DEFAULT_SECONDS} s each); the last change is ${when(p)}.`;
      }
      const color = colour(a.color);
      p.last = objs.map((o) => o.id);
      if (describing(p, objs.map((o) => (o.kind === 'edge' ? { id: o.a } : o))) && seconds === undefined) {
        for (const o of objs) p.scene.get(o.id).color = color;
        return `${names(objs)} ${objs.length > 1 ? 'are' : 'is'} ${color} in the starting picture.`;
      }
      record(p, objs.map((o) => ({ op: 'color', target: o.id, color })), { together: a.together, seconds });
      return `${names(objs)} turn${objs.length > 1 ? '' : 's'} ${color} ${when(p)}.`;
    },
  },
  {
    name: 'resize',
    description: 'Changes the size of an object: scale (2 = twice as big, 0.5 = half), or size/width/height in pixels. Example: make A twice as big in 2 seconds = {"label": "A", "scale": 2, "seconds": 2}',
    params: {
      label: LABEL,
      scale: N('times the current size, e.g. 2 or 0.5'),
      size: N('or: the new size in pixels'),
      width: N('or: the new width in pixels'),
      height: N('or: the new height in pixels'),
      seconds: SECONDS,
      together: TOGETHER,
    },
    run(p, a) {
      const objs = findMany(p, a.label);
      const sizes = objs.map((o) => sizeFrom(o.shape, a, o.size));
      if (sizes[0] === undefined) throw new ToolError('Say how big: scale (e.g. 2), or size, width or height in pixels.');
      const seconds = secondsOf(a.seconds);
      p.last = objs.map((o) => o.id);
      const said = objs.map((o, i) => `${o.name} ${pixels(o.shape, sizes[i])} px`).join(', ');
      if (describing(p, objs) && seconds === undefined) {
        objs.forEach((o, i) => { p.scene.get(o.id).size = sizes[i]; });
        return `In the starting picture: ${said}.`;
      }
      record(p, objs.map((o, i) => ({ op: 'size', target: o.id, size: sizes[i] })), { together: a.together, seconds });
      return `Resizes ${when(p)}: ${said}.`;
    },
  },
  {
    name: 'connect',
    description: 'Draws a line (or an arrow, from → to) between two objects. Lines follow the objects when they move. Example: {"from": "A", "to": "B", "arrow": true}',
    params: {
      from: S('label of the first object'),
      to: S('label of the second object'),
      arrow: { type: 'boolean', description: 'true for an arrow pointing at "to" (default: a plain line)' },
      color: S('optional colour of the line'),
      together: TOGETHER,
    },
    required: ['from', 'to'],
    run(p, a) {
      const A = find(p, a.from, { kind: 'node' }).obj, B = find(p, a.to, { kind: 'node' }).obj;
      if (A.id === B.id) throw new ToolError('from and to must be two different objects.');
      const objs = endState(p);
      if ([...objs.values()].some((o) => o.kind === 'edge' && ((o.a === A.id && o.b === B.id) || (o.a === B.id && o.b === A.id)))) {
        throw new ToolError(`${A.name} and ${B.name} are already connected (the line is called "${A.name}-${B.name}").`);
      }
      const directed = yes(a.arrow);
      const color = colour(a.color);
      if (starting(p) && !A.fromStep && !B.fromStep) {
        const id = p.scene.addEdge(A.id, B.id, directed);
        if (color) p.scene.get(id).color = color;
      } else {
        const id = nextStepId(p.steps);
        record(p, [{ op: 'connect', id, a: A.id, b: B.id, directed }, ...(color ? [{ op: 'color', target: id, color, dur: 0 }] : [])], { together: a.together });
      }
      return `Connected ${A.name} ${directed ? '→' : '–'} ${B.name} (the line is called "${A.name}-${B.name}") ${when(p)}.`;
    },
  },
  {
    name: 'remove',
    description: 'Removes an object: hide, delete, erase, make it disappear (its lines go with it). Example: hide it = {}; delete B = {"label": "B"}',
    params: { label: S('which object, or several, as for move (a line is "A-B")'), together: TOGETHER },
    run(p, a) {
      const objs = findMany(p, a.label, { lines: true });
      const gone = new Set(objs.map((o) => o.id));
      p.last = lastOf(p).filter((id) => !gone.has(id));
      if (describing(p, objs.map((o) => (o.kind === 'edge' ? { id: o.a } : o)))) {
        for (const o of objs) if (p.scene.get(o.id)) p.scene.remove(o.id);
        return `Deleted ${names(objs)}.`;
      }
      // a line whose end also goes needs no step of its own
      const steps = objs.filter((o) => o.kind !== 'edge' || (!gone.has(o.a) && !gone.has(o.b)));
      record(p, steps.map((o) => ({ op: 'remove', target: o.id })), { together: a.together });
      return `${names(objs)} disappear${objs.length > 1 ? '' : 's'} ${when(p)}.`;
    },
  },
  {
    name: 'rename',
    description: 'Changes the label written on an object (for the whole animation). Example: {"label": "A", "text": "root"}',
    params: { label: LABEL, text: S('the new label') },
    required: ['text'],
    run(p, a) {
      const { obj } = find(p, a.label, { kind: 'node' });
      const text = String(a.text).trim();
      const add = p.steps.find((s) => s.op === 'add' && s.id === obj.id);
      if (add) add.label = text; else p.scene.get(obj.id).label = text;
      p.last = [obj.id];
      return `${obj.name} is now called ${text}.`;
    },
  },
  {
    name: 'wait',
    description: 'Waits: nothing changes for a while. Example: wait 2 seconds = {"seconds": 2}',
    params: { seconds: N(`how long, 0.1 to ${MAX_SECONDS}`) },
    required: ['seconds'],
    run(p, a) {
      const seconds = secondsOf(a.seconds);
      p.steps = recordSteps(p.steps, p.steps.length, [{ op: 'wait', dur: Math.round(seconds * 1000) }]).steps;
      return `Waits ${seconds} s, ${when(p)}.`;
    },
  },
  {
    name: 'undo',
    description: 'Takes back the last action (call it again to take back more).',
    params: {},
    run(p) {
      const prev = p.history.pop();
      if (!prev) throw new ToolError('There is nothing to undo.');
      Object.assign(p, { scene: Scene.from(prev.scene), steps: prev.steps, last: prev.last, fresh: prev.fresh });
      return `Took back: ${prev.what}.`;
    },
  },
  {
    name: 'clear',
    description: 'Deletes everything: an empty canvas. Only when the user asks to start again.',
    params: {},
    run(p) {
      Object.assign(p, { scene: new Scene(), steps: [], last: [], fresh: [] });
      return `Empty canvas (${CANVAS.width}×${CANVAS.height}, (0, 0) is the top left).`;
    },
  },
  {
    name: 'show',
    description: 'Describes the animation so far: the starting picture, what happens when, and where everything ends up.',
    params: {},
    run(p) { return describeProject(p); },
  },
];

// ---------- describing ----------

function describeStep(s, ever) {
  const name = (id) => ever.get(id)?.name ?? String(id);
  switch (s.op) {
    case 'add': return `${name(s.id)} (${SHAPE_NAME[s.shape]}) appears at (${s.x}, ${s.y})`;
    case 'connect': return `${name(s.a)} ${s.directed ? '→' : '–'} ${name(s.b)} get connected`;
    case 'remove': return `${name(s.target)} disappears`;
    case 'move': return `${name(s.target)} moves to (${Math.round(s.x)}, ${Math.round(s.y)})`;
    case 'path': { const e = s.points.at(-1); return `${name(s.target)} moves along a curve to (${Math.round(e.x)}, ${Math.round(e.y)})`; }
    case 'color': return `${name(s.target)} turns ${s.color}`;
    case 'size': return `${name(s.target)} resizes`;
    default: return s.op;
  }
}

/** A plain-text summary an AI (or a person) can read. */
export function describeProject(p) {
  const ever = everything(p);
  const lines = [`Canvas ${CANVAS.width}×${CANVAS.height}, (0, 0) top left.`];
  const nodes = p.scene.nodes(), edges = p.scene.edges();
  lines.push(nodes.length
    ? `Starting picture: ${nodes.map((n) => `${String(n.label).trim() ? `${SHAPE_NAME[n.shape]} ` : ''}${ever.get(n.id).name} at (${n.x}, ${n.y})${n.color !== defaultColor(n.shape) ? ` ${n.color}` : ''}`).join('; ')}`
      + (edges.length ? `; lines ${edges.map((e) => ever.get(e.id).name).join(', ')}.` : '.')
    : 'Starting picture: empty.');
  for (const f of spans(p.steps)) {
    const group = p.steps.slice(f.start, f.end);
    const t = f.to > f.from ? `${sec(f.from)}–${sec(f.to)} s` : `${sec(f.from)} s`;
    if (group[0].op === 'wait') lines.push(`${t}: wait.`);
    else lines.push(`${t}: ${group.map((s) => describeStep(s, ever)).join('; ')}.`);
  }
  if (!p.steps.length) lines.push('Nothing happens yet.');
  const end = [...endState(p).values()].filter((o) => o.kind === 'node');
  if (end.length && p.steps.length) lines.push(`At the end (${sec(total(p))} s): ${end.map((o) => `${o.name} (${Math.round(o.x)}, ${Math.round(o.y)})`).join(', ')}.`);
  const it = lastOf(p).map((id) => endState(p).get(id)).filter(Boolean);
  if (it.length) lines.push(`"${it.length > 1 ? 'them' : 'it'}" is ${names(it)}.`);
  if (p.selected?.length) {
    const sel = p.selected.map((id) => endState(p).get(id)).filter(Boolean);
    if (sel.length) lines.push(`Selected on the Stage: ${names(sel)}.`);
  }
  return lines.join('\n');
}

/** The names of the objects that exist now. */
export const objectNames = (p) => [...endState(p).values()].filter((o) => o.kind === 'node').map((o) => o.name);

/** One short line of what exists now, for a small model working one instruction at a time. */
export function briefState(p) {
  const objs = endState(p);
  const nodes = [...objs.values()].filter((o) => o.kind === 'node');
  const parts = [nodes.length
    ? `Objects: ${nodes.map((o) => `${o.name} (${o.color !== defaultColor(o.shape) && !String(o.color).startsWith('#') ? `${o.color} ` : ''}${o.shape === 'rect' ? 'box' : o.shape} at ${Math.round(o.x)}, ${Math.round(o.y)})`).join('; ')}.`
    : 'No objects yet.'];
  const it = lastOf(p).map((id) => objs.get(id)).filter(Boolean);
  if (it.length) parts.push(`"${it.length > 1 ? 'them' : 'it'}" = ${names(it)}.`);
  const sel = (p.selected ?? []).map((id) => objs.get(id)).filter(Boolean);
  if (sel.length) parts.push(`Selected by the user ("these"): ${names(sel)}.`);
  return parts.join(' ');
}

// ---------- running ----------

const byName = new Map(TOOLS.map((t) => [t.name, t]));

// other words a model may use for a tool (not listed, so the list stays short)
const ALIASES = {
  add: 'draw', create: 'draw', place: 'draw', circle: 'draw', text: 'write', label: 'write',
  colour: 'color', recolor: 'color', recolour: 'color', paint: 'color', scale: 'resize', grow: 'resize',
  delete: 'remove', hide: 'remove', erase: 'remove', link: 'connect', line: 'connect', arrow: 'connect',
  pause: 'wait', sleep: 'wait', start_over: 'clear', reset: 'clear', describe: 'show', look: 'show',
};

/** Adds tools (plugins). Each is { name, description, params, required?, run(project, args) }. */
export function registerTools(list) {
  for (const t of list) { TOOLS.push(t); byName.set(t.name, t); }
}

const UNDOABLE = (name) => !['show', 'undo'].includes(name);
let depth = 0;

/** Runs one tool on the project. Returns its reply text; throws ToolError with a helpful message. */
export function runTool(project, name, args = {}) {
  const key = String(name ?? '').trim().toLowerCase();
  const tool = byName.get(key) ?? byName.get(ALIASES[key]);
  if (!tool) throw new ToolError(`There is no tool called "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}.`);
  if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { throw new ToolError(`The arguments for ${tool.name} must be a JSON object.`); } }
  args ??= {};
  if (key === 'line' || key === 'arrow') args = { arrow: key === 'arrow', ...args };
  if (key === 'circle') args = { shape: 'circle', ...args };
  for (const r of tool.required ?? []) {
    if (!given(args[r])) throw new ToolError(`${tool.name} needs "${r}": ${tool.params[r]?.description ?? ''}`);
  }
  project.history ??= [];
  // a plugin's own calls are part of it: one undo step for the whole call
  const before = depth === 0 && UNDOABLE(tool.name) && { scene: project.scene.toJSON(), steps: project.steps, last: lastOf(project), fresh: [...(project.fresh ?? [])], what: tool.name };
  depth++;
  let reply;
  try { reply = tool.run(project, args); } finally { depth--; }
  if (before) {
    project.history.push(before);
    if (project.history.length > 100) project.history.shift();
  }
  return reply;
}

/** JSON schema of a tool's arguments (for MCP and OpenAI function calling). */
export const schemaOf = (t) => ({ type: 'object', properties: t.params, ...(t.required?.length && { required: t.required }) });

/** How to use the tools: the whole manual for an AI. */
export const RECIPE = `You turn the user's instructions into tool calls that draw and animate shapes on a ${CANVAS.width}×${CANVAS.height} canvas: (0, 0) is the top left, x goes right, y goes down.
Rules:
- Do exactly what the user says, in the same order: one tool call per instruction. Add nothing else.
- Each action happens after the previous one ("then"). Only for "at the same time", "while" or "meanwhile", add "together": true.
- "by" means a distance: use right, left, up or down. "to" means a place: use x and y.
- "label" names the object to change: one ("A"), several ("A, B and C"), "all circles", "the red ones", "everything", or "selected" for what the user selected ("these", "this"). Leave it out to mean the last one ("it", "them").
- Never use clear unless the user asks to start again.
Examples:
"draw a red circle A at (100, 200)" -> draw {"shape": "circle", "label": "A", "x": 100, "y": 200, "color": "red"}
"move it to (400, 200) in 3 seconds" -> move {"x": 400, "y": 200, "seconds": 3}
"at the same time make B blue" -> color {"label": "B", "color": "blue", "together": true}
"move A up by 50 in an arc" -> move {"label": "A", "up": 50, "arc": true}
"make these green" -> color {"label": "selected", "color": "green"}
"move all the circles down by 100 in 2 seconds" -> move {"label": "all circles", "down": 100, "seconds": 2}
"connect A and B with an arrow" -> connect {"from": "A", "to": "B", "arrow": true}
"wait 1 second" -> wait {"seconds": 1}`;
