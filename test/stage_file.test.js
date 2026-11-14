import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../core/scene.js';
import { toStageLua } from '../core/stage_file.js';
import { run } from './helpers.js';

const shape = (scene) => ({
  nodes: scene.nodes().map((n) => [n.label, n.x, n.y]),
  edges: scene.edges().map((e) => [scene.get(e.a).label, scene.get(e.b).label]),
});

test('editor scene -> stage.lua -> Lua round-trips, including awkward labels', () => {
  const s = new Scene();
  const labels = ['A', 'two words', 'A', 'say "hi"\\', 'end', 'color', 'node_1', 'tab\there'];
  const ids = labels.map((l, i) => s.addNode(l, 10 * i, 5 * i));
  s.addEdge(ids[0], ids[1]); s.addEdge(ids[4], ids[5]); s.addEdge(ids[2], ids[7]);
  const deleted = s.addNode('gone', 0, 0); s.remove(deleted); // id gap

  const lua = toStageLua(s);
  const r = run(lua, 'color(A, "red")'); // API function `color` must not have been overwritten
  assert.deepEqual(shape(r.scene), shape(s));
  assert.match(lua, /^A = node\("A", 0, 0\)$/m);
  assert.doesNotMatch(lua, /^(color|end) =/m);
});
