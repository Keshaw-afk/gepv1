// make_graph: nodes on a circle, connected.
import { runTool, ToolError } from '../ai_tools.js';
import { CANVAS } from '../scene.js';
import { listOf, pairsOf } from './util.js';

export default {
  name: 'make_graph',
  description: 'Makes a graph (network) for algorithms like BFS, DFS or shortest paths: the nodes are placed evenly on a circle and the edges connect them. Example: {"nodes": ["A", "B", "C", "D"], "edges": [["A", "B"], ["B", "C"], ["C", "D"], ["D", "A"]]}',
  params: {
    nodes: { type: 'array', items: { type: 'string' }, description: 'node labels (2 to 16)' },
    edges: { type: 'array', items: { type: 'array', items: { type: 'string' } }, description: 'pairs of labels to connect' },
    arrows: { type: 'boolean', description: 'true for a directed graph (arrows)' },
  },
  required: ['nodes'],
  run(p, a) {
    const nodes = listOf(a.nodes, 'nodes').map(String);
    if (nodes.length < 2 || nodes.length > 16) throw new ToolError('nodes must have 2 to 16 labels.');
    if (new Set(nodes).size !== nodes.length) throw new ToolError('Each node needs its own label.');
    const edges = a.edges === undefined ? [] : pairsOf(a.edges, 'edges');
    for (const [x, y] of edges) for (const v of [x, y]) if (!nodes.includes(v)) throw new ToolError(`Edge ${x}-${y} uses "${v}", which is not in nodes.`);
    const r = Math.min(140, 40 + nodes.length * 14), cx = CANVAS.width / 2, cy = CANVAS.height / 2;
    const name = new Map();
    nodes.forEach((v, i) => {
      const t = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
      const reply = runTool(p, 'draw', { shape: 'circle', label: v, x: Math.round(cx + r * Math.cos(t)), y: Math.round(cy + r * Math.sin(t)), duplicate: true });
      name.set(v, / so it is called (.+?)\)/.exec(reply)?.[1] ?? v);
    });
    for (const [x, y] of edges) runTool(p, 'connect', { from: name.get(x), to: name.get(y), arrow: !!a.arrows });
    return `Made a graph: ${nodes.length} nodes on a circle, ${edges.length} ${a.arrows ? 'arrows' : 'edges'}.`;
  },
};
