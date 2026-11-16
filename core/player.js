// Player: computes the scene state at any time t by replaying timeline commands.
// scene(t) = every command with start <= t applied in order; tweens still running are interpolated.

import { mixColor } from './colors.js';
import { ease } from './easing.js';

function lerpValue(prop, from, to, f) {
  if (f >= 1) return to;
  if (prop === 'color') return mixColor(from, to, f);
  if (prop === 'pos') return { x: from.x + (to.x - from.x) * f, y: from.y + (to.y - from.y) * f };
  return from; // other properties (e.g. label) switch when the tween ends
}

// A property is stored as a tween { from, to, t0, dur, ease? }; a constant is a tween with dur 0.
// Easing applies here, so a move that starts mid-move starts from the eased position.
function valueAt(tw, prop, t) {
  const f = tw.dur === 0 ? 1 : Math.min(1, Math.max(0, (t - tw.t0) / tw.dur));
  return lerpValue(prop, tw.from, tw.to, ease(tw.ease ?? 'linear', f));
}

// Replays commands with t <= tMs. Each property becomes a tween that starts from wherever the
// property is at that moment. onSet(cmd, tween) sees every resolved tween (used by animated SVG).
// Ops: 'create', 'set' (a property changes), 'remove' (the object is gone from then on).
function replay(timeline, tMs, onSet) {
  const objs = new Map();
  for (const c of timeline.commands) {
    if (c.t > tMs) break;
    if (c.op === 'create') {
      const props = {};
      for (const [k, v] of Object.entries(c.props)) props[k] = { from: v, to: v, t0: c.t, dur: 0 };
      objs.set(c.id, { id: c.id, kind: c.kind, props });
    } else if (c.op === 'set') {
      const o = objs.get(c.id);
      const from = valueAt(o.props[c.prop], c.prop, c.t); // start from wherever it is right now
      o.props[c.prop] = { from, to: c.value, t0: c.t, dur: c.dur, ease: c.ease };
      onSet?.(c, o.props[c.prop]);
    } else if (c.op === 'remove') {
      objs.delete(c.id);
    }
  }
  return objs;
}

/**
 * Returns { nodes: [{id, shape, label, x, y, color}], edges: [{id, a, b, directed, color}] } at time tMs.
 * Commands must be sorted by t (the timeline appends them in clock order).
 */
export function sceneAt(timeline, tMs) {
  const state = { nodes: [], edges: [] };
  for (const o of replay(timeline, tMs).values()) {
    const v = {};
    for (const [k, tw] of Object.entries(o.props)) v[k] = valueAt(tw, k, tMs);
    if (o.kind === 'node') state.nodes.push({ id: o.id, shape: v.shape ?? 'circle', label: v.label, x: v.pos.x, y: v.pos.y, color: v.color });
    else state.edges.push({ id: o.id, a: v.a, b: v.b, directed: !!v.directed, color: v.color });
  }
  return state;
}

/** Every 'set' as a resolved tween { id, prop, from, to, t0, dur, ease }, in command order. */
export function tweens(timeline) {
  const list = [];
  replay(timeline, Infinity, (c, tw) => list.push({ id: c.id, prop: c.prop, ...tw }));
  return list;
}

/**
 * Frame timestamps (ms) on a regular 1/fps grid: frame i is at round(i * 1000 / fps).
 * The last frame is at or after the end, so the finished state is always a frame.
 */
export function frameTimes(durationMs, fps) {
  const n = Math.ceil((durationMs * fps) / 1000) + 1;
  return Array.from({ length: n }, (_, i) => Math.round((i * 1000) / fps));
}

/** Converts an editor Scene into the same state shape the player produces. */
export function sceneToState(scene) {
  return {
    nodes: scene.nodes().map(({ id, shape, label, x, y, color }) => ({ id, shape: shape ?? 'circle', label, x, y, color })),
    edges: scene.edges().map(({ id, a, b, directed, color }) => ({ id, a, b, directed: !!directed, color })),
  };
}

/**
 * Position of every node over time: returns pos(id, t) -> {x, y}. The same rule as sceneAt (the
 * latest move that has started wins, eased), without replaying everything for each sample.
 */
export function positionsOf(timeline) {
  const moves = new Map();
  for (const c of timeline.commands) {
    if (c.op === 'create' && c.kind === 'node') moves.set(c.id, [{ from: c.props.pos, to: c.props.pos, t0: c.t, dur: 0 }]);
  }
  for (const tw of tweens(timeline)) if (tw.prop === 'pos') moves.get(tw.id).push(tw);
  return (id, t) => {
    const list = moves.get(id);
    let tw = list[0];
    for (const m of list) if (m.t0 <= t) tw = m;
    return valueAt(tw, 'pos', t);
  };
}
