#!/usr/bin/env node
// GEPV1 as an MCP server (stdio), so an AI (Claude Desktop, Claude Code, any MCP client) can build
// animations with the tools in core/ai_tools.js and the plugins. The tools run in the open app tab,
// so you watch the animation being built and can edit every keyframe afterwards.
//
//   claude mcp add gepv1 -- node /path/to/gepv1/node/mcp.js
//
// It starts the app server if it isn't running (PORT, default 8080), and the server opens the app in
// the browser when the first tool is called. stdout belongs to the MCP protocol: log to stderr only.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { TOOLS } from '../core/plugins/index.js';
import { schemaOf, RECIPE } from '../core/ai_tools.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const BASE = `http://127.0.0.1:${PORT}`;

const up = () => fetch(`${BASE}/`, { method: 'HEAD' }).then(() => true, () => false);

/** Makes sure the app server answers; starts it (detached, it outlives this process) if not. */
async function ensureServer() {
  if (await up()) return;
  spawn(process.execPath, [path.join(ROOT, 'node/server.js')], { cwd: ROOT, detached: true, stdio: 'ignore', env: process.env }).unref();
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await up()) return;
  }
  throw new Error(`Could not start the GEPV1 app server on port ${PORT}.`);
}

/** Calls a tool in the app; returns MCP content. */
export async function callTool(name, args) {
  await ensureServer();
  let reply;
  try {
    const res = await fetch(`${BASE}/api/tool`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, args }) });
    reply = await res.json();
  } catch (e) {
    reply = { error: `Could not reach the GEPV1 app: ${e.message}` };
  }
  if (reply.error) return { content: [{ type: 'text', text: reply.error }], isError: true };
  const content = [{ type: 'text', text: reply.text }];
  if (reply.png) content.push({ type: 'image', data: reply.png, mimeType: 'image/png' });
  return { content };
}

export function createServer(call = callTool) {
  const server = new Server({ name: 'gepv1', version: '3.6.0' }, { capabilities: { tools: {} }, instructions: RECIPE });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: schemaOf(t) })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => call(req.params.name, req.params.arguments ?? {}));
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await createServer().connect(new StdioServerTransport());
}
