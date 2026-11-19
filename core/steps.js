// GUI steps -> steps.lua. The steps editor doesn't drive the engine directly: it generates the
// same API calls anyone could type, and the engine runs them like any other script.
//
// A step is one of
//   { op: 'color',   target, color, dur, together }
//   { op: 'move',    target, x, y, dur, together }
//   { op: 'path',    target, points: [{x, y}, …], dur, together }  a curved move through the points
//   { op: 'size',    target, size, dur, together }         size = { w, h } (or one number for both); 1 = normal
//   { op: 'add',     id, shape, label, x, y, size?, together }  a new object appears
//   { op: 'connect', id, a, b, directed, together }        a new line or arrow appears
//   { op: 'remove',  target, together }                    an object disappears (a node takes its lines)
//   { op: 'wait',    dur }
// target, a and b are object ids: numbers for stage objects, 's1', 's2', … for objects that steps
// create (so the two never clash). dur is in ms. Steps play one after another, except that a step
// with together=true starts at the same time as the step before it.

import { variableNames, luaString, isUsableName, SHAPE_CALL, sizeArgs } from './stage_file.js';
import { sizeOf } from './shapes.js';

/** Steps that happen at once (no duration). */
export const INSTANT = new Set(['add', 'connect', 'remove']);
/** Steps that let time run on their own: nothing plays "with" them. */
export const RUNS_TIME = new Set(['wait']);

const sec = (ms) => String(Number((ms / 1000).toFixed(3)));
const num = (v) => String(Number(v.toFixed(3)));

/** The next free id for an object created by a step. */
export function nextStepId(steps) {
  let k = 0;
  for (const s of steps) if (typeof s.id === 'string') k = Math.max(k, Number(s.id.slice(1)));
  return `s${k + 1}`;
}

/**
 * Walks the steps in order, tracking which objects exist at each point: the stage, plus objects
 * earlier steps created, minus ones they removed (with the lines of removed nodes).
 * Returns { valid: the steps that still make sense, objects: Map(id -> object) of everything }.
 */
function walk(steps, scene) {
  const objects = new Map(); // every object ever: { id, kind, label?, shape?, a?, b? }
  const alive = new Set();
  for (const o of [...scene.nodes(), ...scene.edges()]) { objects.set(o.id, o); alive.add(o.id); }
  const isNode = (id) => alive.has(id) && objects.get(id).kind === 'node';
  const connected = (a, b) => [...alive].some((id) => {
    const o = objects.get(id);
    return o.kind === 'edge' && ((o.a === a && o.b === b) || (o.a === b && o.b === a));
  });
  const valid = [];
  for (const s of steps) {
    let ok = true;
    if (s.op === 'add') {
      objects.set(s.id, { id: s.id, kind: 'node', label: s.label, shape: s.shape, size: s.size });
      alive.add(s.id);
    } else if (s.op === 'connect') {
      ok = isNode(s.a) && isNode(s.b) && s.a !== s.b && !connected(s.a, s.b);
      if (ok) { objects.set(s.id, { id: s.id, kind: 'edge', a: s.a, b: s.b, directed: !!s.directed }); alive.add(s.id); }
    } else if (s.op === 'remove') {
      ok = alive.has(s.target);
      if (ok) {
        if (isNode(s.target)) {
          for (const id of [...alive]) {
            const o = objects.get(id);
            if (o.kind === 'edge' && (o.a === s.target || o.b === s.target)) alive.delete(id);
          }
        }
        alive.delete(s.target);
      }
    } else if (s.op === 'move' || s.op === 'path' || s.op === 'size') {
      ok = isNode(s.target);
    } else if (s.op === 'color') {
      ok = alive.has(s.target);
    }
    if (ok) valid.push(s);
  }
  return { valid, objects };
}

/**
 * Drops steps that no longer make sense: their object is gone from the stage, was removed by an
 * earlier step, or was created by a step that is gone. Dropping cascades: deleting an "add" step
 * also drops the steps that used that object.
 */
export function pruneSteps(steps, scene) {
  let out = steps;
  for (;;) {
    const next = walk(out, scene).valid;
    if (next.length === out.length) return out;
    out = next;
  }
}

/** Names for every object the stage and the steps know: label for a node, "A-B" for a line. */
export function stepNames(steps, scene) {
  const { objects } = walk(steps, scene);
  const nameOf = (id) => {
    const o = objects.get(id);
    if (!o) return `#${id}`;
    return o.kind === 'node' ? o.label : `${nameOf(o.a)}-${nameOf(o.b)}`;
  };
  return { nameOf, get: (id) => objects.get(id) };
}

/**
 * Generates steps.lua. Returns { code, stepAtLine } where stepAtLine[n] is the index of the step
 * written on line n (1-based), so the page can say "Step 3" for a command from steps.lua:4.
 */
export function buildSteps(steps, scene) {
  if (!steps.length) return { code: '', stepAtLine: [] };
  const names = variableNames(scene);
  // variables for objects that steps create: the label when it's a free name, else obj_<k>
  const used = new Set(names.values());
  let k = 1;
  for (const s of steps) {
    if (s.op !== 'add') continue;
    let name = s.label;
    if (!isUsableName(name) || used.has(name)) {
      while (used.has(`obj_${k}`)) k++;
      name = `obj_${k}`;
    }
    used.add(name);
    names.set(s.id, name);
  }
  const { get } = stepNames(steps, scene);
  const ref = (id) => {
    const o = get(id);
    return o.kind === 'node' ? names.get(id) : `edge_of(${names.get(o.a)}, ${names.get(o.b)})`;
  };
  const call = (s) => {
    switch (s.op) {
      case 'color': return `color(${ref(s.target)}, ${luaString(s.color)}, ${sec(s.dur)})`;
      case 'move': return `move(${ref(s.target)}, ${Math.round(s.x)}, ${Math.round(s.y)}, ${sec(s.dur)})`;
      case 'path': return `path(${ref(s.target)}, {${s.points.map((p) => `{${Math.round(p.x)}, ${Math.round(p.y)}}`).join(', ')}}, ${sec(s.dur)})`;
      case 'size': { const z = sizeOf(s.size); return `size(${ref(s.target)}, ${num(z.w)}, ${num(z.h)}, ${sec(s.dur)})`; }
      case 'add': return `${names.get(s.id)} = ${SHAPE_CALL[s.shape]}(${luaString(s.label)}, ${Math.round(s.x)}, ${Math.round(s.y)}${sizeArgs(s.size ?? 1)})`;
      case 'connect': return `${s.directed ? 'arrow' : 'edge'}(${names.get(s.a)}, ${names.get(s.b)})`;
      case 'remove': return `remove(${ref(s.target)})`;
    }
    throw new Error(`unknown step '${s.op}'`);
  };
  const lasts = (s) => (INSTANT.has(s.op) ? 0 : s.dur);

  const lines = ['-- steps.lua (generated by the GEPV1 steps editor)'];
  const stepAtLine = [undefined, undefined]; // index 0 unused, line 1 is the comment
  let group = [], longest = 0; // calls that start together (with their step index), and the longest one
  const flush = () => {
    if (!group.length) return;
    if (longest > 0) group.at(-1).code += `; wait(${sec(longest)})`;
    for (const g of group) { lines.push(g.code); stepAtLine.push(g.step); }
    group = [];
    longest = 0;
  };

  for (const [i, s] of steps.entries()) {
    // a pause lets time run by itself: it is a line of its own
    if (s.op === 'wait') {
      flush();
      lines.push(`wait(${sec(s.dur)})`);
      stepAtLine.push(i);
      continue;
    }
    if (!s.together) flush();
    group.push({ step: i, code: call(s) });
    longest = Math.max(longest, lasts(s));
  }
  flush();
  return { code: lines.join('\n') + '\n', stepAtLine };
}

export const stepsToLua = (steps, scene) => buildSteps(steps, scene).code;

/**
 * Running the program numbers objects 1..n in the order it creates them, while the editor has its
 * own ids (stage ids with gaps after deletions, 's1'… for objects steps create). Returns a state
 * from sceneAt() with editor ids, so the editor can show "the picture after the steps" and still
 * know which object was clicked. Stage objects map by creation order (nodes, then edges); objects
 * from steps.lua map by the line that created them.
 */
export function toEditorIds(state, result, scene, steps, stepAtLine) {
  const order = [...scene.nodes(), ...scene.edges()].map((o) => o.id);
  const cmds = result.timeline.commands;
  const map = new Map(cmds.slice(0, result.stageCommands).map((c, i) => [c.id, order[i]]));
  for (const c of cmds.slice(result.stageCommands)) {
    if (c.op !== 'create' || c.src?.file !== 'steps.lua') continue;
    const s = steps?.[stepAtLine?.[c.src.line]];
    if (s?.id !== undefined) map.set(c.id, s.id);
  }
  const id = (x) => map.get(x) ?? `lua-${x}`; // objects made by script.lua aren't editable here
  return {
    nodes: state.nodes.map((n) => ({ ...n, id: id(n.id) })),
    edges: state.edges.map((e) => ({ ...e, id: id(e.id), a: id(e.a), b: id(e.b) })),
  };
}

/**
 * Which step decides an object's position, size or colour at point k (after the first k steps)?
 * Returns the index of the last step before k that sets it (a move, path, size or colour step, or
 * the add step that created the object), or -1 when it is still as on the stage. Arrange mode
 * changes that step (or the stage) instead of recording a new one.
 *   prop  'pos' | 'size' | 'color'
 */
export function sourceOf(steps, k, id, prop) {
  const sets = { pos: ['move', 'path'], size: ['size'], color: ['color'] }[prop];
  for (let j = Math.min(k, steps.length) - 1; j >= 0; j--) {
    const s = steps[j];
    if (sets.includes(s.op) && s.target === id) return j;
    if ((s.op === 'add' || s.op === 'connect') && s.id === id) return j;
  }
  return -1;
}

/**
 * Moves the end of a curved move to (x, y), bending the whole curve smoothly: each point shifts by
 * its share of the way along (the start stays where it is).
 */
export function reshapePath(points, x, y) {
  const last = points.at(-1), dx = x - last.x, dy = y - last.y;
  return points.map((p, i) => ({ x: Math.round(p.x + (dx * (i + 1)) / points.length), y: Math.round(p.y + (dy * (i + 1)) / points.length) }));
}

// ---------- Keyframes ----------
// A keyframe is a run of steps that start together: a step with together=false (or the first one)
// begins one, and a pause is a keyframe of its own. They are what Record mode adds to.

/** [{ start, end }] index ranges of the keyframes (end exclusive), in order. */
export function keyframes(steps) {
  const out = [];
  steps.forEach((s, i) => {
    const prev = steps[i - 1];
    const begins = i === 0 || !s.together || RUNS_TIME.has(s.op) || RUNS_TIME.has(prev.op);
    if (begins) out.push({ start: i, end: i + 1 }); else out.at(-1).end = i + 1;
  });
  return out;
}

/** The point at the end of the keyframe that holds step k-1 (0 stays the start). */
export function keyframeEndAt(steps, k) {
  if (k <= 0) return 0;
  return keyframes(steps).find((f) => k - 1 >= f.start && k - 1 < f.end)?.end ?? steps.length;
}

/**
 * After some steps were dropped (`after` keeps a subset of `before`, same objects, same order): every
 * step stays in the keyframe it was in, so the one after a dropped first step begins that keyframe.
 * Changes the steps in place and returns `after`.
 */
export function keepKeyframes(before, after) {
  const frameOf = new Map();
  keyframes(before).forEach((f, n) => { for (let i = f.start; i < f.end; i++) frameOf.set(before[i], n); });
  after.forEach((s, i) => { if (s.together && (i === 0 || frameOf.get(after[i - 1]) !== frameOf.get(s))) s.together = false; });
  return after;
}

/** Removes step i; if it began a keyframe, the next step of that keyframe begins it now. */
export function removeStep(steps, i) {
  const out = steps.map((s) => ({ ...s }));
  const copies = out.slice();
  out.splice(i, 1);
  return keepKeyframes(copies, out);
}

const moves = new Set(['move', 'path']);
function sameThing(s, c) {
  if (s.target === undefined || s.target !== c.target) return false;
  return (moves.has(s.op) && moves.has(c.op)) || (s.op === c.op && (s.op === 'color' || s.op === 'size'));
}
/** A second change to the same thing in one keyframe: a move carries on (one curve), the rest replace. */
function merge(old, c) {
  if (!moves.has(c.op)) return { ...old, ...c, dur: old.dur, together: old.together };
  const before = old.op === 'path' ? old.points : [{ x: old.x, y: old.y }];
  const after = c.op === 'path' ? c.points : [{ x: c.x, y: c.y }];
  return { op: 'path', target: old.target, points: [...before, ...after], dur: old.dur, together: old.together };
}

/**
 * Records changes at `point`. join = add them to the keyframe that ends there (if there is one, and it
 * isn't a pause); otherwise they begin a new keyframe. Changes in one call always share a keyframe;
 * a change to something that keyframe already changes updates that step instead (see merge).
 * Returns { steps, point, added } (point = after the recorded steps).
 */
export function recordSteps(steps, point, changes, { join = true, dur = 500 } = {}) {
  steps = steps.slice();
  let start = join && point > 0 && !RUNS_TIME.has(steps[point - 1].op)
    ? keyframes(steps).find((f) => f.end === point)?.start ?? null : null;
  if (start !== null) { // joining: new changes take the keyframe's duration
    const timed = steps.slice(start, point).filter((s) => !INSTANT.has(s.op));
    if (timed.length) dur = Math.max(...timed.map((s) => s.dur ?? 0));
  }
  const added = [];
  for (const c of changes) {
    if (RUNS_TIME.has(c.op)) {
      const step = { dur, ...c, together: false };
      steps.splice(point++, 0, step);
      added.push(step);
      start = null;
      continue;
    }
    if (start !== null) {
      const j = steps.slice(start, point).findIndex((s) => sameThing(s, c));
      if (j >= 0) { steps[start + j] = merge(steps[start + j], c); added.push(steps[start + j]); continue; }
    }
    const step = { dur, ...c, together: start !== null };
    steps.splice(point, 0, step);
    added.push(step);
    if (start === null) start = point;
    point++;
  }
  return { steps, point, added };
}
