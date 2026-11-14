// Colour parsing and interpolation. Colours are strings ("red", "#f00", "#ff0000").

const NAMED = {
  black: '#000000', white: '#ffffff', red: '#e53935', green: '#43a047',
  blue: '#1e88e5', yellow: '#fdd835', orange: '#fb8c00', purple: '#8e24aa',
  pink: '#ec407a', cyan: '#00acc1', magenta: '#d81b60', brown: '#6d4c41',
  lime: '#c0ca33', navy: '#283593', teal: '#00897b',
  grey: '#9e9e9e', gray: '#9e9e9e', lightgrey: '#cccccc', lightgray: '#cccccc',
  darkgrey: '#555555', darkgray: '#555555',
};

/** Returns [r, g, b] (0..255) or null if the colour is not recognised. */
export function parseColor(c) {
  if (typeof c !== 'string') return null;
  let s = c.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  let m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(s);
  if (m) return m.slice(1).map((h) => parseInt(h + h, 16));
  m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/.exec(s);
  if (m) return m.slice(1).map((h) => parseInt(h, 16));
  return null;
}

export function toHex([r, g, b]) {
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
}

/** Blend colour a towards b by fraction f (0..1). Returns a hex string. */
export function mixColor(a, b, f) {
  const ca = parseColor(a), cb = parseColor(b);
  return toHex(ca.map((v, i) => v + (cb[i] - v) * f));
}

/** Black or white, whichever reads better on top of colour c. */
export function contrastText(c) {
  const [r, g, b] = parseColor(c) ?? [255, 255, 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#000000' : '#ffffff';
}
