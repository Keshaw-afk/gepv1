// Splits a user's step-by-step message into single instructions, so a very small model only has to
// turn one short sentence at a time into a tool call ("move it up by 200 in 2 seconds").
//
//   "Draw A at (100, 100). Then move it right, and at the same time turn B red; wait 1 second"
//     -> ["Draw A at (100, 100)", "move it right", "at the same time turn B red", "wait 1 second"]
//
// It splits at sentence ends, semicolons, new lines and "then"; at "and at the same time" /
// "and meanwhile" / "while" (kept in the instruction, so the model knows to add together). It never
// splits at a bare "and" or a comma inside coordinates: "draw A and B at (1, 2)" stays one.

const VERBS = 'draw|add|put|place|create|make|move|turn|colou?r|paint|connect|link|join|remove|delete|hide|erase|wait|pause|resize|grow|shrink|write|rename|swap|throw|undo|clear';
const SHAPES = 'circle|box|square|rectangle|rect|triangle|text|ball|dot|node';

/** "draw a circle A … and a box B …" -> two draws; "draw A and then move it" -> two; "A and B" stays. */
function andSplit(piece) {
  const parts = piece.split(new RegExp(`\\s*,?\\s+and\\s+(?=(?:${VERBS})\\b|(?:an?|another|one more)\\s+(?:\\w+\\s+)?(?:${SHAPES})\\b)`, 'i'));
  const verb = new RegExp(`^\\s*(${VERBS})\\b`, 'i').exec(parts[0])?.[1];
  return parts.map((p, i) => (i && verb && !new RegExp(`^\\s*(?:${VERBS})\\b`, 'i').test(p) ? `${verb} ${p}` : p));
}

const TIME_WORDS = /\b(?:at the same time|simultaneously|meanwhile|while)\b/i;

export function splitInstructions(text) {
  const out = [];
  // protect the commas and full stops inside brackets and numbers: (100, 200), 1.5
  const masked = String(text).replace(/\([^)]*\)/g, (m) => m.replace(/[.,;]/g, (c) => `\u0000${c.charCodeAt(0)}\u0000`))
    .replace(/(\d)\.(\d)/g, '$1\u000046\u0000$2');
  const unmask = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, c) => String.fromCharCode(Number(c)));
  for (const sentence of masked.split(/(?:[.!?;]+(?:\s+|$))|\n+/)) {
    // "…, then …", "… and then …", "… then …"
    const parts = sentence.split(/\s*(?:,\s*)?(?:\band\s+)?\bthen\b[,\s]*/i);
    for (const part of parts) {
      // "… and at the same time …", ", while …"
      const pieces = part.split(new RegExp(`\\s*(?:,\\s*)?(?:\\band\\s+)?(?=${TIME_WORDS.source})`, 'i'));
      for (const piece of pieces.flatMap(andSplit)) {
        const s = unmask(piece).trim().replace(/^(and|also|next|finally|first|after that|afterwards)[,\s]+/i, '').replace(/[,\s]+$/, '');
        if (s) out.push(s);
      }
    }
  }
  return out;
}

// ---------- the user's words win over a small model's guesses ----------
// A tiny model picks the right tool and object well, but it guesses at details it should copy:
// it adds together where the user said "then", invents seconds, puts "by 100" into x. These details
// are plain in the instruction, so they are read from it and override what the model sent.

const NUM = '(\\d+(?:\\.\\d+)?)';
const DIRS = ['right', 'left', 'up', 'down'];

/** The existing object names an instruction mentions (a one-letter name only as a capital: not "a"). */
export function namesIn(step, known) {
  const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return known.filter((n) => n && new RegExp(`(?<![\\w′])${esc(n)}(?![\\w′])`, n.length === 1 ? '' : 'i').test(step));
}

/**
 * Fixes a tool call's arguments from the instruction it came from. Returns new args.
 * known: the names of the objects that exist now.
 */
export function fromWords(step, name, args, known = []) {
  const text = ` ${String(step).toLowerCase()} `;
  const a = { ...args };
  const at = new RegExp(`\\b(?:at the same time|simultaneously|meanwhile|while)\\b`).test(text);
  if (at) a.together = true; else delete a.together;
  // "in 3 seconds", "for 2.5 s", "over 10 secs"
  const secs = new RegExp(`${NUM}\\s*(?:s|sec|secs|second|seconds)\\b`).exec(text);
  if (secs && ['move', 'color', 'resize', 'wait', 'swap', 'throw'].includes(name)) a.seconds = Number(secs[1]);
  else if (!secs && name !== 'wait' && a.seconds !== undefined && !/\bsecond|\bsec\b/.test(text)) delete a.seconds;
  // "these"/"selected": what the user selected; "them"/"they": the last ones
  if (/\b(these|those|selected|selection|highlighted)\b/.test(text) && 'label' in (TARGETS[name] ?? {})) a.label = 'selected';
  else if (/\b(them|they)\b/.test(text) && TARGETS[name] && !/\b(all|every)\b/.test(text)) a.label = 'them';
  else if (TARGETS[name] && typeof a.label === 'string' && !/\b(it|all|every|everything|ones)\b/.test(text)) {
    // the model named one object, the user another: "turn B red" sent as label "A"
    const said = namesIn(step, known);
    if (said.length === 1 && !namesIn(a.label, [said[0]]).length && known.includes(a.label)) a.label = said[0];
  }
  // "everything", "all circles", "all the red ones": one call on the whole set
  const set = /\b(everything|every (?:object|shape|thing)|(?:all(?: of)?(?: the)? |the )(?:[a-z]+ )?(?:circles|boxes|squares|rectangles|triangles|texts|ones|objects|shapes|things)|all of them|all)\b/.exec(text);
  if (set && TARGETS[name] && !/\b(these|those|selected)\b/.test(text)) a.label = set[1] === 'all' || set[1] === 'all of them' ? 'everything' : set[1];
  if (name === 'draw') {
    // copy what the user typed: shape, label, colour, place; never a label they didn't type
    const shapes = text.match(new RegExp(`\\b(${SHAPES}|squares?|circles|boxes|triangles)\\b`, 'g')) ?? [];
    if (new Set(shapes).size === 1) a.shape = shapes[0].replace(/s$/, '').replace(/^boxe$/, 'box');
    const named = new RegExp(`\\b(?:${SHAPES})\\s+(?:called\\s+|named\\s+|labell?ed\\s+)?["“']?([A-Z0-9][\\w′']*)`).exec(String(step))
      ?? /\b(?:called|named|labell?ed)\s+["“']?([\w′']+)/i.exec(String(step));
    const several = placesIn(step) > 1 || /\b(two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(?:\w+\s+)?(circles|boxes|squares|triangles|shapes)\b/.test(text);
    if (several) { /* the model splits a list of labels and places; keep its own */ }
    else if (named) a.label = named[1];
    else if (a.label !== undefined && !namesIn(String(step), [String(a.label)]).length) delete a.label;
    const colours = text.match(COLOUR_WORDS) ?? [];
    if (new Set(colours).size === 1) a.color = colours[0];
    const places = String(step).match(/\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g) ?? [];
    if (places.length === 1) [a.x, a.y] = places[0].match(/-?\d+(?:\.\d+)?/g).map(Number);
  }
  if (name === 'connect') { // "from it to the circle", "connect it to B"
    if (/\bfrom (it|this)\b/.test(text) || /^\s*(connect|link|join) (it|this)\b/.test(text)) a.from = 'it';
    if (/\bto (it|this)\b/.test(text)) a.to = 'it';
    if (/\barrow\b/.test(text)) a.arrow = true; else if (/\bline\b/.test(text)) a.arrow = false;
    // "from start to end", "between A and B": the names typed win
    const pair = /\b(?:from|between)\s+(?:the\s+)?(.+?)\s+(?:to|and)\s+(?:the\s+)?(.+?)(?:\s+with\b.*)?\s*$/i.exec(String(step).trim());
    if (pair) {
      const pick = (w) => (/^(it|this)$/i.test(w) ? 'it' : namesIn(w, known)[0] ?? w);
      a.from = pick(pair[1]);
      a.to = pick(pair[2]);
    }
  }
  if (name === 'resize') { // "twice as big", "three times their size", "half the size"
    const words = { twice: 2, double: 2, half: 0.5, halve: 0.5, triple: 3, thrice: 3 };
    const w = /\b(twice|double|half|halve|triple|thrice)\b/.exec(text);
    const times = new RegExp(`\\b(${NUM}|two|three|four|five)\\s*(?:times|x)\\b`).exec(text);
    const k = w ? words[w[1]] : times ? (Number(times[1]) || { two: 2, three: 3, four: 4, five: 5 }[times[1]]) : undefined;
    if (k) { for (const key of ['size', 'width', 'height']) delete a[key]; a.scale = k; }
  }
  if (name === 'color') { // the colour it becomes is the last one said: "turn the red ones blue"
    const colours = text.match(COLOUR_WORDS) ?? [];
    if (colours.length) a.color = colours.at(-1);
  }
  if (name === 'move') {
    // "right by 100", "100 to the left", "up 50 px", "by 100 to the right"
    const by = {};
    for (const d of DIRS) {
      const m = new RegExp(`\\b${d}\\s+(?:by\\s+)?${NUM}\\b|\\b(?:by\\s+)?${NUM}\\s*(?:px|pixels?)?\\s+(?:to\\s+the\\s+)?${d}\\b`).exec(text);
      if (m) by[d] = Number(m[1] ?? m[2]);
    }
    if (Object.keys(by).length) {
      for (const k of ['x', 'y', 'dx', 'dy', ...DIRS]) delete a[k];
      Object.assign(a, by);
    }
    if (/\b(arc|curve|curved|curving|arcs)\b/.test(text)) { if (!a.arc && !a.via) a.arc = true; } else delete a.arc;
  }
  return a;
}
const COLOUR_WORDS = /\b(red|orange|yellow|green|blue|purple|pink|cyan|teal|brown|black|white|grey|gray|lightgrey|darkgrey|navy|gold|violet|magenta|lime)\b/g;
const TARGETS = { move: { label: 1 }, color: { label: 1 }, resize: { label: 1 }, remove: { label: 1 } };

/** How many places "(x, y)" an instruction names: drawing three needs three calls. */
export const placesIn = (step) => (String(step).match(/\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\)/g) ?? []).length;

const SIMPLE = { hide: 'remove', remove: 'remove', delete: 'remove', erase: 'remove', wait: 'wait', pause: 'wait', undo: 'undo' };

/** For an instruction the model would not turn into a call: the obvious call, when there is one. */
export function obviousCall(step, known = []) {
  const verb = /^\s*(?:please\s+)?(\w+)/i.exec(String(step))?.[1]?.toLowerCase();
  const name = SIMPLE[verb];
  if (!name) return null;
  const args = fromWords(step, name, {}, known);
  if (name === 'wait' && args.seconds === undefined) return null;
  if (name === 'remove' && args.label === undefined) {
    const said = namesIn(step, known);
    if (said.length === 1) args.label = said[0];
    else if (!/\b(it|this|that)\b/i.test(step)) return null;
  }
  return { name, args };
}

/**
 * The tool an instruction plainly asks for, when its words leave no doubt; else null. A small model
 * sometimes calls move for "make queue yellow": the words say colour.
 */
export function toolFromWords(step) {
  const text = ` ${String(step).toLowerCase()} `;
  // "a line from A to B", "an arrow from it to the circle", "connect A and B"
  if (/\b(connect|link|join)\b/.test(text) || /\b(line|arrow|edge)s?\s+(from|between)\b/.test(text)) return 'connect';
  const moving = /\b(move|moves|slide|go|goes|travel|jump|throw|swap|to the|towards|right|left|up|down|by \d)\b|\(\s*\d/.test(text);
  const drawing = /^\s*(draw|add|put|place|create|write)\b/.test(text);
  if (moving || drawing) return null;
  if (/\b(hide|remove|delete|erase|disappear)\b/.test(text)) return 'remove';
  if (/\b(bigger|smaller|twice|double|half|halve|triple|times|size|grow|shrink|larger|scale)\b/.test(text)) return 'resize';
  if (COLOUR_WORDS.test(text)) { COLOUR_WORDS.lastIndex = 0; return 'color'; }
  return null;
}
