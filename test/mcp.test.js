import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../node/mcp.js';
import { newProject, runTool } from '../core/ai_tools.js';

// the MCP layer with the tools run in-process (in the app they run in the open tab)
async function connect() {
  const project = newProject();
  const call = async (name, args) => {
    try { return { content: [{ type: 'text', text: runTool(project, name, args) }] }; } catch (e) { return { content: [{ type: 'text', text: e.message }], isError: true }; }
  };
  const [a, b] = InMemoryTransport.createLinkedPair();
  await createServer(call).connect(a);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(b);
  return { client, project };
}

test('MCP: the tools and the recipe are offered, with simple schemas', async () => {
  const { client } = await connect();
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), ['draw', 'write', 'move', 'color', 'resize', 'connect', 'remove', 'rename', 'wait', 'undo', 'clear', 'show', 'make_row', 'make_tree', 'make_graph', 'swap', 'throw']);
  const draw = tools.find((t) => t.name === 'draw');
  assert.deepEqual(draw.inputSchema.required, ['shape']);
  assert.equal(tools.find((t) => t.name === 'move').inputSchema.required, undefined, 'no label needed: it means the last object');
  assert.match(client.getInstructions(), /one tool call per instruction/);
});

test('MCP: a short session builds keyframes; mistakes come back as errors the AI can read', async () => {
  const { client, project } = await connect();
  const text = async (name, args) => (await client.callTool({ name, arguments: args })).content[0].text;
  await text('draw', { shape: 'circle', label: 'A', x: 100, y: 180 });
  assert.equal(await text('move', { x: 500, seconds: 3 }), 'A moves from (100, 180) to (500, 180) from 0 to 3 s.');
  const bad = await client.callTool({ name: 'move', arguments: { label: 'B', x: 1, y: 1 } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0].text, /No object called "B"\. Objects: A\./);
  assert.match(await text('show', {}), /0–3 s: A moves to \(500, 180\)/);
  assert.equal(project.steps.length, 1);
});
