import { ToolError } from '../ai_tools.js';

/** A list argument: accepts a real array or a JSON string of one. */
export function listOf(v, what) {
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { v = v.split(',').map((s) => s.trim()).filter(Boolean); }
  }
  if (!Array.isArray(v)) throw new ToolError(`${what} must be a list, e.g. ["A", "B"].`);
  return v;
}

/** A list of pairs: [["A", "B"], …] (also "A-B" strings). */
export function pairsOf(v, what) {
  return listOf(v, what).map((e, i) => {
    const pair = typeof e === 'string' ? e.split(/\s*(?:-|->|→|–)\s*/) : Array.isArray(e) ? e : [e?.from ?? e?.parent, e?.to ?? e?.child];
    if (pair.length !== 2 || pair.some((x) => x === undefined || x === '')) throw new ToolError(`${what} entry ${i + 1} must be a pair like ["A", "B"].`);
    return pair.map(String);
  });
}

/** Points along a parabola-like arc from a to b bulging `lift` px (up when positive), n inside points. */
export function arc(a, b, lift, n = 5) {
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const nx = dy / len, ny = -dx / len; // left of the direction of travel
  return Array.from({ length: n }, (_, k) => {
    const t = (k + 1) / (n + 1), h = 4 * t * (1 - t) * lift;
    return { x: Math.round(a.x + dx * t + nx * h), y: Math.round(a.y + dy * t + ny * h) };
  });
}
