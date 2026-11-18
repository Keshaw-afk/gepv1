// Animated SVG: the whole timeline as ONE .svg file that plays by itself in a browser,
// using SVG's built-in animation elements (<animate>, <animateTransform>, <set>). It plays once and
// then holds the last frame.
//
// It uses the same resolved tweens as the player (tweens() in player.js), so it shows exactly
// what the preview and the MP4 show:
//   colour tween  -> <animate attributeName="fill|stroke"> (+ the label flips black/white)
//   size tween    -> <animateTransform type="scale"> on an inner group (only objects that are ever
//                    not normal size get one, so a size animation never fights the move animation)
//   move tween    -> <animateTransform type="translate"> on the object's group (eased moves use the
//                    same curve as SMIL keySplines) and <animate> on the ends of every line touching it
//   arrow         -> its points (start, middle, end) sampled every 10 ms while either end moves,
//                    and set at once when an end jumps
//   create at t>0 -> hidden until t; remove -> hidden from t (<set attributeName="visibility">)
// When two animations overlap, the one that starts later wins, which matches the player.
// Ids, classes and <style> are the same as a still frame's (export flavour in svg.js).

import { tweens, positionsOf } from './player.js';
import { contrastText, mixColor } from './colors.js';
import { DEFAULT_OUTPUT } from './output.js';
import { smilEase } from './easing.js';
import { outline, outlineTag, labelDy } from './shapes.js';
import { paint, esc, n, n3, timelineIds, svgOpen, styleBlock, arrowDefs, backgroundRect, translate, arrowPoints, labelFill, ARROWHEAD_ID } from './svg.js';

const SAMPLE_MS = 10;
const s = (ms) => `${ms / 1000}s`; // times are whole ms

const set = (attr, to, t) => `<set attributeName="${attr}" to="${to}" begin="${s(t)}" fill="freeze"/>`;
function animate(attr, from, to, t0, dur, ease = 'linear') {
  if (dur === 0) return set(attr, to, t0); // instant change (dur 0 isn't a valid SMIL duration)
  return `<animate attributeName="${attr}" from="${from}" to="${to}" begin="${s(t0)}" dur="${s(dur)}"${smilEase(ease)} fill="freeze"/>`;
}
function animateMove(from, to, t0, dur, ease) {
  const f = `${n(from.x)} ${n(from.y)}`, t = `${n(to.x)} ${n(to.y)}`;
  if (dur === 0) return `<animateTransform attributeName="transform" type="translate" from="${t}" to="${t}" begin="${s(t0)}" dur="0.001s" fill="freeze"/>`;
  return `<animateTransform attributeName="transform" type="translate" from="${f}" to="${t}" begin="${s(t0)}" dur="${s(dur)}"${smilEase(ease)} fill="freeze"/>`;
}

function animateScale(from, to, t0, dur, ease) {
  if (dur === 0) return `<animateTransform attributeName="transform" type="scale" from="${n3(to)}" to="${n3(to)}" begin="${s(t0)}" dur="0.001s" fill="freeze"/>`;
  return `<animateTransform attributeName="transform" type="scale" from="${n3(from)}" to="${n3(to)}" begin="${s(t0)}" dur="${s(dur)}"${smilEase(ease)} fill="freeze"/>`;
}

// When does the label switch between black and white text during a colour tween? (or null)
function contrastFlip(tw) {
  const start = contrastText(tw.from);
  if (contrastText(tw.to) === start) return null;
  if (tw.dur === 0) return tw.t0;
  for (let i = 1; i <= 100; i++) {
    if (contrastText(mixColor(tw.from, tw.to, i / 100)) !== start) return tw.t0 + (tw.dur * i) / 100;
  }
  return tw.t0 + tw.dur;
}

/** Time ranges [t0, t1] in which any of the given nodes moves, merged where they overlap. */
function movingRanges(moves, ids) {
  const r = moves.filter((m) => ids.includes(m.id) && m.dur > 0).map((m) => [m.t0, m.t0 + m.dur]).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const x of r) {
    if (out.length && x[0] <= out.at(-1)[1]) out.at(-1)[1] = Math.max(out.at(-1)[1], x[1]);
    else out.push([...x]);
  }
  return out;
}

export function renderAnimatedSVG(timeline, output = {}) {
  const o = { ...DEFAULT_OUTPUT, ...output };
  const creates = timeline.commands.filter((c) => c.op === 'create');
  const removed = new Map(timeline.commands.filter((c) => c.op === 'remove').map((c) => [c.id, c.t]));
  const nodes = creates.filter((c) => c.kind === 'node');
  const edges = creates.filter((c) => c.kind === 'edge');
  const shapeOf = new Map(nodes.map((c) => [c.id, c.props.shape ?? 'circle']));
  const ids = timelineIds(timeline);
  const posAt = positionsOf(timeline);

  // Child animation elements for every SVG element we draw: the node's group (moves), its outline
  // (colour), its label (contrast flips; colour for a text shape), and edges.
  const kids = { group: new Map(), scale: new Map(), outline: new Map(), text: new Map(), edge: new Map() };
  const add = (kind, id, el) => { if (!kids[kind].has(id)) kids[kind].set(id, []); kids[kind].get(id).push(el); };

  const all = tweens(timeline);
  const moves = all.filter((tw) => tw.prop === 'pos');
  for (const [i, tw] of all.entries()) {
    const shape = shapeOf.get(tw.id);
    if (tw.prop === 'color') {
      if (!shape) { add('edge', tw.id, animate('stroke', paint(tw.from), paint(tw.to), tw.t0, tw.dur)); continue; }
      if (shape === 'text') { add('text', tw.id, animate('fill', paint(tw.from), paint(tw.to), tw.t0, tw.dur)); continue; }
      add('outline', tw.id, animate('fill', paint(tw.from), paint(tw.to), tw.t0, tw.dur));
      const flip = contrastFlip(tw);
      // skip the flip if a later colour change on this node starts first (it decides the text)
      const overtaken = all.slice(i + 1).some((x) => x.id === tw.id && x.prop === 'color' && x.t0 < flip);
      if (flip !== null && !overtaken) add('text', tw.id, set('fill', contrastText(tw.to), flip));
    } else if (tw.prop === 'size') {
      add('scale', tw.id, animateScale(tw.from, tw.to, tw.t0, tw.dur, tw.ease));
    } else if (tw.prop === 'pos') {
      const { from: f, to } = tw;
      add('group', tw.id, animateMove(f, to, tw.t0, tw.dur, tw.ease));
      for (const e of edges) {
        if (e.props.directed) continue; // arrows are sampled below
        for (const end of ['a', 'b']) {
          if (e.props[end] !== tw.id) continue;
          const k = end === 'a' ? 1 : 2;
          add('edge', e.id, animate(`x${k}`, n(f.x), n(to.x), tw.t0, tw.dur, tw.ease));
          add('edge', e.id, animate(`y${k}`, n(f.y), n(to.y), tw.t0, tw.dur, tw.ease));
        }
      }
    }
  }
  // Arrows: the middle point depends on both ends, so sample the points while either end moves
  // (every 10 ms, plus a jump at each instant move inside that time); an instant move outside it
  // is a <set>.
  for (const e of edges.filter((x) => x.props.directed)) {
    const { a, b } = e.props;
    const at = (t) => arrowPoints(posAt(a, t), posAt(b, t));
    const ranges = movingRanges(moves, [a, b]);
    const jumps = moves.filter((m) => (m.id === a || m.id === b) && m.dur === 0).map((m) => m.t0);
    for (const t of jumps) if (!ranges.some(([t0, t1]) => t > t0 && t < t1)) add('edge', e.id, set('points', at(t), t));
    for (const [t0, t1] of ranges) {
      const samples = []; // [time, points]
      const inside = jumps.filter((t) => t > t0 && t < t1);
      const times = new Set([t1, ...inside]);
      for (let t = t0; t < t1; t += SAMPLE_MS) times.add(t);
      for (const t of [...times].sort((x, y) => x - y)) {
        if (inside.includes(t)) samples.push([t, at(t - 0.001)]); // just before the jump
        samples.push([t, at(t)]);
      }
      const values = samples.map(([, v]) => v).join(';');
      const keyTimes = samples.map(([t]) => Number(((t - t0) / (t1 - t0)).toFixed(6))).join(';');
      add('edge', e.id, `<animate attributeName="points" values="${values}" keyTimes="${keyTimes}" begin="${s(t0)}" dur="${s(t1 - t0)}" fill="freeze"/>`);
    }
  }

  // Created after t=0: hidden until then. Removed: hidden from then on.
  const visibility = (c) => [
    ...(c.t > 0 ? [set('visibility', 'visible', c.t)] : []),
    ...(removed.has(c.id) ? [set('visibility', 'hidden', removed.get(c.id))] : []),
  ];
  const hidden = (c) => (c.t > 0 ? ' visibility="hidden"' : '');
  // An element with animation children; pad = its indentation. (Never used for <text>: whitespace
  // inside <text> would be drawn.)
  const el = (open, close, list, pad) => (list.length
    ? [`${pad}${open}>`, ...list.map((k) => `${pad}  ${k}`), `${pad}</${close}>`]
    : [`${pad}${open}/>`]);

  const out = [svgOpen(o)];
  const body = [
    `<!-- GEPV1 animated SVG: ${s(timeline.durationMs)} long, plays once (reload to replay) -->`,
    ...styleBlock(o),
    ...(edges.some((e) => e.props.directed) ? arrowDefs() : []),
    ...backgroundRect(o, true),
  ];
  for (const e of edges) {
    const pa = posAt(e.props.a, e.t), pb = posAt(e.props.b, e.t);
    const id = esc(ids.get(e.id)), stroke = paint(e.props.color);
    const open = e.props.directed
      ? `<polyline id="${id}" class="edge arrow" points="${arrowPoints(pa, pb)}" stroke="${stroke}" marker-mid="url(#${ARROWHEAD_ID})"${hidden(e)}`
      : `<line id="${id}" class="edge" x1="${n(pa.x)}" y1="${n(pa.y)}" x2="${n(pb.x)}" y2="${n(pb.y)}" stroke="${stroke}"${hidden(e)}`;
    body.push(...el(open, e.props.directed ? 'polyline' : 'line', [...visibility(e), ...(kids.edge.get(e.id) ?? [])], ''));
  }
  for (const c of nodes) {
    const shape = shapeOf.get(c.id);
    const { x, y } = c.props.pos;
    // a node that is ever not normal size gets an inner group that carries the scale
    const sized = (c.props.size ?? 1) !== 1 || kids.scale.has(c.id);
    const pad = sized ? '    ' : '  ';
    body.push(`<g id="${esc(ids.get(c.id))}" class="node ${shape}" transform="${translate(x, y)}"${hidden(c)}>`,
      ...[...visibility(c), ...(kids.group.get(c.id) ?? [])].map((k) => `  ${k}`));
    if (sized) body.push(...el(`  <g transform="scale(${n3(c.props.size ?? 1)})"`, 'g', kids.scale.get(c.id) ?? [], '').map((l, i, a) => (i === 0 || i === a.length - 1 ? l : `  ${l}`)).slice(0, -1));
    if (shape !== 'text') {
      const tag = outlineTag(shape);
      const shapeEl = outline(shape, ` fill="${paint(c.props.color)}"`).replace(/\/>$/, '');
      body.push(...el(shapeEl, tag, kids.outline.get(c.id) ?? [], pad));
    }
    body.push(`${pad}<text y="${labelDy(shape)}" fill="${labelFill(shape, c.props.color)}">${esc(c.props.label)}${(kids.text.get(c.id) ?? []).join('')}</text>`);
    if (sized) body.push('  </g>');
    body.push('</g>');
  }
  out.push(...body.map((l) => '  ' + l), '</svg>');
  return out.join('\n') + '\n';
}
