// make_row: a row of labelled boxes, e.g. an array to sort or a stack.
import { runTool, endState, ToolError } from '../ai_tools.js';
import { CANVAS } from '../scene.js';
import { listOf } from './util.js';

export default {
  name: 'make_row',
  description: 'Makes a row of boxes, one per value, evenly spaced across the canvas: an array, a list or a queue. Each box is labelled with its value; refer to the boxes by those labels (a repeated value gets a mark: 3, 3′). Example: {"values": [5, 2, 8, 1]}',
  params: {
    values: { type: 'array', items: { type: ['string', 'number'] }, description: 'the values, left to right (1 to 12 of them)' },
    y: { type: 'number', description: `how far down, 0 to ${CANVAS.height} (default the middle)` },
    color: { type: 'string', description: 'optional colour of the boxes' },
  },
  required: ['values'],
  run(p, a) {
    const values = listOf(a.values, 'values');
    if (values.length < 1 || values.length > 12) throw new ToolError('values must have 1 to 12 entries.');
    const step = Math.min(90, (CANVAS.width - 80) / values.length);
    const x0 = CANVAS.width / 2 - (step * (values.length - 1)) / 2;
    const width = Math.min(64, Math.round(step - 10));
    // without a y: the middle line, or the first free line above or below it (don't cover a row)
    const taken = [...endState(p).values()].filter((o) => o.kind === 'node').map((o) => o.y);
    const y = a.y ?? [180, 260, 100, 320, 40].find((ly) => taken.every((ty) => Math.abs(ty - ly) >= 50)) ?? 180;
    const names = values.map((v, i) => {
      const reply = runTool(p, 'add', { shape: 'box', label: String(v), x: Math.round(x0 + i * step), y, color: a.color, width, duplicate: true });
      return / so it is called (.+?)\)/.exec(reply)?.[1] ?? String(v);
    });
    return `Made a row of ${values.length} boxes: ${names.join(', ')} (left to right, ${Math.round(step)} px apart). Use swap to exchange two of them.`;
  },
};
