import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from '../core/scene.js';

test('neighbors are undirected and in edge creation order; edgeOf is symmetric', () => {
  const s = new Scene();
  const a = s.addNode('A', 0, 0), b = s.addNode('B', 0, 0), c = s.addNode('C', 0, 0);
  const ab = s.addEdge(a, b), ca = s.addEdge(c, a);
  assert.deepEqual(s.neighbors(a), [b, c]);
  assert.deepEqual(s.neighbors(c), [a]);
  assert.equal(s.edgeOf(a, b), ab);
  assert.equal(s.edgeOf(b, a), ab);
  assert.equal(s.edgeOf(a, c), ca);
  assert.equal(s.edgeOf(b, c), null);
});

test('duplicate and self edges are rejected; removing a node removes its edges', () => {
  const s = new Scene();
  const a = s.addNode('A', 0, 0), b = s.addNode('B', 0, 0);
  s.addEdge(a, b);
  assert.throws(() => s.addEdge(b, a), /already exists/);
  assert.throws(() => s.addEdge(a, a), /itself/);
  s.remove(a);
  assert.equal(s.edges().length, 0);
  assert.deepEqual(s.nodes().map((n) => n.id), [b]);
});
