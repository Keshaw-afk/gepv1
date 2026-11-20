// GUI editor with two modes:
//   'stage'      draw the starting picture (edits core/Scene)
//   'behaviour'  shows the picture after the steps (this.view); every edit becomes a step through
//                the callbacks (record moves, add an object, connect two, resize), the stage is untouched.
// One tool is active at a time (see TOOLS): select, a shape, or line/arrow. Drag on empty space with
// any tool to draw a free-hand loop around several objects (lasso); Ctrl/Cmd-click adds or removes one.
// A selected object shows handles: right edge = width, bottom edge = height, corner = both (Shift keeps
// the proportions).
// All model logic lives in core/; this file only turns pointer events into edits and re-renders.

import { Scene, CANVAS, GRID } from '../core/scene.js';
import { sceneToState } from '../core/player.js';
import { renderSVG } from '../core/svg.js';
import { halfSize, hits, SHAPES, SIZE, sizeOf, sameSize } from '../core/shapes.js';
import { arrange } from '../core/arrange.js';
import { simplify, bend } from '../core/paths.js';

export const CURVE_BEND = 8; // a drag that strays this far from a straight line is a curved move

export const TOOLS = ['select', ...SHAPES, 'line', 'arrow'];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const isShape = (tool) => SHAPES.includes(tool);
const isLink = (tool) => tool === 'line' || tool === 'arrow';
const LASSO_AFTER = 4; // canvas units a press has to travel before it is a lasso and not a click
const snapTo = (v) => Math.round(v / GRID) * GRID;
const roundSize = (v) => clamp(Math.round(v * 20) / 20, SIZE.min, SIZE.max);

/**
 * The area a lasso drag selects: the loop itself, or, when the drag is nearly a straight stroke (it
 * encloses almost nothing), the box between its ends, so a quick diagonal drag still selects.
 */
export function lassoRegion(path) {
  if (path.length < 2) return [];
  const xs = path.map((p) => p.x), ys = path.map((p) => p.y);
  const box = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  let area = 0;
  for (let i = 0, j = path.length - 1; i < path.length; j = i++) area += (path[j].x + path[i].x) * (path[j].y - path[i].y);
  if (Math.abs(area / 2) >= 0.25 * box) return path;
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
}

/** Is point p inside the polygon (a list of points)? Even-odd rule. */
function insidePolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Keeps a shape's centre where the whole shape stays on the canvas. */
export function keepInside(shape, label, x, y, size = 1) {
  const h = halfSize(shape, label, size);
  return {
    x: Math.round(clamp(x, h.x, Math.max(h.x, CANVAS.width - h.x))),
    y: Math.round(clamp(y, h.y, Math.max(h.y, CANVAS.height - h.y))),
  };
}

/** How far a group of nodes can move by (dx, dy) and still stay on the canvas. */
function fitDelta(nodes, dx, dy) {
  let lox = -Infinity, hix = Infinity, loy = -Infinity, hiy = Infinity;
  for (const n of nodes) {
    const h = halfSize(n.shape ?? 'circle', n.label, n.size ?? 1);
    lox = Math.max(lox, h.x - n.x); hix = Math.min(hix, CANVAS.width - h.x - n.x);
    loy = Math.max(loy, h.y - n.y); hiy = Math.min(hiy, CANVAS.height - h.y - n.y);
  }
  return { dx: lox > hix ? 0 : clamp(dx, lox, hix), dy: loy > hiy ? 0 : clamp(dy, loy, hiy) };
}

export class Editor {
  /**
   * onChange()                   after any stage edit
   * onSelect(objs)               when the selection changes: [{id, kind, label, shape, size, …}]
   * onRename()                   double-click on a stage node
   * onRecordMoves(moves)         behaviour: nodes were dragged or arranged: [{id, x, y, points?}]
   *                              (points: the curve of a bent drag, after the start, ending at x, y)
   * onAddObject(shape, label, x, y)  behaviour: a shape tool clicked empty space
   * onConnect(a, b, directed)    behaviour: line/arrow dragged from node to node
   * onResize(list)               behaviour: sizes changed: [{id, size: {w, h}}]
   * onPaste(plan)                behaviour: paste a copy; plan = {nodes: [{shape, label, x, y, size, color}],
   *                              edges: [{a, b, directed, color}]} (a, b are indexes into nodes); returns the new ids
   * onTool(tool)                 the tool changed
   */
  constructor(container, callbacks) {
    this.el = container;
    this.scene = new Scene();
    this.mode = 'stage';
    this.tool = 'circle';
    this.view = null; // behaviour mode: state to show, with editor ids
    this.trails = []; // behaviour mode: [[{x, y}, …]] moves the steps make, drawn faintly
    this.sel = new Set(); // selected ids
    this.fresh = null; // id that just appeared (pops in)
    this.snap = false; // snap to the grid
    this.coords = false; // show the coordinate guide and where the pointer is
    this.recording = false; // Record mode: show the shape of a drag (it becomes a curved move)
    this.clipboard = null; // { nodes, edges, pastes }
    this.drag = null;
    Object.assign(this, callbacks);

    container.addEventListener('pointerdown', (e) => this.down(e));
    container.addEventListener('pointermove', (e) => {
      if (this.coords && this.el.querySelector('svg')) { const q = this.point(e); this.onPointer?.(Math.round(q.x), Math.round(q.y)); }
      this.move(e);
    });
    container.addEventListener('pointerleave', () => this.onPointer?.(null));
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
    this.setSelection([]);
    this.changed();
  }

  /**
   * 'stage' edits the starting picture; 'behaviour' shows `view` and turns edits into steps;
   * 'view' only shows `view` (what the code does): nothing can be selected or changed. The tool stays.
   */
  setMode(mode, view = null, trails = []) {
    this.mode = mode;
    this.view = view;
    this.trails = trails;
    this.drag = null;
    this.setSelection(mode === 'view' ? [] : this.selectedIds()); // keeps what still exists at this point
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

  setCoords(on) {
    this.coords = !!on;
    this.render();
  }

  setSnap(on) {
    this.snap = !!on;
    this.render();
  }

  /** The state on screen: the stage, or the picture after the steps. */
  state() {
    return this.mode !== 'stage' && this.view ? this.view : sceneToState(this.scene);
  }

  render() {
    let state = this.state();
    const d = this.drag;
    const extraTrails = d?.mode === 'record' && this.recording && d.trace.length > 1 ? [d.trace] : []; // the curve being drawn
    if (d?.mode === 'record') {
      state = { ...state, nodes: state.nodes.map((nd) => (d.pos.has(nd.id) ? { ...nd, ...d.pos.get(nd.id) } : nd)) };
    } else if (d?.mode === 'resize' && this.mode === 'behaviour') {
      state = { ...state, nodes: state.nodes.map((nd) => (nd.id === d.id ? { ...nd, size: d.size } : nd)) };
    }
    this.el.innerHTML = renderSVG(state, {
      interactive: true, selected: this.sel, handle: !d || d.mode === 'resize', ghost: d?.ghost, fresh: this.fresh,
      lasso: d?.mode === 'lasso' ? lassoRegion(d.path) : null, grid: this.snap, coords: this.coords,
      trails: this.mode !== 'stage' ? [...this.trails, ...extraTrails] : null,
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

  // ---------- selection ----------

  /** The one selected object's id, or null when nothing or several are selected. */
  get selected() { return this.sel.size === 1 ? [...this.sel][0] : null; }
  selectedIds() { return [...this.sel]; }
  selection() { return [...this.sel].map((id) => this.lookup(id)).filter(Boolean); }
  selectedNodes() { return this.selection().filter((o) => o.kind === 'node'); }

  setSelection(ids) {
    this.sel = new Set(ids.filter((id) => this.lookup(id) && !this.lookup(id).locked)); // code's objects can't be picked
    this.render();
    this.onSelect?.(this.selection());
  }

  select(id) { this.setSelection(id === null || id === undefined ? [] : [id]); }

  toggle(id) {
    const next = new Set(this.sel);
    if (next.has(id)) next.delete(id); else next.add(id);
    this.setSelection([...next]);
  }

  selectAll() {
    if (this.mode === 'view') return;
    const st = this.state();
    this.setSelection([...st.nodes.map((n) => n.id), ...st.edges.map((e) => e.id)]);
  }

  /** Select an object that just appeared, with a little pop. */
  popIn(id) {
    this.fresh = id;
    this.select(id);
    clearTimeout(this.freshTimer);
    this.freshTimer = setTimeout(() => { this.fresh = null; }, 400);
  }

  // ---------- pointer ----------

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
    return [...this.state().nodes].reverse().find((n) => hits(n.shape ?? 'circle', n.label, n.x, n.y, p, n.size ?? 1)) ?? null;
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
    if (this.mode === 'view') return; // read-only
    const p = this.point(e);
    this.el.setPointerCapture(e.pointerId);
    const additive = e.ctrlKey || e.metaKey;

    const grip = e.target.closest?.('[data-handle]')?.dataset.handle;
    if (grip && this.selected !== null) {
      const nd = this.lookup(this.selected);
      if (nd?.kind === 'node') {
        this.drag = { mode: 'resize', id: nd.id, grip, size: sizeOf(nd.size), start: sizeOf(nd.size) };
        return;
      }
    }

    const id = this.hitId(e);
    const obj = this.lookup(id);
    if (obj?.locked) { this.onLocked?.(obj); return; } // made by code: changed only in code
    const linking = isLink(this.tool) || e.button === 2 || e.shiftKey;

    if (obj?.kind === 'node') {
      if (additive) { this.toggle(id); return; }
      if (linking) {
        this.drag = { mode: 'link', id, directed: this.tool === 'arrow', shift: e.shiftKey, p0: p, ghost: { x1: obj.x, y1: obj.y, x2: p.x, y2: p.y } };
        if (!this.sel.has(id)) this.select(id);
      } else {
        if (!this.sel.has(id)) this.select(id);
        const nodes = this.selectedNodes();
        const start = new Map(nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
        this.drag = { mode: this.mode === 'behaviour' ? 'record' : 'move', id, p0: p, start, pos: new Map(start), nodes, trace: [start.get(id)] };
      }
    } else if (obj) {
      if (additive) this.toggle(id); else this.select(id); // a line
    } else if (e.button === 0) {
      // empty space: a click adds a shape (or clears the selection), a drag is a lasso
      this.drag = { mode: 'empty', p0: p, additive: additive || e.shiftKey, base: new Set(this.sel), path: [p] };
    }
  }

  move(e) {
    const d = this.drag;
    if (!d) return;
    const p = this.point(e);

    if (d.mode === 'link') {
      Object.assign(d.ghost, { x2: p.x, y2: p.y });
      this.render();
    } else if (d.mode === 'move' || d.mode === 'record') {
      let dx = p.x - d.p0.x, dy = p.y - d.p0.y;
      if (this.snap) { // the object under the pointer lands on the grid, the others keep their distance to it
        const s = d.start.get(d.id);
        dx = snapTo(s.x + dx) - s.x;
        dy = snapTo(s.y + dy) - s.y;
      }
      ({ dx, dy } = fitDelta(d.nodes.map((n) => ({ ...n, ...d.start.get(n.id) })), dx, dy));
      for (const [id, s] of d.start) d.pos.set(id, { x: Math.round(s.x + dx), y: Math.round(s.y + dy) });
      if (d.mode === 'record') {
        const at = d.pos.get(d.id), last = d.trace.at(-1);
        if (Math.hypot(at.x - last.x, at.y - last.y) >= 2) d.trace.push(at); // the shape of the drag
        this.render();
      } else {
        for (const [id, at] of d.pos) Object.assign(this.scene.get(id), at);
        this.changed();
      }
    } else if (d.mode === 'resize') {
      const nd = this.lookup(d.id);
      const shape = nd.shape ?? 'circle';
      const h1 = halfSize(shape, nd.label, 1);
      const w = (p.x - nd.x - 8) / h1.x, h = (p.y - nd.y - 8) / h1.y; // the handles sit 8 px outside the edge
      if (d.grip === 'w') d.size = { w: roundSize(w), h: d.start.h };
      else if (d.grip === 'h') d.size = { w: d.start.w, h: roundSize(h) };
      else if (e.shiftKey || shape === 'text') {
        // keep the proportions: follow the pointer along the corner's diagonal
        const k = Math.max(w / d.start.w, h / d.start.h);
        const lim = Math.min(SIZE.max / Math.max(d.start.w, d.start.h), Math.max(k, SIZE.min / Math.min(d.start.w, d.start.h)));
        d.size = { w: roundSize(d.start.w * lim), h: roundSize(d.start.h * lim) };
      } else d.size = { w: roundSize(w), h: roundSize(h) };
      if (this.mode === 'stage') {
        const o = this.scene.get(d.id);
        o.size = d.size;
        Object.assign(o, keepInside(o.shape, o.label, o.x, o.y, o.size));
        this.changed();
      } else {
        this.render();
      }
    } else if (d.mode === 'empty' || d.mode === 'lasso') {
      const last = d.path.at(-1);
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 3) d.path.push(p);
      if (d.mode === 'empty' && Math.hypot(p.x - d.p0.x, p.y - d.p0.y) > LASSO_AFTER) d.mode = 'lasso';
      if (d.mode === 'lasso') {
        this.sel = new Set([...(d.additive ? d.base : []), ...this.insideLasso(d.path)]);
        this.render();
      }
    }
  }

  /** Ids inside the free-hand loop: nodes whose centre is in it, and the lines between two such nodes. */
  insideLasso(path) {
    path = lassoRegion(path);
    if (path.length < 3) return [];
    const st = this.state();
    const nodes = new Set(st.nodes.filter((n) => insidePolygon(n, path)).map((n) => n.id));
    return [...nodes, ...st.edges.filter((e) => nodes.has(e.a) && nodes.has(e.b)).map((e) => e.id)];
  }

  up(e) {
    const d = this.drag;
    this.drag = null;
    if (!d) return;

    if (d.mode === 'record') {
      // a drag that bends is a curved move: every dragged object follows the same shape
      const trace = [...d.trace, d.pos.get(d.id)];
      const curve = bend(trace) >= CURVE_BEND ? simplify(trace, 3).slice(1) : null;
      const moves = [...d.pos].filter(([id, at]) => at.x !== d.start.get(id).x || at.y !== d.start.get(id).y)
        .map(([id, at]) => {
          if (!curve) return { id, ...at };
          const s = d.start.get(id), s0 = d.start.get(d.id);
          return { id, ...at, points: curve.map((p) => ({ x: Math.round(p.x - s0.x + s.x), y: Math.round(p.y - s0.y + s.y) })) };
        });
      if (Math.hypot(d.pos.get(d.id).x - d.start.get(d.id).x, d.pos.get(d.id).y - d.start.get(d.id).y) > 3 && moves.length) this.onRecordMoves?.(moves);
      else this.render();
    } else if (d.mode === 'move') {
      this.render();
    } else if (d.mode === 'resize') {
      if (this.mode === 'behaviour' && !sameSize(d.size, this.lookup(d.id)?.size ?? 1)) this.onResize?.([{ id: d.id, size: d.size }]);
      else this.render();
    } else if (d.mode === 'lasso') {
      this.setSelection([...this.sel]);
    } else if (d.mode === 'empty') {
      const p = this.point(e);
      if (isShape(this.tool)) this.addShapeAt(p);
      else if (!d.additive) this.select(null);
      else this.render();
    } else if (d.mode === 'link') {
      const p = this.point(e);
      const target = this.nodeAt(p);
      if (d.shift && Math.hypot(p.x - d.p0.x, p.y - d.p0.y) < LASSO_AFTER) { this.toggle(d.id); return; } // a shift-click
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

  addShapeAt(p) {
    const label = this.tool === 'text' ? 'Text' : this.nextLabel();
    const at = keepInside(this.tool, label, this.snap ? snapTo(p.x) : p.x, this.snap ? snapTo(p.y) : p.y);
    if (this.mode === 'behaviour') {
      this.onAddObject?.(this.tool, label, at.x, at.y);
    } else {
      const nid = this.scene.addNode(label, at.x, at.y, this.tool);
      this.popIn(nid);
      this.changed();
      if (this.tool === 'text') this.onRename?.();
    }
  }

  // ---------- editing the selection ----------

  deleteSelected() {
    if (!this.sel.size || this.mode !== 'stage') return;
    for (const id of this.sel) if (this.scene.get(id)) this.scene.remove(id);
    this.setSelection([]);
    this.changed();
  }

  setLabel(label) {
    const o = this.scene.get(this.selected);
    if (o?.kind !== 'node') return;
    o.label = label;
    this.changed();
  }

  /**
   * Sets the width and/or height factor of every selected node: change = { w?, h? } (a text shape takes
   * either for both). The stage changes now; Behaviour asks the page for steps.
   */
  setSize(change) {
    const r = (v) => clamp(Math.round(v * 100) / 100, SIZE.min, SIZE.max);
    const nodes = this.selectedNodes();
    if (!nodes.length) return;
    const next = (n) => {
      const z = sizeOf(n.size);
      if (n.shape === 'text') { const v = r(change.w ?? change.h); return { w: v, h: v }; }
      return { w: change.w === undefined ? z.w : r(change.w), h: change.h === undefined ? z.h : r(change.h) };
    };
    const changed = nodes.map((n) => ({ n, size: next(n) })).filter(({ n, size }) => !sameSize(n.size, size));
    if (!changed.length) return;
    if (this.mode === 'behaviour') { this.onResize?.(changed.map(({ n, size }) => ({ id: n.id, size }))); return; }
    for (const { n, size } of changed) {
      const o = this.scene.get(n.id);
      o.size = size;
      Object.assign(o, keepInside(o.shape, o.label, o.x, o.y, size));
    }
    this.changed();
  }

  /** Stage only: colour every selected object (Behaviour makes colour steps instead). */
  setColor(color) {
    if (this.mode !== 'stage' || !this.sel.size) return;
    for (const id of this.sel) { const o = this.scene.get(id); if (o) o.color = color; }
    this.changed();
  }

  /** Stage only: move the selected nodes by (dx, dy) px, e.g. with the arrow keys. */
  nudge(dx, dy) {
    const nodes = this.selectedNodes();
    if (this.mode !== 'stage' || !nodes.length) return;
    const fit = fitDelta(nodes, dx, dy);
    for (const n of nodes) Object.assign(this.scene.get(n.id), { x: n.x + fit.dx, y: n.y + fit.dy });
    this.changed();
  }

  /** Align or spread the selected nodes (see core/arrange.js). */
  arrangeSelected(kind) {
    const moves = arrange(this.selectedNodes(), kind);
    if (!moves.length) return;
    if (this.mode === 'behaviour') { this.onRecordMoves?.(moves.map(({ id, x, y }) => ({ id, x, y }))); return; }
    for (const m of moves) Object.assign(this.scene.get(m.id), { x: m.x, y: m.y });
    this.changed();
  }

  /** Remembers the selected nodes and the lines between them. Returns how many nodes. */
  copy() {
    const nodes = this.selectedNodes();
    if (!nodes.length) return 0;
    const index = new Map(nodes.map((n, i) => [n.id, i]));
    this.clipboard = {
      nodes: nodes.map(({ shape, label, x, y, size, color }) => ({ shape: shape ?? 'circle', label, x, y, size: sizeOf(size), color })),
      edges: this.state().edges.filter((e) => index.has(e.a) && index.has(e.b)).map((e) => ({ a: index.get(e.a), b: index.get(e.b), directed: !!e.directed, color: e.color })),
      pastes: 0,
    };
    return nodes.length;
  }

  /** Adds a copy of the clipboard, a little down and right of the original; selects the copy. */
  paste() {
    if (this.mode === 'view') return;
    const c = this.clipboard;
    if (!c) return;
    const off = GRID * ++c.pastes;
    const { dx, dy } = fitDelta(c.nodes, off, off);
    const plan = { nodes: c.nodes.map((n) => ({ ...n, x: n.x + dx, y: n.y + dy })), edges: c.edges };
    if (this.mode === 'behaviour') {
      const ids = this.onPaste?.(plan) ?? [];
      this.setSelection(ids);
      return;
    }
    const ids = plan.nodes.map((n) => this.scene.addNode(n.label, n.x, n.y, n.shape, n.size));
    const edges = plan.edges.map((e) => this.scene.addEdge(ids[e.a], ids[e.b], e.directed));
    plan.nodes.forEach((n, i) => { if (n.color) this.scene.get(ids[i]).color = n.color; });
    plan.edges.forEach((e, i) => { if (e.color) this.scene.get(edges[i]).color = e.color; });
    this.setSelection([...ids, ...edges]);
    this.changed();
  }

  duplicate() { if (this.copy()) this.paste(); }
}
