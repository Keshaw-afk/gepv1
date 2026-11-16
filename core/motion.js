// Motion by rules ("forces"): one general mechanism. Every node has a velocity (push() sets it).
// simulate() lets time run in fixed 10 ms ticks; each tick a rule gives every moving node an
// acceleration, then velocity and position follow (semi-implicit Euler) and the canvas edges act
// as walls. The result is baked into one path per node (a position every tick), so the player,
// every frame and the animated SVG show exactly the same motion and nothing is simulated twice.
//
// A rule is a function (body, world) -> [ax, ay] in px/s². The ready-made ones are examples of
// rules, not a catalogue; a Lua function can be a rule too (see lua_api.js).

import { CANVAS } from './scene.js';

export const TICK_MS = 10;
export const MAX_SECONDS = 30;
export const SETTLED = 10; // px/s: a node slower than this when a simulation ends keeps no velocity

const BOUNCE = 0.5; // how much speed is kept when hitting a wall

export const RULES = {
  /** No force: things keep the velocity push() gave them (and bounce off the edges). */
  drift: () => [0, 0],

  /** Fall and bounce on the floor (gravity with a little air drag). */
  fall: (b) => [-0.1 * b.vx, 900 - 0.1 * b.vy],

  /** Head for world.target and settle there (a critically damped spring). */
  towards: (b, w) => {
    const k = 40, damp = 2 * Math.sqrt(k);
    return [k * (w.target.x - b.x) - damp * b.vx, k * (w.target.y - b.y) - damp * b.vy];
  },

  /**
   * Untangle a graph: every node pushes every other away, every line pulls its two ends towards
   * a comfortable length and a weak pull keeps the picture centred. Friction starts low (so a
   * twisted graph can unfold) and grows (so it settles before the time is up).
   */
  spread: (b, w) => {
    const REST = 90, PULL = 20, PUSH = 17000, CENTRE = 0.5;
    const friction = 2 + 18 * w.f * w.f;
    let ax = CENTRE * (CANVAS.width / 2 - b.x) - friction * b.vx;
    let ay = CENTRE * (CANVAS.height / 2 - b.y) - friction * b.vy;
    for (const o of w.bodies) {
      if (o === b) continue;
      let dx = b.x - o.x, dy = b.y - o.y;
      let d = Math.hypot(dx, dy);
      if (d < 1) { dx = Math.cos(b.id + o.id); dy = Math.sin(b.id + o.id); d = 1; } // on top of each other
      const f = PUSH / d;
      ax += (f * dx) / d;
      ay += (f * dy) / d;
    }
    for (const o of w.linked.get(b.id) ?? []) {
      const dx = o.x - b.x, dy = o.y - b.y, d = Math.max(1, Math.hypot(dx, dy));
      const f = PULL * (d - REST);
      ax += (f * dx) / d;
      ay += (f * dy) / d;
    }
    return [ax, ay];
  },
};

/**
 * Runs a simulation. bodies: [{ id, x, y, vx, vy, half: {x, y}, moves }] (bodies that don't move
 * still count, e.g. they push others away); edges: [{ a, b }]; rule: (body, world) -> [ax, ay].
 * Returns { ticks, paths: Map(id -> [x0, y0, x1, y1, …] one position per tick, start included) }
 * and leaves every body at its final position and velocity.
 */
export function simulate({ bodies, edges, durMs, rule, target }) {
  const ticks = Math.max(1, Math.round(durMs / TICK_MS));
  const dt = durMs / ticks / 1000;
  const byId = new Map(bodies.map((b) => [b.id, b]));
  const linked = new Map();
  for (const e of edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    if (!linked.has(a.id)) linked.set(a.id, []);
    if (!linked.has(b.id)) linked.set(b.id, []);
    linked.get(a.id).push(b);
    linked.get(b.id).push(a);
  }
  const world = { bodies, linked, target };
  const movers = bodies.filter((b) => b.moves);
  const paths = new Map(movers.map((b) => [b.id, [b.x, b.y]]));
  for (let i = 0; i < ticks; i++) {
    world.f = i / ticks; // how far through the simulation (0 to 1), for rules that settle down
    const acc = movers.map((b) => rule(b, world)); // all accelerations from the same moment
    movers.forEach((b, k) => {
      const [ax, ay] = acc[k];
      b.vx += (Number(ax) || 0) * dt;
      b.vy += (Number(ay) || 0) * dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      wall(b, 'x', CANVAS.width);
      wall(b, 'y', CANVAS.height);
      paths.get(b.id).push(b.x, b.y);
    });
  }
  return { ticks, paths };
}

function wall(b, axis, size) {
  const v = axis === 'x' ? 'vx' : 'vy';
  const lo = b.half[axis], hi = size - b.half[axis];
  if (b[axis] < lo) { b[axis] = lo; b[v] = Math.abs(b[v]) * BOUNCE; }
  else if (b[axis] > hi) { b[axis] = hi; b[v] = -Math.abs(b[v]) * BOUNCE; }
  if (Math.abs(b[v]) < 2 && (b[axis] === lo || b[axis] === hi)) b[v] = 0; // resting on a wall
}

/** Position along a baked path at fraction f (0..1) of its duration. */
export function pathAt(path, f) {
  const n = path.length / 2 - 1;
  const i = Math.min(n, Math.max(0, f * n));
  const lo = Math.floor(i), hi = Math.min(n, lo + 1), u = i - lo;
  return { x: path[2 * lo] + (path[2 * hi] - path[2 * lo]) * u, y: path[2 * lo + 1] + (path[2 * hi + 1] - path[2 * lo + 1]) * u };
}
