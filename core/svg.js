// SVG renderer: one scene state -> one SVG document (string).
//
// Two flavours of the same picture:
//   export (still frames, video frames, "SVG of this frame"): every object has an id and a class,
//     shared styling sits in one <style> block, one element per line, so the file is easy to read,
//     restyle with CSS, script or edit by object:
//       <line id="A-B" class="edge" x1=… stroke="#888888"/>
//       <g id="A" class="node"><circle …/><text …>A</text></g>
//   inline (the editor and preview inside the page): plain presentation attributes, no ids and no
//     <style>, because inline SVG shares the page's DOM (an id "time" or a .node rule would leak).

import { CANVAS, NODE_RADIUS } from './scene.js';
import { contrastText, parseColor, toHex } from './colors.js';
import { DEFAULT_OUTPUT } from './output.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
export const n = (v) => Math.round(v * 100) / 100;
// Always emit hex so "red" means the engine's palette red, not the browser's CSS red
// (otherwise the last frame of a tween would jump to a different shade).
export const paint = (c) => { const rgb = parseColor(c); return rgb ? toHex(rgb) : '#000000'; };

const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * SVG ids for the objects: a node's label when it's a safe, unused name (else node-<id>), and
 * "A-B" for an edge. Pass objects in creation order: an id depends only on objects created before
 * it, so ids stay the same in every frame even when objects appear later.
 */
export function svgIds(nodes, edges) {
  const ids = new Map(), used = new Set();
  const claim = (key, want) => {
    let id = want;
    for (let k = 2; used.has(id); k++) id = `${want}-${k}`;
    used.add(id);
    ids.set(key, id);
  };
  for (const nd of nodes) claim(nd.id, SAFE_ID.test(nd.label) && !used.has(nd.label) ? nd.label : `node-${nd.id}`);
  for (const e of edges) claim(e.id, `${ids.get(e.a)}-${ids.get(e.b)}`);
  return ids;
}

/** Root element: drawn in 640×360 units, output at scale × that size. */
export function svgOpen(o) {
  const { width, height } = CANVAS;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width * o.scale}" height="${height * o.scale}" viewBox="0 0 ${width} ${height}">`;
}

/** Shared styling for the export flavour. Per-object colours stay attributes (CSS would override them). */
export function styleBlock(o) {
  return [
    '<style>',
    '  .edge { stroke-width: 3; stroke-linecap: round }',
    '  .node circle { stroke: #333333; stroke-width: 2 }',
    `  .node text { font-family: ${o.font}; font-size: 17px; font-weight: bold; text-anchor: middle }`,
    '</style>',
  ];
}

export function backgroundRect(o, exported) {
  if (o.background === 'transparent') return [];
  const { width, height } = CANVAS;
  return [`<rect${exported ? ' class="background"' : ''} width="${width}" height="${height}" fill="${o.background}"/>`];
}

/**
 * opts.output      output settings (size, background, font); see output.js
 * opts.export      export flavour (ids, classes, <style>); otherwise inline flavour
 * opts.comment     a comment at the top, e.g. which frame this is (export)
 * opts.selected    id to highlight (editor)
 * opts.interactive add data-id attributes and wide invisible hit areas for edges (editor)
 * opts.ghost       {x1, y1, x2, y2} dashed line while dragging out a new edge (editor)
 */
export function renderSVG(state, opts = {}) {
  const o = { ...DEFAULT_OUTPUT, ...opts.output };
  const ex = !!opts.export;
  const byId = new Map(state.nodes.map((nd) => [nd.id, nd]));
  const ids = ex ? svgIds(state.nodes, state.edges) : null;
  const out = [svgOpen(o)];
  const body = [];
  if (ex && opts.comment) body.push(`<!-- ${esc(opts.comment)} -->`);
  if (ex) body.push(...styleBlock(o));
  body.push(...backgroundRect(o, ex));

  for (const e of state.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    const xy = `x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"`;
    if (opts.selected === e.id) body.push(`<line ${xy} stroke="#4f8ef7" stroke-width="9" stroke-opacity="0.45"/>`);
    body.push(ex
      ? `<line id="${esc(ids.get(e.id))}" class="edge" ${xy} stroke="${paint(e.color)}"/>`
      : `<line ${xy} stroke="${paint(e.color)}" stroke-width="3" stroke-linecap="round"/>`);
    if (opts.interactive) body.push(`<line ${xy} stroke="transparent" stroke-width="14" data-id="${e.id}"/>`);
  }

  if (opts.ghost) {
    const g = opts.ghost;
    body.push(`<line x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}" stroke="#4f8ef7" stroke-width="2" stroke-dasharray="6 4"/>`);
  }

  for (const nd of state.nodes) {
    const c = `cx="${n(nd.x)}" cy="${n(nd.y)}" r="${NODE_RADIUS}" fill="${paint(nd.color)}"`;
    const t = `x="${n(nd.x)}" y="${n(nd.y + 6)}"`;
    if (ex) {
      body.push(`<g id="${esc(ids.get(nd.id))}" class="node">`,
        `  <circle ${c}/>`,
        `  <text ${t} fill="${contrastText(nd.color)}">${esc(nd.label)}</text>`,
        '</g>');
      continue;
    }
    const id = opts.interactive ? ` data-id="${nd.id}"` : '';
    if (opts.selected === nd.id) body.push(`<circle cx="${n(nd.x)}" cy="${n(nd.y)}" r="${NODE_RADIUS + 6}" fill="none" stroke="#4f8ef7" stroke-width="3"/>`);
    body.push(`<circle ${c} stroke="#333333" stroke-width="2"${id}/>`);
    body.push(`<text ${t} text-anchor="middle" font-family="${o.font}" font-size="17" font-weight="bold" fill="${contrastText(nd.color)}" pointer-events="none">${esc(nd.label)}</text>`);
  }

  out.push(...(ex ? body.map((l) => '  ' + l) : body), '</svg>');
  return out.join('\n') + (ex ? '\n' : '');
}
