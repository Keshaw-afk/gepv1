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

/** Default fill: grey shapes, dark text (a grey caption would be hard to read). */
export const defaultColor = (shape) => (shape === 'text' ? '#333333' : '#cccccc');

/** Where the label's baseline sits, relative to the centre. */
export const labelDy = (shape) => (shape === 'triangle' ? 12 : 6);

/** Half the width and height of a shape: for hit tests and keeping it inside the canvas. */
export function halfSize(shape, label = '') {
  if (shape === 'rect') return { x: RECT.w / 2, y: RECT.h / 2 };
  if (shape === 'triangle') return { x: 28, y: 30 };
  if (shape === 'text') return { x: Math.max(12, String(label).length * 5), y: 11 };
  return { x: RADIUS, y: RADIUS };
}

/** Is point p inside the shape centred at (x, y)? */
export function hits(shape, label, x, y, p) {
  if (shape === 'circle') return Math.hypot(p.x - x, p.y - y) <= RADIUS;
  const h = halfSize(shape, label);
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
