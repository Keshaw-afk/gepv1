// Tools an AI uses to build an animation (over MCP, or the in-app assistant). They are made for a
// simple AI: few tools, flat arguments, objects named by their labels, optional positions, short
// replies that say what changed and what to do next, and errors that say how to fix them.
//
// They write exactly what the GUI writes: the starting picture (Scene) and keyframe steps
// (core/steps.js), so everything an AI makes shows up in the steps list and can be edited by hand.
//
// A project is { scene, steps, cursor, seconds }:
//   cursor  'start' (building the starting picture) | 'new' (the next change begins a keyframe)
//           | 'in' (changes join the last keyframe)
//   seconds how long the keyframe being recorded lasts
// Tools change the project in place (steps is replaced by a new array).

import { Scene, CANVAS } from './scene.js';
import { recordSteps, keyframes, nextStepId, INSTANT } from './steps.js';
import { parseColor } from './colors.js';
import { RADIUS, RECT, SIZE, sizeOf, defaultColor } from './shapes.js';

export class ToolError extends Error {}

export function newProject(scene = new Scene(), steps = []) {
  return { scene, steps, cursor: steps.length ? 'in' : 'start', seconds: 1 };
}

// ---------- what exists at the end ----------

const SHAPE_WORDS = {
  circle: 'circle', node: 'circle', dot: 'circle', ball: 'circle',
  box: 'rect', rect: 'rect', rectangle: 'rect', square: 'rect',
  triangle: 'triangle', text: 'text', label: 'text',
};
const SHAPE_NAME = { circle: 'circle', rect: 'box', triangle: 'triangle', text: 'text' };
// natural sizes in pixels at size 1 (text scales its letters)
const BASE = { circle: { w: 2 * RADIUS, h: 2 * RADIUS }, rect: { w: RECT.w, h: RECT.h }, triangle: { w: 56, h: 48 }, text: { w: 40, h: 20 } };

export const COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'cyan', 'teal', 'brown',
  'black', 'white', 'grey', 'lightgrey', 'darkgrey'];

/** Every object alive after all the steps: id -> { id, kind, label, shape, x, y, size, color, a, b, fromStep }. */
export function endState(project) {
  const objs = new Map();
  for (const o of project.scene.nodes()) objs.set(o.id, { ...o });
  for (const o of project.scene.edges()) objs.set(o.id, { ...o });
  for (const s of project.steps) {
    if (s.op === 'add') objs.set(s.id, { id: s.id, kind: 'node', label: s.label, shape: s.shape, x: s.x, y: s.y, size: s.size ?? 1, color: defaultColor(s.shape), fromStep: true });
    else if (s.op === 'connect') objs.set(s.id, { id: s.id, kind: 'edge', a: s.a, b: s.b, directed: !!s.directed, color: '#888888', fromStep: true });
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

const nameOf = (objs, o) => (o.kind === 'node' ? o.label : `${objs.get(o.a)?.label}-${objs.get(o.b)?.label}`);

function find(project, label, { kind } = {}) {
  const objs = endState(project);
  if (label === undefined || label === null || String(label).trim() === '') throw new ToolError('Say which object: give its label, e.g. "A".');
  const want = String(label).trim().toLowerCase().replace(/[–—]/g, '-');
  const all = [...objs.values()].filter((o) => !kind || o.kind === kind);
  const hit = all.find((o) => nameOf(objs, o) === String(label).trim()) ?? all.find((o) => nameOf(objs, o).toLowerCase() === want)
    // a line can also be named the other way round: "B-A"
    ?? all.find((o) => o.kind === 'edge' && `${objs.get(o.b)?.label}-${objs.get(o.a)?.label}`.toLowerCase() === want);
  if (!hit) {
    const names = [...objs.values()].filter((o) => o.kind === 'node').map((o) => o.label);
    throw new ToolError(`No object called "${label}". ${names.length ? `Objects: ${names.join(', ')}.` : 'There are no objects yet: use add first.'}`
      + (kind === 'edge' || /-/.test(want) ? ' A line is named "A-B" after the objects it joins.' : ''));
  }
  return { obj: hit, objs };
}

// ---------- argument helpers: forgiving about types, clear when something is wrong ----------

function num(v, what, lo, hi, fallback) {
  if (v === undefined || v === null || v === '') {
    if (fallback !== undefined) return fallback;
    throw new ToolError(`${what} is missing: give a number between ${lo} and ${hi}.`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new ToolError(`${what} must be a number between ${lo} and ${hi}, not "${v}".`);
  if (n < lo || n > hi) throw new ToolError(`${what} must be between ${lo} and ${hi} (the canvas is ${CANVAS.width}×${CANVAS.height}, (0, 0) is the top left); got ${n}.`);
  return Math.round(n);
}
/** Seconds, 0.1 to 10, rounded to 0.1. */
function secondsOf(v, fallback) {
  if ((v === undefined || v === null || v === '') && fallback !== undefined) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0.1 || n > 10) throw new ToolError(`seconds must be a number from 0.1 to 10, not "${v}".`);
  return Math.round(n * 10) / 10;
}
const X = (v, fb) => num(v, 'x', 0, CANVAS.width, fb);
const Y = (v, fb) => num(v, 'y', 0, CANVAS.height, fb);

function colour(v) {
  if (v === undefined || v === null || v === '') return undefined;
  const c = String(v).trim().toLowerCase().replace(/[\s_-]+/g, '').replace('gray', 'grey');
  if (!parseColor(c)) throw new ToolError(`Unknown colour "${v}". Use one of: ${COLORS.join(', ')} (or a hex colour like #ff8800).`);
  return c;
}

function shapeOf(v) {
  const s = SHAPE_WORDS[String(v ?? 'circle').trim().toLowerCase()];
  if (!s) throw new ToolError(`Unknown shape "${v}". Use circle, box, triangle or text.`);
  return s;
}

/** width/height in pixels -> size {w, h} as the engine stores it (1 = natural size). */
function sizeFrom(shape, width, height, current = 1) {
  if ((width === undefined || width === '') && (height === undefined || height === '')) return undefined;
  const now = sizeOf(current), base = BASE[shape];
  const clamp = (v) => Math.round(Math.min(SIZE.max, Math.max(SIZE.min, v)) * 100) / 100;
  const w = width === undefined || width === '' ? null : num(width, 'width', 5, 640) / base.w;
  const h = height === undefined || height === '' ? null : num(height, 'height', 5, 360) / base.h;
  // one of them given: keep the shape's proportions
  const size = { w: clamp(w ?? (h * now.w) / now.h), h: clamp(h ?? (w * now.h) / now.w) };
  return size.w === size.h ? size.w : size;
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
  let k = 2;
  while (taken.has(`${label}${k}`.toLowerCase())) k++;
  return `${label}${k}`;
}

// ---------- recording ----------

const where = (p) => (p.cursor === 'start' ? 'the starting picture' : `keyframe ${countKeyframes(p.steps) + (p.cursor === 'new' ? 1 : 0)}`);
const countKeyframes = (steps) => keyframes(steps).filter((f) => steps[f.start].op !== 'wait').length;

/** Records changes into the current keyframe (or begins one). */
function record(p, changes) {
  const r = recordSteps(p.steps, p.steps.length, changes, { join: p.cursor !== 'new', dur: Math.round(p.seconds * 1000) });
  p.steps = r.steps;
  p.cursor = 'in';
}

const NEXT_AT_START = 'Next: add more objects, or next_keyframe to start animating.';
const NEXT_IN_FRAME = 'Next: more changes for this keyframe (they play together), or next_keyframe.';
const next = (p) => (p.cursor === 'start' ? NEXT_AT_START : NEXT_IN_FRAME);

// ---------- the tools ----------

const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const N = (description) => ({ type: 'number', description });

export const TOOLS = [
  {
    name: 'start_over',
    description: 'Clears everything: an empty canvas and no keyframes. Use it once at the beginning of a new animation.',
    params: {},
    run(p) {
      p.scene = new Scene();
      p.steps = [];
      p.cursor = 'start';
      p.seconds = 1;
      return `Empty canvas (${CANVAS.width}×${CANVAS.height}). ${NEXT_AT_START}`;
    },
  },
  {
    name: 'add',
    description: `Adds a shape with a label. Before the first next_keyframe it is part of the starting picture; after, it appears in the current keyframe. The canvas is ${CANVAS.width}×${CANVAS.height}, (0, 0) is the top left. Leave out x and y to put it in a free spot. Example: {"shape": "circle", "label": "A", "x": 100, "y": 180, "color": "blue"}`,
    params: {
      shape: S('circle, box, triangle or text', { enum: ['circle', 'box', 'triangle', 'text'] }),
      label: S('the name shown on it, and how you refer to it later, e.g. "A" or "5"'),
      x: N(`0 to ${CANVAS.width} (optional)`),
      y: N(`0 to ${CANVAS.height} (optional)`),
      color: S('optional colour', { enum: COLORS }),
      width: N('optional width in pixels (circle 48, box 64, triangle 56 by default)'),
      height: N('optional height in pixels (circle 48, box 40, triangle 48 by default)'),
    },
    required: ['shape', 'label'],
    run(p, a) {
      const shape = shapeOf(a.shape);
      if (a.label === undefined || String(a.label).trim() === '') throw new ToolError('add needs a label, e.g. "A".');
      const objs = endState(p);
      const label = uniqueLabel(objs, String(a.label).trim());
      const spot = freeSpot(objs);
      const x = X(a.x, spot.x), y = Y(a.y, spot.y);
      const color = colour(a.color);
      const size = sizeFrom(shape, a.width, a.height);
      if (p.cursor === 'start') {
        const id = p.scene.addNode(label, x, y, shape, size ?? 1);
        if (color) p.scene.get(id).color = color;
      } else {
        const id = nextStepId(p.steps);
        const changes = [{ op: 'add', id, shape, label, x, y, ...(size && { size }) }];
        if (color) changes.push({ op: 'color', target: id, color, dur: 0 });
        record(p, changes);
      }
      const renamed = label !== String(a.label).trim() ? ` ("${a.label}" was taken, so it is called ${label})` : '';
      return `Added ${color ? `${color} ` : ''}${SHAPE_NAME[shape]} ${label}${renamed} at (${x}, ${y}) to ${where(p)}. ${next(p)}`;
    },
  },
  {
    name: 'connect',
    description: 'Draws a line (or an arrow, from → to) between two objects. Lines follow the objects when they move. Example: {"from": "A", "to": "B", "arrow": true}',
    params: {
      from: S('label of the first object'),
      to: S('label of the second object'),
      arrow: { type: 'boolean', description: 'true for an arrow pointing at "to" (default false: a plain line)' },
    },
    required: ['from', 'to'],
    run(p, a) {
      const A = find(p, a.from, { kind: 'node' }).obj, B = find(p, a.to, { kind: 'node' }).obj;
      if (A.id === B.id) throw new ToolError('from and to must be two different objects.');
      const objs = endState(p);
      if ([...objs.values()].some((o) => o.kind === 'edge' && ((o.a === A.id && o.b === B.id) || (o.a === B.id && o.b === A.id)))) {
        throw new ToolError(`${A.label} and ${B.label} are already connected (the line is called "${A.label}-${B.label}").`);
      }
      const directed = a.arrow === true || a.arrow === 'true';
      if (p.cursor === 'start' && !A.fromStep && !B.fromStep) p.scene.addEdge(A.id, B.id, directed);
      else {
        if (p.cursor === 'start') p.cursor = 'in';
        record(p, [{ op: 'connect', id: nextStepId(p.steps), a: A.id, b: B.id, directed }]);
      }
      return `Connected ${A.label} ${directed ? '→' : '–'} ${B.label} (the line is called "${A.label}-${B.label}") in ${where(p)}. ${next(p)}`;
    },
  },
  {
    name: 'next_keyframe',
    description: 'Starts a new keyframe. Every change after it (add, move, change, connect, remove) plays at the same time, over `seconds`, after the previous keyframe has finished. Call it before the first movement.',
    params: { seconds: N('how long this keyframe takes, 0.1 to 10 (default 1)') },
    run(p, a) {
      p.seconds = secondsOf(a.seconds, 1);
      p.cursor = 'new';
      return `Keyframe ${countKeyframes(p.steps) + 1} started (${p.seconds} s). Now add, move, change, connect or remove things: they all happen together in this keyframe.`;
    },
  },
  {
    name: 'move',
    description: 'Moves an object to (x, y). Give `via` (a list of [x, y] points) to make it travel along a smooth curve through them, e.g. an arc. Example: {"label": "A", "x": 400, "y": 180, "via": [[250, 80]]}',
    params: {
      label: S('which object'),
      x: N(`where to, 0 to ${CANVAS.width}`),
      y: N(`where to, 0 to ${CANVAS.height}`),
      via: { type: 'array', description: 'optional points to pass through on the way, e.g. [[250, 80]]', items: { type: 'array', items: { type: 'number' } } },
    },
    required: ['label', 'x', 'y'],
    run(p, a) {
      const { obj } = find(p, a.label, { kind: 'node' });
      const x = X(a.x), y = Y(a.y);
      let via = a.via ?? [];
      if (typeof via === 'string') { try { via = JSON.parse(via); } catch { throw new ToolError('via must be a list of [x, y] points, e.g. [[250, 80], [300, 60]].'); } }
      if (!Array.isArray(via)) throw new ToolError('via must be a list of [x, y] points, e.g. [[250, 80]].');
      const points = via.map((pt, i) => {
        const [px, py] = Array.isArray(pt) ? pt : [pt?.x, pt?.y];
        return { x: num(px, `via point ${i + 1} x`, 0, CANVAS.width), y: num(py, `via point ${i + 1} y`, 0, CANVAS.height) };
      });
      if (p.cursor === 'start') {
        if (obj.fromStep) throw new ToolError('This object appears in a keyframe; call next_keyframe before moving it.');
        Object.assign(p.scene.get(obj.id), { x, y });
        return `${obj.label} now starts at (${x}, ${y}) in the starting picture. To animate a movement, call next_keyframe first.`;
      }
      record(p, [points.length ? { op: 'path', target: obj.id, points: [...points, { x, y }] } : { op: 'move', target: obj.id, x, y }]);
      return `${obj.label} moves ${points.length ? 'along a curve ' : ''}from (${obj.x}, ${obj.y}) to (${x}, ${y}) in ${where(p)}. ${next(p)}`;
    },
  },
  {
    name: 'change',
    description: 'Changes how an object looks: colour, size (width/height in pixels) or label. In a keyframe the colour and size change smoothly. A line ("A-B") can change colour too. Example: {"label": "A", "color": "red"}',
    params: {
      label: S('which object (a line is "A-B")'),
      color: S('new colour', { enum: COLORS }),
      width: N('new width in pixels'),
      height: N('new height in pixels'),
      new_label: S('new text on it (takes effect for the whole animation)'),
    },
    required: ['label'],
    run(p, a) {
      const { obj } = find(p, a.label);
      const color = colour(a.color);
      const size = obj.kind === 'node' ? sizeFrom(obj.shape, a.width, a.height, obj.size) : undefined;
      const relabel = a.new_label !== undefined && String(a.new_label).trim() !== '' ? String(a.new_label).trim() : undefined;
      if (!color && !size && !relabel) throw new ToolError('Say what to change: color, width, height or new_label.');
      const said = [];
      if (relabel) {
        const add = p.steps.find((s) => s.op === 'add' && s.id === obj.id);
        if (add) add.label = relabel; else p.scene.get(obj.id).label = relabel;
        said.push(`is now called ${relabel}`);
      }
      if (p.cursor === 'start' && !obj.fromStep) {
        if (color) p.scene.get(obj.id).color = color;
        if (size) p.scene.get(obj.id).size = size;
      } else if (color || size) {
        if (p.cursor === 'start') p.cursor = 'in';
        record(p, [...(color ? [{ op: 'color', target: obj.id, color }] : []), ...(size ? [{ op: 'size', target: obj.id, size }] : [])]);
      }
      if (color) said.push(`turns ${color}`);
      if (size) said.push(`becomes ${pixels(obj.shape, size)} px`);
      return `${relabel ? a.label : nameOf(endState(p), obj)} ${said.join(', ')} in ${where(p)}. ${next(p)}`;
    },
  },
  {
    name: 'remove',
    description: 'Removes an object (its lines go with it). In a keyframe it disappears at that moment; in the starting picture it is deleted. A line is "A-B".',
    params: { label: S('which object (a line is "A-B")') },
    required: ['label'],
    run(p, a) {
      const { obj, objs } = find(p, a.label);
      const name = nameOf(objs, obj);
      if (p.cursor === 'start' && !obj.fromStep) {
        p.scene.remove(obj.id);
        return `Deleted ${name} from the starting picture. ${NEXT_AT_START}`;
      }
      if (p.cursor === 'start') p.cursor = 'in';
      record(p, [{ op: 'remove', target: obj.id }]);
      return `${name} disappears in ${where(p)}. ${next(p)}`;
    },
  },
  {
    name: 'pause',
    description: 'Waits (nothing changes) between keyframes. After a pause, the next change starts a new keyframe by itself.',
    params: { seconds: N('how long, 0.1 to 10') },
    required: ['seconds'],
    run(p, a) {
      const seconds = secondsOf(a.seconds);
      p.steps = recordSteps(p.steps, p.steps.length, [{ op: 'wait', dur: Math.round(seconds * 1000) }]).steps;
      p.cursor = 'new';
      return `Pause of ${seconds} s added. The next change starts a new keyframe.`;
    },
  },
  {
    name: 'show',
    description: 'Describes the animation so far: the starting picture, every keyframe, and where everything ends up. Use it to check your work.',
    params: {},
    run(p) { return describeProject(p); },
  },
];

// ---------- describing ----------

function describeStep(s, objs) {
  const name = (id) => { const o = objs.get(id); return o ? nameOf(objs, o) : String(id); };
  switch (s.op) {
    case 'add': return `${s.label} (${SHAPE_NAME[s.shape]}) appears at (${s.x}, ${s.y})`;
    case 'connect': return `${name(s.a)} ${s.directed ? '→' : '–'} ${name(s.b)} gets connected`;
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
  // names of everything that ever existed, so removed objects can still be named
  const ever = new Map();
  for (const o of [...p.scene.nodes(), ...p.scene.edges()]) ever.set(o.id, o);
  for (const s of p.steps) {
    if (s.op === 'add') ever.set(s.id, { id: s.id, kind: 'node', label: s.label });
    if (s.op === 'connect') ever.set(s.id, { id: s.id, kind: 'edge', a: s.a, b: s.b });
  }
  const lines = [`Canvas ${CANVAS.width}×${CANVAS.height}, (0, 0) top left.`];
  const nodes = p.scene.nodes(), edges = p.scene.edges();
  lines.push(nodes.length
    ? `Starting picture: ${nodes.map((n) => `${SHAPE_NAME[n.shape]} ${n.label} at (${n.x}, ${n.y})${n.color !== defaultColor(n.shape) ? ` ${n.color}` : ''}`).join('; ')}`
      + (edges.length ? `; lines ${edges.map((e) => nameOf(ever, e)).join(', ')}.` : '.')
    : 'Starting picture: empty.');
  let n = 0;
  for (const f of keyframes(p.steps)) {
    const group = p.steps.slice(f.start, f.end);
    if (group[0].op === 'wait') { lines.push(`Pause ${group[0].dur / 1000} s.`); continue; }
    const timed = group.filter((s) => !INSTANT.has(s.op));
    const secs = timed.length ? Math.max(...timed.map((s) => s.dur)) / 1000 : 0;
    lines.push(`Keyframe ${++n}${secs ? ` (${secs} s)` : ''}: ${group.map((s) => describeStep(s, ever)).join('; ')}.`);
  }
  if (!n) lines.push('No keyframes yet.');
  const end = [...endState(p).values()].filter((o) => o.kind === 'node');
  if (end.length && n) lines.push(`At the end: ${end.map((o) => `${o.label} (${Math.round(o.x)}, ${Math.round(o.y)})`).join(', ')}.`);
  lines.push(p.cursor === 'start' ? 'Now building the starting picture.' : p.cursor === 'new' ? `The next change starts keyframe ${n + 1}.` : `Now adding to keyframe ${n}.`);
  return lines.join('\n');
}

// ---------- running ----------

const byName = new Map(TOOLS.map((t) => [t.name, t]));

/** Adds tools (plugins). Each is { name, description, params, required?, run(project, args) }. */
export function registerTools(list) {
  for (const t of list) { TOOLS.push(t); byName.set(t.name, t); }
}

/** Runs one tool on the project. Returns its reply text; throws ToolError with a helpful message. */
export function runTool(project, name, args = {}) {
  const tool = byName.get(name);
  if (!tool) throw new ToolError(`There is no tool called "${name}". Tools: ${TOOLS.map((t) => t.name).join(', ')}.`);
  if (typeof args === 'string') { try { args = JSON.parse(args || '{}'); } catch { throw new ToolError(`The arguments for ${name} must be a JSON object.`); } }
  args ??= {};
  for (const r of tool.required ?? []) {
    if (args[r] === undefined || args[r] === null || args[r] === '') throw new ToolError(`${name} needs "${r}": ${tool.params[r]?.description ?? ''}`);
  }
  return tool.run(project, args);
}

/** JSON schema of a tool's arguments (for MCP and OpenAI function calling). */
export const schemaOf = (t) => ({ type: 'object', properties: t.params, ...(t.required?.length && { required: t.required }) });

/** How to use the tools, in a few lines: the whole manual for an AI. */
export const RECIPE = `You make short academic animations (diagrams of circles, boxes, triangles, text, lines and arrows) on a ${CANVAS.width}×${CANVAS.height} canvas, (0, 0) at the top left.
1. start_over.
2. add the objects of the starting picture (and connect them).
3. next_keyframe, then make the changes that happen together (move, change, add, connect, remove).
4. Repeat step 3 for each moment of the animation.
5. show to check it. Refer to objects by their labels; a line is "A-B".
Example: start_over; add {shape: "circle", label: "A", x: 100, y: 180}; add {shape: "circle", label: "B", x: 300, y: 180}; connect {from: "A", to: "B"}; next_keyframe; change {label: "A", color: "red"}; next_keyframe; move {label: "A", x: 200, y: 80}.`;
