// SVG renderer: one scene state -> one SVG document (string).
//
// Every object is a group drawn around its centre and placed with one translate() (plus a scale()
// when it isn't normal size), so moving any shape is a single transform. Two flavours of the same picture:
//   export (still frames, video frames, "SVG of this frame"): every object has an id and a class,
//     shared styling sits in one <style> block, one element per line, so the file is easy to read,
//     restyle with CSS, script or edit by object:
//       <line id="A-B" class="edge" x1=… stroke="#888888"/>
//       <polyline id="A-C" class="edge arrow" points=… marker-mid="url(#arrowhead)"/>
//       <g id="A" class="node circle" transform="translate(100 180)"><circle r="24" …/><text …>A</text></g>
//       <g id="B" class="node rect" transform="translate(300 90) scale(1.5)">…</g>      (size 1.5)
//   inline (the editor and preview inside the page): plain presentation attributes, no ids and no
//     <style>, because inline SVG shares the page's DOM (an id "time" or a .node rule would leak).

import { CANVAS, GRID } from './scene.js';
import { contrastText, parseColor, toHex } from './colors.js';
import { DEFAULT_OUTPUT } from './output.js';
import { RADIUS, FONT_SIZE, halfSize, labelDy, outline, defaultColor, sizeOf, labelScale, isUniform } from './shapes.js';

export const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
export const n = (v) => Math.round(v * 100) / 100;
// Always emit hex so "red" means the engine's palette red, not the browser's CSS red
// (otherwise the last frame of a tween would jump to a different shade).
export const paint = (c) => { const rgb = parseColor(c); return rgb ? toHex(rgb) : '#000000'; };

export const ARROWHEAD_ID = 'arrowhead';

const SAFE_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * SVG ids for the objects: a node's label when it's a safe, unused name (else node-<id>), and
 * "A-B" for an edge (a second edge between the same pair later on is "A-B-2"). Pass every object
 * in creation order, including ones removed later (see timelineIds): an id then depends only on
 * objects created before it, so ids are the same in every frame and in the animated SVG.
 */
export function svgIds(nodes, edges) {
  const ids = new Map(), used = new Set([ARROWHEAD_ID]);
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

const idCache = new WeakMap();
/** Ids for every object a timeline ever creates (cached per timeline). */
export function timelineIds(timeline) {
  if (!idCache.has(timeline)) {
    const creates = timeline.commands.filter((c) => c.op === 'create');
    idCache.set(timeline, svgIds(
      creates.filter((c) => c.kind === 'node').map((c) => ({ id: c.id, label: c.props.label })),
      creates.filter((c) => c.kind === 'edge').map((c) => ({ id: c.id, a: c.props.a, b: c.props.b })),
    ));
  }
  return idCache.get(timeline);
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
    '  .edge { fill: none; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round }',
    '  .node circle, .node rect, .node polygon { stroke: #333333; stroke-width: 2 }',
    `  .node text { font-family: ${o.font}; font-size: ${FONT_SIZE}px; font-weight: bold; text-anchor: middle }`,
    '</style>',
  ];
}

/** The arrowhead marker (only when there are arrows). It takes the arrow's colour (context-stroke). */
export function arrowDefs() {
  return [
    '<defs>',
    `  <marker id="${ARROWHEAD_ID}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto">`,
    '    <path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/>',
    '  </marker>',
    '</defs>',
  ];
}

export function backgroundRect(o, exported) {
  if (o.background === 'transparent') return [];
  const { width, height } = CANVAS;
  return [`<rect${exported ? ' class="background"' : ''} width="${width}" height="${height}" fill="${o.background}"/>`];
}

export const translate = (x, y) => `translate(${n(x)} ${n(y)})`;
export const n3 = (v) => Math.round(v * 1000) / 1000;
/**
 * Where an object goes: its centre, scaled about the centre when it is bigger or smaller the same
 * both ways. A shape stretched more one way than the other scales its outline (outlineScale) and,
 * by the smaller factor, its label (labelTransform), so the label never stretches.
 */
export const placement = (x, y, size = 1) => {
  const z = sizeOf(size);
  return `${translate(x, y)}${z.w === z.h && z.w !== 1 ? ` scale(${n3(z.w)})` : ''}`;
};
export const outlineScale = (size) => { const z = sizeOf(size); return z.w === z.h ? '' : ` transform="scale(${n3(z.w)} ${n3(z.h)})"`; };
export const labelTransform = (size) => (isUniform(size) || labelScale(size) === 1 ? '' : ` transform="scale(${n3(labelScale(size))})"`);
/** An arrow's points: start, middle (where the arrowhead sits), end. */
export const arrowPoints = (a, b) => `${n(a.x)},${n(a.y)} ${n((a.x + b.x) / 2)},${n((a.y + b.y) / 2)} ${n(b.x)},${n(b.y)}`;
/** Text colour on a shape: black or white for contrast; a text shape is coloured itself. */
export const labelFill = (shape, color) => (shape === 'text' ? paint(color) : contrastText(color));
const fillOf = (nd) => paint(nd.color ?? defaultColor(nd.shape));

// The arrowhead drawn directly (inline flavour), the same size and place as the marker.
function arrowheadPolygon(a, b, color) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x), c = Math.cos(ang), s = Math.sin(ang);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const pt = (x, y) => `${n(mx + x * c - y * s)},${n(my + x * s + y * c)}`;
  return `<polygon points="${pt(6, 0)} ${pt(-6, -6)} ${pt(-6, 6)}" fill="${color}"/>`;
}

/**
 * opts.output      output settings (size, background, font); see output.js
 * opts.export      export flavour (ids, classes, <style>); otherwise inline flavour
 * opts.ids         Map(object id -> SVG id), e.g. timelineIds(timeline) (export; default: from state)
 * opts.comment     a comment at the top, e.g. which frame this is (export)
 * opts.selected    id, or a Set / array of ids, to highlight (editor)
 * opts.grid        faint dots at the snap points (editor)
 * opts.handle      show the resize handles (width, height, corner) of the one selected node (editor)
 * opts.lasso       [{x, y}, …] the free-hand loop being drawn to select several (editor)
 * opts.interactive add data-id attributes and wide invisible hit areas (editor)
 * opts.ghost       {x1, y1, x2, y2} dashed line while dragging out a new edge (editor)
 * opts.fresh       id of an object that just appeared (editor: it pops in)
 * opts.trails      [[{x, y}, …]] faint dashed paths of moves (editor, Behaviour)
 */
export function renderSVG(state, opts = {}) {
  const o = { ...DEFAULT_OUTPUT, ...opts.output };
  const ex = !!opts.export;
  const byId = new Map(state.nodes.map((nd) => [nd.id, nd]));
  const sel = new Set(opts.selected == null ? [] : typeof opts.selected === 'object' ? opts.selected : [opts.selected]);
  const ids = ex ? (opts.ids ?? svgIds(state.nodes, state.edges)) : null;
  const out = [svgOpen(o)];
  const body = [];
  if (ex && opts.comment) body.push(`<!-- ${esc(opts.comment)} -->`);
  if (ex) body.push(...styleBlock(o));
  if (ex && state.edges.some((e) => e.directed)) body.push(...arrowDefs());
  body.push(...backgroundRect(o, ex));
  if (opts.grid && !ex) {
    const dot = (x, y) => `<circle cx="${x}" cy="${y}" r="1.2" fill="#c4c9d1"/>`;
    body.push(`<defs><pattern id="gepv1-grid" width="${GRID}" height="${GRID}" patternUnits="userSpaceOnUse">${dot(0, 0)}${dot(GRID, 0)}${dot(0, GRID)}${dot(GRID, GRID)}</pattern></defs>`,
      `<rect width="${CANVAS.width}" height="${CANVAS.height}" fill="url(#gepv1-grid)" pointer-events="none"/>`);
  }

  for (const pts of opts.trails ?? []) {
    const to = pts.at(-1);
    body.push(`<polyline points="${pts.map((p) => `${n(p.x)},${n(p.y)}`).join(' ')}" fill="none" stroke="#e5484d" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round" stroke-linejoin="round" opacity="0.6"/>`,
      `<circle cx="${n(to.x)}" cy="${n(to.y)}" r="3.5" fill="#e5484d" opacity="0.6"/>`);
  }

  for (const e of state.edges) {
    const a = byId.get(e.a), b = byId.get(e.b);
    if (!a || !b) continue;
    const stroke = paint(e.color);
    const xy = `x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}"`;
    if (sel.has(e.id)) body.push(`<line ${xy} stroke="#4f8ef7" stroke-width="9" stroke-opacity="0.45" stroke-linecap="round"/>`);
    if (ex) {
      body.push(e.directed
        ? `<polyline id="${esc(ids.get(e.id))}" class="edge arrow" points="${arrowPoints(a, b)}" stroke="${stroke}" marker-mid="url(#${ARROWHEAD_ID})"/>`
        : `<line id="${esc(ids.get(e.id))}" class="edge" ${xy} stroke="${stroke}"/>`);
    } else {
      body.push(`<line ${xy} stroke="${stroke}" stroke-width="3" stroke-linecap="round"/>`);
      if (e.directed) body.push(arrowheadPolygon(a, b, stroke));
    }
    if (opts.interactive) body.push(`<line ${xy} stroke="transparent" stroke-width="14" data-id="${e.id}"/>`);
  }

  if (opts.ghost) {
    const g = opts.ghost;
    body.push(`<line x1="${n(g.x1)}" y1="${n(g.y1)}" x2="${n(g.x2)}" y2="${n(g.y2)}" stroke="#4f8ef7" stroke-width="2" stroke-dasharray="6 4"/>`);
  }

  for (const nd of state.nodes) {
    const shape = nd.shape ?? 'circle';
    const fill = fillOf(nd);
    const dy = labelDy(shape);
    const label = esc(nd.label);
    if (ex) {
      const lines = [`<g id="${esc(ids.get(nd.id))}" class="node ${shape}" transform="${placement(nd.x, nd.y, nd.size)}">`];
      if (shape !== 'text') lines.push(`  ${outline(shape, ` fill="${fill}"${outlineScale(nd.size)}`)}`);
      lines.push(`  <text y="${dy}"${labelTransform(nd.size)} fill="${labelFill(shape, nd.color)}">${label}</text>`, '</g>');
      body.push(...lines);
      continue;
    }
    const data = opts.interactive ? ` data-id="${nd.id}"` : '';
    const cls = opts.fresh === nd.id ? ' class="pop"' : '';
    const parts = [];
    const uniform = isUniform(nd.size);
    if (sel.has(nd.id)) {
      // inside a uniformly scaled group the ring is drawn at normal size; otherwise at the real size
      const h = halfSize(shape, nd.label, uniform ? 1 : nd.size);
      parts.push(shape === 'circle'
        ? `<ellipse rx="${n(h.x + 6)}" ry="${n(h.y + 6)}" fill="none" stroke="#4f8ef7" stroke-width="3"/>`
        : `<rect x="${n(-h.x - 6)}" y="${n(-h.y - 6)}" width="${n(2 * h.x + 12)}" height="${n(2 * h.y + 12)}" rx="8" fill="none" stroke="#4f8ef7" stroke-width="3"/>`);
    }
    if (shape === 'text') {
      const h = halfSize(shape, nd.label);
      if (opts.interactive) parts.push(`<rect x="${-h.x}" y="${-h.y}" width="${2 * h.x}" height="${2 * h.y}" fill="transparent"${labelTransform(nd.size)}${data}/>`);
    } else {
      parts.push(outline(shape, ` fill="${fill}" stroke="#333333" stroke-width="2"${outlineScale(nd.size)}${data}`));
    }
    parts.push(`<text y="${dy}"${labelTransform(nd.size)} text-anchor="middle" font-family="${o.font}" font-size="${FONT_SIZE}" font-weight="bold" fill="${labelFill(shape, nd.color)}" pointer-events="none">${label}</text>`);
    // the pop-in class goes on an inner group: a CSS transform on the outer one would replace its translate
    body.push(`<g transform="${placement(nd.x, nd.y, nd.size)}">${cls ? `<g${cls}>${parts.join('')}</g>` : parts.join('')}</g>`);
  }

  // editor furniture, drawn on top at a constant size: the resize handles and the lasso
  if (opts.handle && sel.size === 1) {
    const nd = byId.get([...sel][0]);
    if (nd) {
      const shape = nd.shape ?? 'circle';
      const h = halfSize(shape, nd.label, nd.size ?? 1);
      const handle = (x, y, kind, cursor, round) => `<rect x="${n(x - 5.5)}" y="${n(y - 5.5)}" width="11" height="11" rx="${round ? 5.5 : 2}" fill="#ffffff" stroke="#4f8ef7" stroke-width="2" data-handle="${kind}" style="cursor:${cursor}"/>`;
      if (shape !== 'text') { // a text shape is only its label, which never stretches
        body.push(handle(nd.x + h.x + 8, nd.y, 'w', 'ew-resize', true), handle(nd.x, nd.y + h.y + 8, 'h', 'ns-resize', true));
      }
      body.push(handle(nd.x + h.x + 8, nd.y + h.y + 8, 'corner', 'nwse-resize', false));
    }
  }
  if (opts.lasso?.length > 1) {
    const d = opts.lasso.map((p, i) => `${i ? 'L' : 'M'}${n(p.x)} ${n(p.y)}`).join(' ');
    body.push(`<path d="${d} Z" fill="#4f8ef7" fill-opacity="0.08" stroke="#4f8ef7" stroke-width="1.5" stroke-dasharray="5 4" stroke-linejoin="round" pointer-events="none"/>`);
  }

  out.push(...(ex ? body.map((l) => '  ' + l) : body), '</svg>');
  return out.join('\n') + (ex ? '\n' : '');
}
