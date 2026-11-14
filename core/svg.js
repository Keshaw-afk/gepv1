// SVG renderer: one scene state -> one SVG document (string).
// Used for video frames, the in-page preview, and the GUI editor.

import { CANVAS, NODE_RADIUS } from './scene.js';
import { contrastText, parseColor, toHex } from './colors.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const n = (v) => Math.round(v * 100) / 100;
// Always emit hex so "red" means the engine's palette red, not the browser's CSS red
// (otherwise the last frame of a tween would jump to a different shade).
export const paint = (c) => { const rgb = parseColor(c); return rgb ? toHex(rgb) : '#000000'; };

/**
 * opts.selected   id to highlight (editor)
 * opts.interactive  add data-id attributes and wide invisible hit areas for edges (editor)
 * opts.ghost      {x1, y1, x2, y2} dashed line while dragging out a new edge (editor)
 */
export function renderSVG(state, opts = {}) {
  const { width, height } = CANVAS;
  const byId = new Map(state.nodes.map((nd) => [nd.id, nd]));
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`); // opaque background for video

  for (const e of state.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    const xy = `x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"`;
    if (opts.selected === e.id) out.push(`<line ${xy} stroke="#4f8ef7" stroke-width="9" stroke-opacity="0.45"/>`);
    out.push(`<line ${xy} stroke="${paint(e.color)}" stroke-width="3" stroke-linecap="round"/>`);
    if (opts.interactive) out.push(`<line ${xy} stroke="transparent" stroke-width="14" data-id="${e.id}"/>`);
  }

  if (opts.ghost) {
    const g = opts.ghost;
    out.push(`<line x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}" stroke="#4f8ef7" stroke-width="2" stroke-dasharray="6 4"/>`);
  }

  for (const nd of state.nodes) {
    const id = opts.interactive ? ` data-id="${nd.id}"` : '';
    if (opts.selected === nd.id) out.push(`<circle cx="${n(nd.x)}" cy="${n(nd.y)}" r="${NODE_RADIUS + 6}" fill="none" stroke="#4f8ef7" stroke-width="3"/>`);
    out.push(`<circle cx="${n(nd.x)}" cy="${n(nd.y)}" r="${NODE_RADIUS}" fill="${paint(nd.color)}" stroke="#333333" stroke-width="2"${id}/>`);
    out.push(`<text x="${n(nd.x)}" y="${n(nd.y + 6)}" text-anchor="middle" font-family="sans-serif" font-size="17" font-weight="bold" fill="${contrastText(nd.color)}" pointer-events="none">${esc(nd.label)}</text>`);
  }

  out.push('</svg>');
  return out.join('\n');
}
