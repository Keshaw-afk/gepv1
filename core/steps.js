// GUI steps -> steps.lua. The steps editor doesn't drive the engine directly: it generates the
// same API calls anyone could type, and the engine runs them like any other script.
//
// A step is one of
//   { op: 'color',   target, color, dur, together }
//   { op: 'move',    target, x, y, dur, together }
//   { op: 'add',     id, shape, label, x, y, together }    a new object appears
//   { op: 'connect', id, a, b, directed, together }        a new line or arrow appears
//   { op: 'remove',  target, together }                    an object disappears (a node takes its lines)
//   { op: 'tidy',    target, dur, together }               tree_layout from that node
//   { op: 'wait',    dur }
// target, a and b are object ids: numbers for stage objects, 's1', 's2', … for objects that steps
// create (so the two never clash). dur is in ms. Steps play one after another, except that a step
// with together=true starts at the same time as the step before it.

import { variableNames, luaString, isUsableName, SHAPE_CALL } from './stage_file.js';

const sec = (ms) => String(Number((ms / 1000).toFixed(3)));

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
      objects.set(s.id, { id: s.id, kind: 'node', label: s.label, shape: s.shape });
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
    } else if (s.op === 'move' || s.op === 'tidy') {
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
      case 'add': return `${names.get(s.id)} = ${SHAPE_CALL[s.shape]}(${luaString(s.label)}, ${Math.round(s.x)}, ${Math.round(s.y)})`;
      case 'connect': return `${s.directed ? 'arrow' : 'edge'}(${names.get(s.a)}, ${names.get(s.b)})`;
      case 'remove': return `remove(${ref(s.target)})`;
      case 'tidy': return `tree_layout(${ref(s.target)}, ${sec(s.dur)})`;
    }
    throw new Error(`unknown step '${s.op}'`);
  };
  const lasts = (s) => (s.op === 'add' || s.op === 'connect' || s.op === 'remove' ? 0 : s.dur);

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
    if (s.op === 'wait') { flush(); lines.push(`wait(${sec(s.dur)})`); stepAtLine.push(i); continue; }
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
