// A read-only code block with Copy, Save and Wrap, and light highlighting for Lua and SVG.
// Used for every generated block on the page: stage.lua, steps.lua, the SVG of a frame, the trace.

import { API_NAMES } from '../core/lua_api.js';

const esc = (s) => s.replace(/[&<>]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);

const RULES = {
  lua: [
    ['comment', /--[^\n]*/],
    ['string', /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'/],
    ['keyword', /\b(?:and|break|do|else|elseif|end|false|for|function|goto|if|in|local|nil|not|or|repeat|return|then|true|until|while)\b/],
    ['api', new RegExp(`\\b(?:${[...API_NAMES, 'print'].join('|')})\\b(?=\\s*\\()`)],
    ['number', /\b\d+(?:\.\d+)?\b/],
  ],
  xml: [
    ['comment', /<!--[\s\S]*?-->/],
    ['tag', /<\/?[\w:-]+|\/?>/],
    ['attr', /[\w:-]+(?==")/],
    ['string', /"[^"]*"/],
  ],
  text: [
    ['tag', /^\[\w+\]/m],
    ['comment', /\b(?:stage|steps|script)\.lua:\d+\b/],
  ],
};

/** Returns HTML: the text escaped, with <span class="tok-…"> around recognised tokens. */
export function highlight(text, lang) {
  const rules = RULES[lang] ?? [];
  if (!rules.length) return esc(text);
  const re = new RegExp(rules.map(([, r]) => `(${r.source})`).join('|'), 'g' + (lang === 'text' ? 'm' : ''));
  let html = '', last = 0;
  for (const m of text.matchAll(re)) {
    const kind = rules[m.slice(1).findIndex((g) => g !== undefined)][0];
    html += esc(text.slice(last, m.index)) + `<span class="tok-${kind}">${esc(m[0])}</span>`;
    last = m.index + m[0].length;
  }
  return html + esc(text.slice(last));
}

export class CodeView {
  /**
   * pre       the <pre> to fill
   * lang      'lua', 'xml' or 'text'
   * filename  name for Save (a string, or a function returning one)
   * onSave    (text, name) -> download it
   */
  constructor(pre, { lang, filename, onSave }) {
    this.pre = pre;
    this.lang = lang;
    this.text = '';
    const bar = document.createElement('div');
    bar.className = 'code-tools';
    const button = (label, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.title = title;
      b.addEventListener('click', fn);
      bar.append(b);
      return b;
    };
    const copy = button('Copy', 'Copy to the clipboard', async () => {
      try {
        await navigator.clipboard.writeText(this.text);
        copy.textContent = 'Copied';
      } catch {
        copy.textContent = 'Copy failed';
      }
      setTimeout(() => { copy.textContent = 'Copy'; }, 1200);
    });
    button('Save', 'Download as a file', () => onSave(this.text, typeof filename === 'function' ? filename() : filename));
    const wrap = button('Wrap', 'Wrap long lines', () => {
      pre.classList.toggle('wrap');
      wrap.setAttribute('aria-pressed', String(pre.classList.contains('wrap')));
    });
    wrap.setAttribute('aria-pressed', 'false');
    pre.before(bar);
  }

  set(text) {
    if (text === this.text) return;
    this.text = text;
    this.pre.innerHTML = highlight(text, this.lang);
  }
}
