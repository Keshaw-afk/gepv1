// make_tree: a laid-out tree from parent → child pairs.
import { runTool, ToolError } from '../ai_tools.js';
import { CANVAS } from '../scene.js';
import { pairsOf } from './util.js';

export default {
  name: 'make_tree',
  description: 'Makes a tree (e.g. a binary tree, a family tree, a class hierarchy) from parent → child pairs and lays it out neatly: root at the top, children below, in the order given. Example: {"edges": [["8", "3"], ["8", "10"], ["3", "1"], ["3", "6"]]}',
  params: {
    edges: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'parent → child pairs, e.g. [["8", "3"], ["8", "10"]]' },
    arrows: { type: 'boolean', description: 'true to draw arrows from parent to child (default plain lines)' },
  },
  required: ['edges'],
  run(p, a) {
    const pairs = pairsOf(a.edges, 'edges');
    if (!pairs.length || pairs.length > 30) throw new ToolError('edges must have 1 to 30 pairs.');
    const kids = new Map(), parent = new Map(), order = [];
    const note = (x) => { if (!kids.has(x)) { kids.set(x, []); order.push(x); } };
    for (const [pa, ch] of pairs) {
      note(pa); note(ch);
      if (parent.has(ch)) throw new ToolError(`${ch} has two parents (${parent.get(ch)} and ${pa}); a tree gives each node one parent.`);
      parent.set(ch, pa);
      kids.get(pa).push(ch);
    }
    const roots = order.filter((x) => !parent.has(x));
    if (roots.length !== 1) throw new ToolError(roots.length ? `A tree has one root; these have no parent: ${roots.join(', ')}.` : 'The pairs go round in a circle; a tree needs a root.');
    // leaves get the next column; a parent sits above the middle of its children
    let leaf = 0, depth = 0;
    const at = new Map();
    const place = (x, d) => {
      depth = Math.max(depth, d);
      const c = kids.get(x);
      if (!c.length) at.set(x, { col: leaf++, d });
      else { for (const k of c) place(k, d + 1); at.set(x, { col: (at.get(c[0]).col + at.get(c.at(-1)).col) / 2, d }); }
    };
    place(roots[0], 0);
    const colW = Math.min(90, (CANVAS.width - 80) / Math.max(1, leaf - 1 || 1));
    const rowH = Math.min(90, (CANVAS.height - 80) / Math.max(1, depth));
    const x0 = CANVAS.width / 2 - (colW * (leaf - 1)) / 2;
    const name = new Map();
    for (const x of order) {
      const { col, d } = at.get(x);
      const reply = runTool(p, 'add', { shape: 'circle', label: x, x: Math.round(x0 + col * colW), y: Math.round(40 + d * rowH), duplicate: true });
      name.set(x, / so it is called (.+?)\)/.exec(reply)?.[1] ?? x);
    }
    for (const [pa, ch] of pairs) runTool(p, 'connect', { from: name.get(pa), to: name.get(ch), arrow: !!a.arrows });
    return `Made a tree with root ${name.get(roots[0])}: ${order.length} nodes, ${depth + 1} levels.`;
  },
};
