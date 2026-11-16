// GUI editor with two modes:
//   'stage'      draw the starting picture (edits core/Scene)
//   'behaviour'  shows the picture after the steps (this.view); every edit becomes a step through
//                the callbacks (record a move, add an object, connect two), the stage is untouched.
// One tool is active at a time (see TOOLS): select, a shape, or line/arrow.
// All model logic lives in core/; this file only turns pointer events into edits and re-renders.

import { Scene, CANVAS } from '../core/scene.js';
import { sceneToState } from '../core/player.js';
import { renderSVG } from '../core/svg.js';
import { halfSize, hits, SHAPES } from '../core/shapes.js';

export const TOOLS = ['select', ...SHAPES, 'line', 'arrow', 'push']; // push: Behaviour only
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isShape = (tool) => SHAPES.includes(tool);
const isLink = (tool) => tool === 'line' || tool === 'arrow';

/** Keeps a shape's centre where the whole shape stays on the canvas. */
export function keepInside(shape, label, x, y) {
  const h = halfSize(shape, label);
  return {
    x: Math.round(clamp(x, h.x, CANVAS.width - h.x)),
    y: Math.round(clamp(y, h.y, CANVAS.height - h.y)),
  };
}

export class Editor {
  /**
   * onChange()                  after any stage edit
   * onSelect(obj | null)        when the selection changes (obj has id, kind, label, shape)
   * onRename()                  double-click on a stage node
   * onRecordMove(id, x, y)      behaviour: a node was dragged
   * onAddObject(shape, label, x, y)  behaviour: a shape tool clicked empty space
   * onConnect(a, b, directed)   behaviour: line/arrow dragged from node to node
 * onPush(id, dx, dy)          behaviour: push tool dragged from a node (the drag, in px)
   * onTool(tool)                the tool changed
   */
  constructor(container, callbacks) {
    this.el = container;
    this.scene = new Scene();
    this.mode = 'stage';
    this.tool = 'circle';
    this.view = null; // behaviour mode: state to show, with editor ids
    this.trails = []; // behaviour mode: [{from, to}] moves the steps make, drawn faintly
    this.selected = null;
    this.fresh = null; // id that just appeared (pops in)
    this.drag = null; // { mode: 'move' | 'link' | 'record' | 'push', id, dx, dy, ghost, x, y, moved }
    Object.assign(this, callbacks);

    container.addEventListener('pointerdown', (e) => this.down(e));
    container.addEventListener('pointermove', (e) => this.move(e));
    container.addEventListener('pointerup', (e) => this.up(e));
    container.addEventListener('contextmenu', (e) => e.preventDefault());
    container.addEventListener('dblclick', (e) => {
      const id = this.hitId(e);
      if (this.mode === 'stage' && id && this.scene.isNode(id)) this.onRename?.();
    });
    this.render();
  }

  setScene(scene) {
    this.scene = scene;
    this.select(null);
    this.changed();
  }

  setMode(mode, view = null) {
    this.mode = mode;
    this.view = view;
    this.drag = null;
    this.setTool(mode === 'stage' ? 'circle' : 'select');
  }

  setView(view, trails = []) {
    this.view = view;
    this.trails = trails;
    this.render();
  }

  setTool(tool) {
    this.tool = tool;
    this.el.dataset.tool = tool;
    this.render();
    this.onTool?.(tool);
  }

  /** The state on screen: the stage, or the picture after the steps. */
  state() {
    return this.mode === 'behaviour' && this.view ? this.view : sceneToState(this.scene);
  }

  render() {
    let state = this.state();
    const d = this.drag;
    if (d?.mode === 'record') {
      state = { ...state, nodes: state.nodes.map((nd) => (nd.id === d.id ? { ...nd, x: d.x, y: d.y } : nd)) };
    }
    this.el.innerHTML = renderSVG(state, {
      interactive: true, selected: this.selected, ghost: d?.ghost, fresh: this.fresh,
      trails: this.mode === 'behaviour' ? this.trails : null,
    });
  }

  changed() { this.render(); this.onChange?.(); }

  /** The object with this id as the editor sees it now (stage or picture after the steps). */
  lookup(id) {
    if (id === null || id === undefined) return null;
    if (this.mode === 'stage') return this.scene.get(id) ?? null;
    const st = this.state();
    const nd = st.nodes.find((n) => n.id === id);
    if (nd) return { ...nd, kind: 'node' };
    const e = st.edges.find((x) => x.id === id);
    return e ? { ...e, kind: 'edge' } : null;
  }

  select(id) {
    const obj = this.lookup(id);
    this.selected = obj ? id : null;
    this.render();
    this.onSelect?.(obj);
  }

  /** Select an object that just appeared, with a little pop. */
  popIn(id) {
    this.fresh = id;
    this.select(id);
    clearTimeout(this.freshTimer);
    this.freshTimer = setTimeout(() => { this.fresh = null; }, 400);
  }

  point(e) {
    const r = this.el.querySelector('svg').getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) * CANVAS.width) / r.width, 0, CANVAS.width),
      y: clamp(((e.clientY - r.top) * CANVAS.height) / r.height, 0, CANVAS.height),
    };
  }

  hitId(e) {
    const id = e.target.closest?.('[data-id]')?.dataset.id;
    if (!id) return null;
    return /^\d+$/.test(id) ? Number(id) : id; // stage ids are numbers, step-made ids 's1', …
  }

  nodeAt(p) {
    return [...this.state().nodes].reverse().find((n) => hits(n.shape ?? 'circle', n.label, n.x, n.y, p)) ?? null;
  }

  nextLabel() {
    const used = new Set(this.state().nodes.map((n) => n.label));
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
    const obj = this.lookup(id);
    this.el.setPointerCapture(e.pointerId);
    const linking = isLink(this.tool) || e.button === 2 || e.shiftKey;

    if (obj?.kind === 'node' && this.tool === 'push' && this.mode === 'behaviour') {
      this.drag = { mode: 'push', id, ghost: { x1: obj.x, y1: obj.y, x2: p.x, y2: p.y } };
      this.select(id);
    } else if (obj?.kind === 'node' && linking) {
      this.drag = { mode: 'link', id, directed: this.tool === 'arrow', ghost: { x1: obj.x, y1: obj.y, x2: p.x, y2: p.y } };
      this.select(id);
    } else if (obj?.kind === 'node') {
      this.drag = this.mode === 'behaviour'
        ? { mode: 'record', id, dx: obj.x - p.x, dy: obj.y - p.y, x: obj.x, y: obj.y, x0: obj.x, y0: obj.y }
        : { mode: 'move', id, dx: obj.x - p.x, dy: obj.y - p.y };
      this.select(id);
    } else if (obj) {
      this.select(id); // a line
    } else if (e.button === 0 && isShape(this.tool)) {
      const label = this.tool === 'text' ? 'Text' : this.nextLabel();
      const at = keepInside(this.tool, label, p.x, p.y);
      if (this.mode === 'behaviour') {
        this.onAddObject?.(this.tool, label, at.x, at.y);
      } else {
        const nid = this.scene.addNode(label, at.x, at.y, this.tool);
        this.popIn(nid);
        this.changed();
        if (this.tool === 'text') this.onRename?.();
      }
    } else {
      this.select(null);
    }
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const p = this.point(e);
    if (d.mode === 'link' || d.mode === 'push') {
      Object.assign(d.ghost, { x2: p.x, y2: p.y });
      this.render();
      return;
    }
    const obj = this.lookup(d.id);
    const at = keepInside(obj.shape ?? 'circle', obj.label, p.x + d.dx, p.y + d.dy);
    if (d.mode === 'record') {
      Object.assign(d, at);
      this.render();
    } else {
      Object.assign(this.scene.get(d.id), at);
      this.changed();
    }
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (d?.mode === 'record') {
      if (Math.hypot(d.x - d.x0, d.y - d.y0) > 3) this.onRecordMove?.(d.id, d.x, d.y);
      else this.render();
    } else if (d?.mode === 'push') {
      const { x1, y1, x2, y2 } = d.ghost;
      if (Math.hypot(x2 - x1, y2 - y1) > 5) this.onPush?.(d.id, x2 - x1, y2 - y1);
      else this.render();
    } else if (d?.mode === 'link') {
      const target = this.nodeAt(this.point(e));
      const st = this.state();
      const exists = target && st.edges.some((x) => (x.a === d.id && x.b === target.id) || (x.a === target.id && x.b === d.id));
      if (target && target.id !== d.id && !exists) {
        if (this.mode === 'behaviour') {
          this.onConnect?.(d.id, target.id, d.directed);
          return;
        }
        this.popIn(this.scene.addEdge(d.id, target.id, d.directed));
      }
      this.changed();
    }
  }

  deleteSelected() {
    if (!this.selected || this.mode !== 'stage') return;
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
