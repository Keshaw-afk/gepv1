// swap: two objects trade places, one over and one under, in the current keyframe.
import { runTool, find, ToolError } from '../ai_tools.js';
import { arc } from './util.js';

export default {
  name: 'swap',
  description: 'Two objects trade places, travelling in arcs (one over, one under) so they do not collide, as in sorting. It happens in the current keyframe (a keyframe is started if needed). Example: {"a": "5", "b": "2"}',
  params: {
    a: { type: 'string', description: 'label of the first object' },
    b: { type: 'string', description: 'label of the second object' },
  },
  required: ['a', 'b'],
  run(p, args) {
    if (p.cursor === 'start') runTool(p, 'next_keyframe', {});
    const A = find(p, args.a, { kind: 'node' }).obj, B = find(p, args.b, { kind: 'node' }).obj;
    if (A.id === B.id) throw new ToolError('a and b must be two different objects.');
    const lift = Math.max(40, Math.min(90, Math.hypot(B.x - A.x, B.y - A.y) / 3));
    const toList = (pts) => pts.map((q) => [q.x, q.y]);
    runTool(p, 'move', { label: A.label, x: B.x, y: B.y, via: toList(arc(A, B, lift, 3)) });
    runTool(p, 'move', { label: B.label, x: A.x, y: A.y, via: toList(arc(B, A, lift, 3)) });
    return `${A.label} and ${B.label} swap places in this keyframe. Call next_keyframe before the next swap so they happen one after another.`;
  },
};
