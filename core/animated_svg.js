// Animated SVG: the whole timeline as ONE .svg file that plays by itself in a browser,
// using SVG's built-in animation elements (<animate>, <set>). It plays once and then holds
// the last frame.
//
// It uses the same resolved tweens as the player (tweens() in player.js), so it shows exactly
// what the preview and the MP4 show:
//   colour tween  -> <animate attributeName="fill|stroke">  (+ label text flips black/white)
//   move tween    -> <animate> on the circle's cx/cy, the label's x/y and the ends of every edge
//                    touching the node
//   create at t>0 -> hidden until t (<set attributeName="visibility">)
// When two animations overlap, the one that starts later wins, which matches the player.

import { CANVAS, NODE_RADIUS } from './scene.js';
import { tweens } from './player.js';
import { contrastText, mixColor } from './colors.js';
import { paint } from './svg.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const n = (v) => Math.round(v * 100) / 100;
const s = (ms) => `${ms / 1000}s`; // times are whole ms

const set = (attr, to, t) => `<set attributeName="${attr}" to="${to}" begin="${s(t)}" fill="freeze"/>`;
function animate(attr, from, to, t0, dur) {
  if (dur === 0) return set(attr, to, t0); // instant change (dur 0 isn't a valid SMIL duration)
  return `<animate attributeName="${attr}" from="${from}" to="${to}" begin="${s(t0)}" dur="${s(dur)}" fill="freeze"/>`;
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

export function renderAnimatedSVG(timeline) {
  const { width, height } = CANVAS;
  const creates = timeline.commands.filter((c) => c.op === 'create');
  const nodes = creates.filter((c) => c.kind === 'node');
  const edges = creates.filter((c) => c.kind === 'edge');

  // Child animation elements for every SVG element we draw.
  const kids = { circle: new Map(), text: new Map(), line: new Map() };
  const add = (kind, id, el) => { if (!kids[kind].has(id)) kids[kind].set(id, []); kids[kind].get(id).push(el); };

  const all = tweens(timeline);
  for (const [i, tw] of all.entries()) {
    const isNode = nodes.some((c) => c.id === tw.id);
    if (tw.prop === 'color') {
      add(isNode ? 'circle' : 'line', tw.id, animate(isNode ? 'fill' : 'stroke', paint(tw.from), paint(tw.to), tw.t0, tw.dur));
      const flip = isNode ? contrastFlip(tw) : null;
      // skip the flip if a later colour change on this node starts first (it decides the text)
      const overtaken = all.slice(i + 1).some((o) => o.id === tw.id && o.prop === 'color' && o.t0 < flip);
      if (flip !== null && !overtaken) add('text', tw.id, set('fill', contrastText(tw.to), flip));
    } else if (tw.prop === 'pos') {
      const { from: f, to } = tw;
      add('circle', tw.id, animate('cx', n(f.x), n(to.x), tw.t0, tw.dur));
      add('circle', tw.id, animate('cy', n(f.y), n(to.y), tw.t0, tw.dur));
      add('text', tw.id, animate('x', n(f.x), n(to.x), tw.t0, tw.dur));
      add('text', tw.id, animate('y', n(f.y + 6), n(to.y + 6), tw.t0, tw.dur));
      for (const e of edges) {
        for (const end of ['a', 'b']) {
          if (e.props[end] !== tw.id) continue;
          const k = end === 'a' ? 1 : 2;
          add('line', e.id, animate(`x${k}`, n(f.x), n(to.x), tw.t0, tw.dur));
          add('line', e.id, animate(`y${k}`, n(f.y), n(to.y), tw.t0, tw.dur));
        }
      }
    }
  }

  // Objects created after t=0 stay hidden until their create time.
  const appear = (c) => (c.t > 0 ? [set('visibility', 'visible', c.t)] : []);
  const hidden = (c) => (c.t > 0 ? ' visibility="hidden"' : '');
  const body = (list) /* no whitespace inside <text>, so it's only used for circle/line */ => (list.length ? `\n  ${list.join('\n  ')}\n` : '');
  const start = new Map(nodes.map((c) => [c.id, c.props.pos]));

  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  out.push(`<!-- GEPV1 animated SVG: ${s(timeline.durationMs)} long, plays once (reload to replay) -->`);
  out.push(`<rect width="${width}" height="${height}" fill="#ffffff"/>`);
  for (const e of edges) {
    const a = start.get(e.props.a), b = start.get(e.props.b);
    const kidList = [...appear(e), ...(kids.line.get(e.id) ?? [])];
    out.push(`<line x1="${n(a.x)}" y1="${n(a.y)}" x2="${n(b.x)}" y2="${n(b.y)}" stroke="${paint(e.props.color)}" stroke-width="3" stroke-linecap="round"${hidden(e)}>${body(kidList)}</line>`);
  }
  for (const c of nodes) {
    const { x, y } = c.props.pos;
    out.push(`<circle cx="${n(x)}" cy="${n(y)}" r="${NODE_RADIUS}" fill="${paint(c.props.color)}" stroke="#333333" stroke-width="2"${hidden(c)}>${body([...appear(c), ...(kids.circle.get(c.id) ?? [])])}</circle>`);
    out.push(`<text x="${n(x)}" y="${n(y + 6)}" text-anchor="middle" font-family="sans-serif" font-size="17" font-weight="bold" fill="${contrastText(c.props.color)}"${hidden(c)}>${esc(c.props.label)}${[...appear(c), ...(kids.text.get(c.id) ?? [])].join('')}</text>`);
  }
  out.push('</svg>');
  return out.join('\n');
}
