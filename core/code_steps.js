// "Turn code into steps": what script.lua does, as ordinary steps the editor can show and change
// (and, when there are no steps yet, objects the code makes at once go into the starting picture).
//
// Exactly or not at all. Keyframes play one after another, each as long as its longest change, so
// code that starts something while an earlier change is still going can't be written as steps; nor
// can an instant move (steps.lua has no 0 s moves). Those are refused with the Lua line to change.
// Every conversion is then checked: the steps are run and compared with the code, frame by frame
// (25 fps), and anything that differs is refused too.

import { runProgram } from './lua_api.js';
import { Scene } from './scene.js';
import { toStageLua } from './stage_file.js';
import { buildSteps, editorIdMap, nextStepId, isLocked } from './steps.js';
import { sceneAt, frameTimes } from './player.js';
import { sizeOf } from './shapes.js';

export class ConvertError extends Error {}

const sec = (ms) => String(Number((ms / 1000).toFixed(3)));
const isOne = (size) => { const z = sizeOf(size); return z.w === 1 && z.h === 1; };

/**
 * Returns { scene, steps }: the starting picture and the steps, with what the code did added.
 * The inputs are not changed. Throws ConvertError (or the code's own ScriptError).
 * taken: steps whose ids are in use too (the ones after an insertion point), so new ids don't clash.
 */
export function codeToSteps(fengari, scene, steps, script, { taken = steps } = {}) {
  const built = buildSteps(steps, scene);
  const stage = toStageLua(scene);
  const full = runProgram(fengari, { stage, steps: built.code, script });
  const before = runProgram(fengari, { stage, steps: built.code });
  const t0 = before.timeline.clockMs;
  const cmds = full.timeline.commands.filter((c) => c.src?.file === 'script.lua');
  if (!cmds.length) throw new ConvertError('The code changes nothing, so there is nothing to turn into steps.');
  // a table the code keeps (t = grid(…)) exists only while code runs: steps would lose it
  const kept = [...full.tables].filter((name) => !before.tables.has(name));
  if (kept.length) throw new ConvertError(`The code keeps ${kept.join(', ')} for later code, which steps can't, so it is kept as code.`);

  const ids = editorIdMap(full, scene, steps, built.stepAtLine); // program id -> editor id
  const ends = new Map(); // edge id (program) -> [a, b]
  for (const c of full.timeline.commands) if (c.op === 'create' && c.kind === 'edge') ends.set(c.id, [c.props.a, c.props.b]);
  const out = steps.map((s) => ({ ...s }));
  const pic = Scene.from(JSON.parse(JSON.stringify(scene)));
  let k = Number(nextStepId([...steps, ...taken]).slice(1));
  // an object only code can name (made by a code keyframe): steps can't refer to it
  const known = (id, c) => {
    if (id === undefined || isLocked(id)) throw new ConvertError(`Line ${c.src.line} changes ${c.name ?? 'an object'}, which a code keyframe made: only code can change it.`);
    return id;
  };
  const target = (c) => known(ids.get(c.id), c);

  // commands that start together
  const groups = [];
  for (const c of cmds) {
    if (groups.at(-1)?.t === c.t) groups.at(-1).cmds.push(c);
    else groups.push({ t: c.t, cmds: [c] });
  }

  // nothing has happened yet: what the code makes at once is the starting picture
  const inPicture = new Set();
  if (!steps.length && t0 === 0 && groups[0]?.t === 0) {
    const made = new Set();
    for (const c of groups[0].cmds) {
      if (c.op === 'create' && c.kind === 'node') {
        const { label, shape, pos, size, color } = c.props;
        const id = pic.addNode(label, pos.x, pos.y, shape, size);
        pic.get(id).color = color;
        const name = [...full.globals].find(([, v]) => v === c.id)?.[0];
        if (name) pic.get(id).name = name; // the variable typed for it
        ids.set(c.id, id);
      } else if (c.op === 'create' && c.kind === 'edge') {
        const id = pic.addEdge(ids.get(c.props.a), ids.get(c.props.b), c.props.directed);
        ids.set(c.id, id);
      } else if (c.op === 'set' && c.dur === 0 && made.has(c.id) && !c.path) {
        const o = pic.get(ids.get(c.id));
        if (c.prop === 'pos') Object.assign(o, { x: c.value.x, y: c.value.y });
        else o[c.prop] = c.value;
      } else continue;
      made.add(c.id);
      inPicture.add(c);
    }
  }

  const toStep = (c, group) => {
    const line = c.src.line;
    if (c.op === 'create' && c.kind === 'node') {
      const id = `s${k++}`;
      ids.set(c.id, id);
      const { label, shape, pos, size } = c.props;
      const name = [...full.globals].find(([, v]) => v === c.id)?.[0]; // the variable the code keeps it in
      return { op: 'add', id, shape, label, x: pos.x, y: pos.y, ...(!isOne(size) && { size }), ...(name && { name }) };
    }
    if (c.op === 'create') {
      const id = `s${k++}`;
      ids.set(c.id, id);
      return { op: 'connect', id, a: known(ids.get(c.props.a), c), b: known(ids.get(c.props.b), c), directed: !!c.props.directed };
    }
    if (c.op === 'remove') {
      // removing a node removes its lines too: one step does both
      const [a, b] = ends.get(c.id) ?? [];
      if (a !== undefined && group.some((o) => o.op === 'remove' && (o.id === a || o.id === b))) return null;
      return { op: 'remove', target: target(c) };
    }
    const ease = c.ease && c.ease !== 'linear' ? { ease: c.ease } : {};
    if (c.prop === 'color') return { op: 'color', target: target(c), color: c.value, dur: c.dur };
    if (c.prop === 'size') return { op: 'size', target: target(c), size: c.value, dur: c.dur, ...ease };
    if (c.prop === 'label') throw new ConvertError(`Line ${line} changes a label; steps can't do that yet, so it is kept as code.`);
    if (c.dur === 0) throw new ConvertError(`Line ${line} moves ${c.name} at once (0 s). Steps can't do an instant move: give it a duration, or keep it as code.`);
    if (c.path) return { op: 'path', target: target(c), points: c.via.map((p) => ({ ...p })), dur: c.dur, ...ease };
    return { op: 'move', target: target(c), x: c.value.x, y: c.value.y, dur: c.dur, ...ease };
  };

  let cursor = t0, longestBy = null;
  for (const g of groups) {
    const rest = g.cmds.filter((c) => !inPicture.has(c));
    if (!rest.length) continue;
    if (g.t < cursor) {
      throw new ConvertError(`Line ${rest[0].src.line} starts at ${sec(g.t)} s, while line ${longestBy.src.line} is still going (until ${sec(cursor)} s). `
        + `Steps play one keyframe after another, so this can't become steps exactly. Make line ${longestBy.src.line} finish first (a longer wait before line ${rest[0].src.line}), or keep it as code.`);
    }
    if (g.t > cursor) out.push({ op: 'wait', dur: g.t - cursor });
    let first = true, longest = 0;
    for (const c of rest) {
      const s = toStep(c, rest);
      if (!s) continue;
      s.together = !first;
      first = false;
      out.push(s);
      if (c.dur > longest) { longest = c.dur; longestBy = c; }
    }
    cursor = g.t + longest;
  }
  if (full.timeline.durationMs > cursor) out.push({ op: 'wait', dur: full.timeline.durationMs - cursor }); // a wait at the end

  // the check: the steps must play exactly like the code
  const back = runProgram(fengari, { stage: toStageLua(pic), steps: buildSteps(out, pic).code });
  const a = full.timeline, b = back.timeline;
  if (a.durationMs !== b.durationMs) throw new ConvertError(`As steps it would last ${sec(b.durationMs)} s instead of ${sec(a.durationMs)} s, so it is kept as code.`);
  for (const t of [...frameTimes(a.durationMs, 25), ...cmds.map((c) => c.t + c.dur)]) {
    if (picture(sceneAt(a, t)) !== picture(sceneAt(b, t))) {
      throw new ConvertError(`As steps it would look different at ${sec(t)} s (steps use whole pixels and keyframes), so it is kept as code.`);
    }
  }
  return { scene: pic, steps: out };
}

/** What a frame shows, independent of ids and creation order. */
function picture(state) {
  const r = (v) => Math.round(v * 1000) / 1000;
  const byId = new Map(state.nodes.map((n) => [n.id, n]));
  const node = (n) => JSON.stringify([n.label, n.shape, r(n.x), r(n.y), n.color, r(sizeOf(n.size).w), r(sizeOf(n.size).h)]);
  const nodes = state.nodes.map(node).sort();
  const edges = state.edges.map((e) => JSON.stringify([node(byId.get(e.a)), node(byId.get(e.b)), !!e.directed, e.color])).sort();
  return JSON.stringify([nodes, edges]);
}
