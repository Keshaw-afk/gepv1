// throw: a projectile arc, the simplest simulation, recorded as a curved move.
import { runTool, find, ToolError } from '../ai_tools.js';
import { CANVAS } from '../scene.js';

export default {
  name: 'throw',
  description: 'Throws an object along a projectile (parabola) arc to (x, y), rising `height` px above the higher end: a ball, a packet, a jump. It happens in the current keyframe (a keyframe is started if needed). Example: {"label": "ball", "x": 500, "y": 300, "height": 150}',
  params: {
    label: { type: 'string', description: 'which object' },
    x: { type: 'number', description: `where it lands, 0 to ${CANVAS.width}` },
    y: { type: 'number', description: `where it lands, 0 to ${CANVAS.height}` },
    height: { type: 'number', description: 'how high the arc rises above the higher end, in px (default 120)' },
  },
  required: ['label', 'x', 'y'],
  run(p, a) {
    if (p.cursor === 'start') runTool(p, 'next_keyframe', {});
    const from = find(p, a.label, { kind: 'node' }).obj;
    const to = { x: Number(a.x), y: Number(a.y) };
    const h = a.height === undefined ? 120 : Number(a.height);
    if (!Number.isFinite(h) || h < 0 || h > 340) throw new ToolError('height must be 0 to 340 px.');
    const top = Math.max(10, Math.min(from.y, to.y) - h);
    // the parabola through start, end and the top (as a thrown object's path is); sampled
    const k1 = Math.sqrt(Math.max(1, from.y - top)), k2 = Math.sqrt(Math.max(1, to.y - top));
    const tTop = k1 / (k1 + k2); // where along the way the top is
    const via = [];
    for (let i = 1; i < 8; i++) {
      const t = i / 8, u = (t - tTop) / (t < tTop ? tTop : 1 - tTop);
      const y = top + (t < tTop ? from.y - top : to.y - top) * u * u;
      via.push([Math.round(from.x + (to.x - from.x) * t), Math.round(Math.max(0, y))]);
    }
    runTool(p, 'move', { label: from.label, x: a.x, y: a.y, via });
    return `${from.label} is thrown in an arc from (${Math.round(from.x)}, ${Math.round(from.y)}) to (${to.x}, ${to.y}), peaking at y = ${Math.round(top)}.`;
  },
};
