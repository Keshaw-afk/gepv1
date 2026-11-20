// swap: two objects trade places, one over and one under, at the same time.
import { runTool, find, ToolError } from '../ai_tools.js';
import { arc } from './util.js';

export default {
  name: 'swap',
  description: 'Two objects trade places, travelling in arcs (one over, one under) so they do not collide, as in sorting. Like every action it happens after the previous one. Example: {"a": "5", "b": "2"}',
  params: {
    a: { type: 'string', description: 'label of the first object' },
    b: { type: 'string', description: 'label of the second object' },
    seconds: { type: 'number', description: 'how long it takes (default 1)' },
    together: { type: 'boolean', description: 'true = at the same time as the previous action' },
  },
  required: ['a', 'b'],
  run(p, args) {
    const A = find(p, args.a, { kind: 'node' }).obj, B = find(p, args.b, { kind: 'node' }).obj;
    if (A.id === B.id) throw new ToolError('a and b must be two different objects.');
    const lift = Math.max(40, Math.min(90, Math.hypot(B.x - A.x, B.y - A.y) / 3));
    const toList = (pts) => pts.map((q) => [q.x, q.y]);
    runTool(p, 'move', { label: A.name, x: B.x, y: B.y, via: toList(arc(A, B, lift, 3)), seconds: args.seconds, together: args.together });
    runTool(p, 'move', { label: B.name, x: A.x, y: A.y, via: toList(arc(B, A, lift, 3)), seconds: args.seconds, together: true });
    p.last = [A.id, B.id];
    return `${A.name} and ${B.name} swap places.`;
  },
};
