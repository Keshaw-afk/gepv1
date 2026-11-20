// Labels with maths: the parts of a label between $ signs are maths, LaTeX-style but small.
//
//   "$c_{i,j} = c_{i-1,j-1} + 1$"   c with subscript i,j … (- is a real minus sign in maths)
//   "$x^2 \le n$"                    x squared ≤ n
//   "$a <= b$, $x -> y$"             ASCII shortcuts: <= >= != -> <- => +- ...
//
// Only symbols, subscripts and superscripts: no fractions or other layout. Outside $…$ a label is
// shown as written ("\$" is a dollar sign). A label is still stored as typed; this module gives the
// text that is shown (labelText: for widths and checks) and the SVG markup that shows it (labelMarkup).
//
// In ordinary Lua strings a backslash starts an escape ("\t" is a tab), so "\times" would be a tab
// and "imes". Write maths in long strings, [[$a \times b$]]; the escapes Lua turns into control
// characters (\a \b \f \n \r \t \v) are read back as the command they came from, just in case.

export const SYMBOLS = {
  // relations and operators
  le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈', equiv: '≡', sim: '∼',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', ast: '∗', circ: '∘', oplus: '⊕', otimes: '⊗',
  ll: '≪', gg: '≫', propto: '∝',
  // arrows
  leftarrow: '←', gets: '←', rightarrow: '→', to: '→', uparrow: '↑', downarrow: '↓',
  leftrightarrow: '↔', nwarrow: '↖', nearrow: '↗', swarrow: '↙', searrow: '↘',
  Leftarrow: '⇐', Rightarrow: '⇒', implies: '⇒', Leftrightarrow: '⇔', iff: '⇔', mapsto: '↦',
  // sets and logic
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇',
  cup: '∪', cap: '∩', emptyset: '∅', varnothing: '∅', setminus: '∖',
  forall: '∀', exists: '∃', neg: '¬', lnot: '¬', land: '∧', wedge: '∧', lor: '∨', vee: '∨',
  top: '⊤', bot: '⊥',
  // big operators and the rest
  sum: '∑', prod: '∏', int: '∫', sqrt: '√', infty: '∞', partial: '∂', nabla: '∇',
  lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', langle: '⟨', rangle: '⟩',
  ldots: '…', cdots: '⋯', dots: '…', prime: '′', deg: '°', angle: '∠', triangle: '△',
  // Greek
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ',
  sigma: 'σ', tau: 'τ', upsilon: 'υ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  // spacing and escaped characters
  ',': ' ', ';': ' ', ' ': ' ', quad: ' ', '{': '{', '}': '}', _: '_', '^': '^', $: '$', '%': '%', '#': '#', '&': '&',
};

// ASCII shortcuts in maths, longest first
const SHORT = [['<=>', '⇔'], ['...', '…'], ['<=', '≤'], ['>=', '≥'], ['!=', '≠'], ['->', '→'], ['<-', '←'], ['=>', '⇒'], ['+-', '±'], ['-', '−']];
// what Lua makes of "\a" "\b" "\f" "\n" "\r" "\t" "\v"
const CONTROL = { '\x07': 'a', '\b': 'b', '\f': 'f', '\n': 'n', '\r': 'r', '\t': 't', '\v': 'v' };

const cache = new Map();

/**
 * The label as parts: [{ s, shift: 0 | 'sub' | 'sup' }]. Plain labels (no $) are one part.
 */
export function labelParts(label) {
  const src = String(label ?? '');
  if (!src.includes('$')) return [{ s: src, shift: 0 }];
  if (cache.has(src)) return cache.get(src);
  const parts = [];
  const push = (s, shift) => {
    if (!s) return;
    const last = parts.at(-1);
    if (last && last.shift === shift) last.s += s; else parts.push({ s, shift });
  };
  // split into text and maths: an unclosed $ is just a dollar sign; \$ is always one
  let i = 0, text = '';
  while (i < src.length) {
    if (src[i] === '\\' && src[i + 1] === '$') { text += '$'; i += 2; continue; }
    if (src[i] === '$') {
      let j = i + 1;
      while (j < src.length && !(src[j] === '$' && src[j - 1] !== '\\')) j++;
      if (j < src.length) {
        push(text, 0);
        text = '';
        maths(src.slice(i + 1, j), push);
        i = j + 1;
        continue;
      }
    }
    text += src[i++];
  }
  push(text, 0);
  const out = parts.length ? parts : [{ s: '', shift: 0 }];
  if (cache.size > 2000) cache.clear();
  cache.set(src, out);
  return out;
}

/** Reads one piece of maths, handing each run of text with its shift to push. */
function maths(m, push) {
  m = m.replace(/[\x07\b\f\n\r\t\v](?=[A-Za-z])/g, (c) => `\\${CONTROL[c]}`);
  let i = 0;
  // one token: a \command, a {group} (its text), or one character; returns plain text
  const token = () => {
    if (m[i] === '{') {
      let depth = 1, j = i + 1;
      while (j < m.length && depth) { if (m[j] === '{') depth++; else if (m[j] === '}') depth--; j++; }
      const inner = m.slice(i + 1, depth ? j : j - 1);
      i = j;
      let s = '';
      maths(inner, (t) => { s += t; }); // nested shifts are flattened
      return s;
    }
    if (m[i] === '\\') {
      const word = /^\\([A-Za-z]+|.)/.exec(m.slice(i));
      if (word) {
        i += word[0].length;
        return SYMBOLS[word[1]] ?? word[0]; // an unknown command is shown as typed
      }
    }
    for (const [from, to] of SHORT) {
      if (m.startsWith(from, i)) { i += from.length; return to; }
    }
    return m[i++];
  };
  while (i < m.length) {
    const c = m[i];
    if ((c === '_' || c === '^') && i + 1 < m.length) {
      i++;
      push(token(), c === '_' ? 'sub' : 'sup');
    } else {
      push(token(), 0);
    }
  }
}

/** The text a label shows (no $ signs or commands): what widths and checks use. */
export const labelText = (label) => labelParts(label).map((p) => p.s).join('');

/** Does the label need tspans (a subscript or superscript)? */
export const hasShifts = (label) => labelParts(label).some((p) => p.shift);

const SMALL = 12;                // subscript and superscript size (the label is 17 px)
const RISE = { 0: 0, sub: 4, sup: -7 }; // baseline offsets in px

/**
 * The inside of a label's <text> element: escaped text, with <tspan>s for subscripts and
 * superscripts. When there are tspans the <text> needs xml:space="preserve" (labelSpace), or a
 * space next to a tspan is lost.
 */
export function labelMarkup(label, escape) {
  const parts = labelParts(label);
  if (!parts.some((p) => p.shift)) return escape(parts.map((p) => p.s).join(''));
  let at = 0, out = '';
  for (const p of parts) {
    const dy = RISE[p.shift] - at;
    at = RISE[p.shift];
    out += !dy && !p.shift ? escape(p.s) : `<tspan${dy ? ` dy="${dy}"` : ''}${p.shift ? ` font-size="${SMALL}"` : ''}>${escape(p.s)}</tspan>`;
  }
  return out;
}

/** The attribute a label's <text> needs (see labelMarkup). */
export const labelSpace = (label) => (hasShifts(label) ? ' xml:space="preserve"' : '');
