// Curved moves: a path is a polyline [{x, y}, …] that an object follows at even speed (the eased
// progress is a fraction of the path's length). The editor records a drag, thins it out
// (simplify), and path() in Lua smooths the points into a curve through them (smoothPath).

const lengthsCache = new WeakMap();

/** Cumulative lengths along the polyline: [0, |p0p1|, …, total]. */
function lengths(path) {
  let acc = lengthsCache.get(path);
  if (!acc) {
    acc = [0];
    for (let i = 1; i < path.length; i++) acc.push(acc[i - 1] + Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
    lengthsCache.set(path, acc);
  }
  return acc;
}

export const pathLength = (path) => lengths(path).at(-1);

/** The point a fraction f (0..1) of the way along the path, by length. */
export function pointAlong(path, f) {
  if (path.length === 1 || f <= 0) return { ...path[0] };
  if (f >= 1) return { ...path.at(-1) };
  const acc = lengths(path), d = f * acc.at(-1);
  let lo = 0, hi = acc.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (acc[mid] <= d) lo = mid; else hi = mid; }
  const seg = acc[hi] - acc[lo], u = seg ? (d - acc[lo]) / seg : 0;
  return { x: path[lo].x + (path[hi].x - path[lo].x) * u, y: path[lo].y + (path[hi].y - path[lo].y) * u };
}

/** Fraction of the length at each vertex: [0, …, 1]. */
export function vertexFractions(path) {
  const acc = lengths(path), total = acc.at(-1) || 1;
  return acc.map((d) => d / total);
}

/**
 * A smooth curve through the points (centripetal Catmull-Rom), sampled as a polyline that starts at
 * the first point and ends exactly at the last. Coordinates are rounded to 0.01.
 */
export function smoothPath(points, perSegment = 12) {
  const pts = points.filter((p, i) => i === 0 || Math.hypot(p.x - points[i - 1].x, p.y - points[i - 1].y) > 1e-6);
  const r = (v) => Math.round(v * 100) / 100;
  if (pts.length < 3) return pts.map((p) => ({ x: r(p.x), y: r(p.y) }));
  const out = [{ x: r(pts[0].x), y: r(pts[0].y) }];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
    const t = (a, b) => Math.max(1e-6, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y))); // centripetal: no loops or cusps
    const t1 = t(p0, p1), t2 = t1 + t(p1, p2), t3 = t2 + t(p2, p3);
    for (let s = 1; s <= perSegment; s++) {
      const u = t1 + ((t2 - t1) * s) / perSegment;
      const lerp = (a, b, ta, tb) => ({ x: ((tb - u) * a.x + (u - ta) * b.x) / (tb - ta), y: ((tb - u) * a.y + (u - ta) * b.y) / (tb - ta) });
      const a1 = lerp(p0, p1, 0, t1), a2 = lerp(p1, p2, t1, t2), a3 = lerp(p2, p3, t2, t3);
      const b1 = lerp(a1, a2, 0, t2), b2 = lerp(a2, a3, t1, t3);
      const c = lerp(b1, b2, t1, t2);
      out.push({ x: r(c.x), y: r(c.y) });
    }
  }
  out[out.length - 1] = { x: r(pts.at(-1).x), y: r(pts.at(-1).y) };
  return out;
}

/** Ramer-Douglas-Peucker: drops points closer than `tolerance` to the line they'd be skipped over. */
export function simplify(points, tolerance = 4) {
  if (points.length < 3) return points.slice();
  const keep = new Array(points.length).fill(false);
  keep[0] = keep[points.length - 1] = true;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let worst = -1, at = -1;
    for (let i = a + 1; i < b; i++) {
      const d = distanceToSegment(points[i], points[a], points[b]);
      if (d > worst) { worst = d; at = i; }
    }
    if (worst > tolerance) { keep[at] = true; stack.push([a, at], [at, b]); }
  }
  return points.filter((_, i) => keep[i]);
}

/** How far the drag strays from the straight line between its ends (0 for a straight drag). */
export function bend(points) {
  if (points.length < 3) return 0;
  return Math.max(...points.map((p) => distanceToSegment(p, points[0], points.at(-1))));
}

function distanceToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy;
  const u = len2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}
