// GUI editor: drag-and-drop layout of nodes and edges. All model logic lives in core/Scene;
// this file only turns mouse/keyboard events into Scene changes and re-renders.

import { Scene, CANVAS, NODE_RADIUS } from '../core/scene.js';
import { sceneToState } from '../core/player.js';
import { renderSVG } from '../core/svg.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class Editor {
  /** onChange() fires after any edit; onSelect(obj|null) when the selection changes. */
  constructor(container, { onChange, onSelect, onRename }) {
    this.el = container;
    this.scene = new Scene();
    this.selected = null;
    this.drag = null; // { mode: 'move' | 'edge', id, dx, dy, ghost }
    Object.assign(this, { onChange, onSelect, onRename });

    container.addEventListener('pointerdown', (e) => this.down(e));
    container.addEventListener('pointermove', (e) => this.move(e));
    container.addEventListener('pointerup', (e) => this.up(e));
    container.addEventListener('contextmenu', (e) => e.preventDefault());
    container.addEventListener('dblclick', (e) => {
      const id = this.hitId(e);
      if (id && this.scene.isNode(id)) this.onRename?.();
    });
    this.render();
  }

  setScene(scene) {
    this.scene = scene;
    this.select(null);
    this.changed();
  }

  render() {
    this.el.innerHTML = renderSVG(sceneToState(this.scene), {
      interactive: true, selected: this.selected, ghost: this.drag?.ghost,
    });
  }

  changed() { this.render(); this.onChange?.(); }

  select(id) {
    this.selected = id;
    this.render();
    this.onSelect?.(id ? this.scene.get(id) : null);
  }

  point(e) {
    const r = this.el.querySelector('svg').getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) * CANVAS.width) / r.width, NODE_RADIUS, CANVAS.width - NODE_RADIUS),
      y: clamp(((e.clientY - r.top) * CANVAS.height) / r.height, NODE_RADIUS, CANVAS.height - NODE_RADIUS),
    };
  }

  hitId(e) {
    const id = e.target.closest?.('[data-id]')?.dataset.id;
    return id ? Number(id) : null;
  }

  nodeAt(p) {
    return this.scene.nodes().find((n) => Math.hypot(n.x - p.x, n.y - p.y) <= NODE_RADIUS) ?? null;
  }

  nextLabel() {
    const used = new Set(this.scene.nodes().map((n) => n.label));
    for (let i = 0; i < 26; i++) {
      const l = String.fromCharCode(65 + i);
      if (!used.has(l)) return l;
    }
    let k = 1;
    while (used.has(`N${k}`)) k++;
    return `N${k}`;
  }

  down(e) {
    const p = this.point(e);
    const id = this.hitId(e);
    this.el.setPointerCapture(e.pointerId);
    if (id && this.scene.isNode(id)) {
      const n = this.scene.get(id);
      this.drag = e.button === 2 || e.shiftKey
        ? { mode: 'edge', id, ghost: { x1: n.x, y1: n.y, x2: p.x, y2: p.y } }
        : { mode: 'move', id, dx: n.x - p.x, dy: n.y - p.y };
      this.select(id);
    } else if (id) {
      this.select(id); // edge
    } else if (e.button === 0) {
      const nid = this.scene.addNode(this.nextLabel(), Math.round(p.x), Math.round(p.y));
      this.select(nid);
      this.changed();
    }
  }

  move(e) {
    if (!this.drag) return;
    const p = this.point(e);
    if (this.drag.mode === 'move') {
      const n = this.scene.get(this.drag.id);
      n.x = Math.round(clamp(p.x + this.drag.dx, NODE_RADIUS, CANVAS.width - NODE_RADIUS));
      n.y = Math.round(clamp(p.y + this.drag.dy, NODE_RADIUS, CANVAS.height - NODE_RADIUS));
      this.changed();
    } else {
      Object.assign(this.drag.ghost, { x2: p.x, y2: p.y });
      this.render();
    }
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (d?.mode === 'edge') {
      const target = this.nodeAt(this.point(e));
      if (target && target.id !== d.id && this.scene.edgeOf(d.id, target.id) === null) {
        this.select(this.scene.addEdge(d.id, target.id));
      }
      this.changed();
    }
  }

  deleteSelected() {
    if (!this.selected) return;
    this.scene.remove(this.selected);
    this.select(null);
    this.changed();
  }

  setLabel(label) {
    const o = this.scene.get(this.selected);
    if (o?.kind !== 'node') return;
    o.label = label;
    this.changed();
  }
}
