// Easing for moves: 'linear' (the default) or 'smooth' (slow in, slow out).
// 'smooth' is cubic-bezier(0.42, 0, 0.58, 1), CSS's ease-in-out. The animated SVG uses the same curve
// as SMIL keySplines, so the browser and the player move objects the same way.

export const EASES = { linear: null, smooth: [0.42, 0, 0.58, 1] };

const bezier = (a, b, s) => 3 * a * s * (1 - s) ** 2 + 3 * b * s * s * (1 - s) + s ** 3;

/** Eased progress for linear progress f (0..1). */
export function ease(name, f) {
  const c = EASES[name];
  if (!c || f <= 0 || f >= 1) return f;
  // find s with x(s) = f by bisection (x is monotonic), then return y(s)
  let lo = 0, hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (bezier(c[0], c[2], mid) < f) lo = mid; else hi = mid;
  }
  return bezier(c[1], c[3], (lo + hi) / 2);
}

/** SMIL attributes for an eased <animate>, or '' for linear. */
export const smilEase = (name) => (EASES[name] ? ` calcMode="spline" keyTimes="0;1" keySplines="${EASES[name].join(' ')}"` : '');
