// Shapes: geometry shared by the renderer, the editor (hit tests, keeping shapes on the canvas)
// and layouts. Every shape is drawn around its centre (x, y), so moving it is one translate().
//
//   circle    node(label, x, y)       a circle with the label inside
//   rect      rect(label, x, y)       a rounded rectangle with the label inside
//   triangle  triangle(label, x, y)   a triangle pointing up, label in its wider lower part
//   text      text("Hello", x, y)     just the text; colour() colours the text itself

export const SHAPES = ['circle', 'rect', 'triangle', 'text'];

export const RADIUS = 24;                       // circle
export const RECT = { w: 64, h: 40, rx: 6 };    // rect
export const TRIANGLE = '0,-30 28,18 -28,18';   // triangle points (centroid near the origin)
export const FONT_SIZE = 17;

/**
 * Size is a scale factor per direction: { w, h }, 1 is the normal size, 2 is twice as wide or tall.
 * A plain number means the same factor both ways (older data and the short Lua form).
 * The label never stretches: it grows with the smaller of the two (labelScale), and so does a text
 * shape, which is only its label.
 */
export const SIZE = { min: 0.25, max: 5, default: 1 };

export function sizeOf(s) {
  if (typeof s === 'number') return { w: s, h: s };
  return { w: s?.w ?? 1, h: s?.h ?? 1 };
}
export const labelScale = (s) => { const z = sizeOf(s); return Math.min(z.w, z.h); };
export const isUniform = (s) => { const z = sizeOf(s); return z.w === z.h; };
export const sameSize = (a, b) => { const x = sizeOf(a), y = sizeOf(b); return x.w === y.w && x.h === y.h; };

/** Default fill: grey shapes, dark text (a grey caption would be hard to read). */
export const defaultColor = (shape) => (shape === 'text' ? '#333333' : '#cccccc');

/** Where the label's baseline sits, relative to the centre. */
export const labelDy = (shape) => (shape === 'triangle' ? 12 : 6);

/** Half the width and height of a shape at this size: for hit tests and keeping it on the canvas. */
export function halfSize(shape, label = '', size = 1) {
  const z = shape === 'text' ? { w: labelScale(size), h: labelScale(size) } : sizeOf(size);
  let h = { x: RADIUS, y: RADIUS };
  if (shape === 'rect') h = { x: RECT.w / 2, y: RECT.h / 2 };
  else if (shape === 'triangle') h = { x: 28, y: 30 };
  else if (shape === 'text') h = { x: Math.max(12, String(label).length * 5), y: 11 };
  return { x: h.x * z.w, y: h.y * z.h };
}

/** Is point p inside the shape centred at (x, y)? */
export function hits(shape, label, x, y, p, size = 1) {
  if (shape === 'circle') {
    const z = sizeOf(size);
    return ((p.x - x) / (RADIUS * z.w)) ** 2 + ((p.y - y) / (RADIUS * z.h)) ** 2 <= 1;
  }
  const h = halfSize(shape, label, size);
  return Math.abs(p.x - x) <= h.x && Math.abs(p.y - y) <= h.y;
}

/** The outline element of a shape at the origin (nothing for text), e.g. <circle r="24" …/>. */
export function outline(shape, attrs) {
  if (shape === 'rect') return `<rect x="${-RECT.w / 2}" y="${-RECT.h / 2}" width="${RECT.w}" height="${RECT.h}" rx="${RECT.rx}"${attrs}/>`;
  if (shape === 'triangle') return `<polygon points="${TRIANGLE}"${attrs}/>`;
  if (shape === 'text') return '';
  return `<circle r="${RADIUS}"${attrs}/>`;
}

/** The SVG element name of the outline (what colour animations target). */
export const outlineTag = (shape) => ({ circle: 'circle', rect: 'rect', triangle: 'polygon' })[shape] ?? 'text';
