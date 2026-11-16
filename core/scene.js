// Scene / object model: nodes (a shape with a label: circle, rect, triangle or text) and edges
// (a line or an arrow between two nodes). Used both by the GUI editor (layout) and by the Lua API
// (logical state for queries).

import { RADIUS, defaultColor } from './shapes.js';

export const CANVAS = { width: 640, height: 360 }; // even sizes: required by the H.264 encoder
export const NODE_RADIUS = RADIUS;
export const DEFAULT_NODE_COLOR = '#cccccc';
export const DEFAULT_EDGE_COLOR = '#888888';

export class Scene {
  constructor() {
    this.objects = new Map(); // id -> { id, kind: 'node'|'edge', ...props }
    this.nextId = 1;
  }

  get(id) { return this.objects.get(id); }
  isNode(id) { return this.objects.get(id)?.kind === 'node'; }
  nodes() { return [...this.objects.values()].filter((o) => o.kind === 'node'); }
  edges() { return [...this.objects.values()].filter((o) => o.kind === 'edge'); }

  addNode(label, x, y, shape = 'circle') {
    const id = this.nextId++;
    this.objects.set(id, { id, kind: 'node', shape, label: String(label), x, y, color: defaultColor(shape) });
    return id;
  }

  /** An id for an object that will exist later (e.g. one a GUI step creates); never reused. */
  reserveId() { return this.nextId++; }

  /** Edges are undirected for neighbors/edgeOf; directed = drawn as an arrow from a to b. */
  addEdge(a, b, directed = false) {
    if (!this.isNode(a) || !this.isNode(b)) throw new Error('edge endpoints must be nodes');
    if (a === b) throw new Error('cannot connect a node to itself');
    if (this.edgeOf(a, b) !== null) {
      throw new Error(`edge between ${this.get(a).label} and ${this.get(b).label} already exists`);
    }
    const id = this.nextId++;
    this.objects.set(id, { id, kind: 'edge', a, b, directed: !!directed, color: DEFAULT_EDGE_COLOR });
    return id;
  }

  /** Removes an object; removing a node also removes its edges. */
  remove(id) {
    if (this.isNode(id)) {
      for (const e of this.edges()) if (e.a === id || e.b === id) this.objects.delete(e.id);
    }
    this.objects.delete(id);
  }

  /** Nodes connected to `id`, in edge creation order. Edges are undirected. */
  neighbors(id) {
    const out = [];
    for (const e of this.edges()) {
      if (e.a === id) out.push(e.b);
      else if (e.b === id) out.push(e.a);
    }
    return out;
  }

  /** Id of the edge between a and b (either direction), or null. */
  edgeOf(a, b) {
    for (const e of this.edges()) {
      if ((e.a === a && e.b === b) || (e.a === b && e.b === a)) return e.id;
    }
    return null;
  }

  /** Human-readable name used in traces: node label, or "A-B" for an edge. */
  nameOf(id) {
    const o = this.get(id);
    if (!o) return `#${id}`;
    return o.kind === 'node' ? o.label : `${this.nameOf(o.a)}-${this.nameOf(o.b)}`;
  }
}
