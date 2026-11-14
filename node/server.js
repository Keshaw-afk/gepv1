// Local web server: serves the editor page and runs video export (ffmpeg can't run in a browser).
// Usage: node node/server.js   (PORT env var, default 8080; listens on 127.0.0.1 only)

import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fengari from 'fengari';
import { runProgram, ScriptError } from '../core/lua_api.js';
import { writeFrames, encodeVideo } from './export.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
const FPS = 25;
const MAX_BODY = 1_000_000;
const MAX_VIDEO_MS = 120_000;

const STATIC_DIRS = ['web', 'core', 'examples'];
const FILES = {
  '/': path.join(ROOT, 'web/index.html'),
  '/vendor/fengari-web.js': path.join(ROOT, 'node_modules/fengari-web/dist/fengari-web.js'),
};
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.lua': 'text/plain', '.svg': 'image/svg+xml' };

function resolveStatic(urlPath) {
  if (FILES[urlPath]) return FILES[urlPath];
  const file = path.normalize(path.join(ROOT, decodeURIComponent(urlPath)));
  const ok = STATIC_DIRS.some((d) => file.startsWith(path.join(ROOT, d) + path.sep));
  return ok ? file : null;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw Object.assign(new Error('request too large'), { status: 413 });
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function handleExport(req, res) {
  let dir;
  try {
    const { stage = '', steps = '', script = '' } = JSON.parse(await readBody(req));
    const { timeline } = runProgram(fengari, { stage: String(stage), steps: String(steps), script: String(script) });
    if (timeline.durationMs > MAX_VIDEO_MS) throw Object.assign(new Error(`animation longer than ${MAX_VIDEO_MS / 1000} s`), { status: 400 });
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gepv1-'));
    await writeFrames(timeline, dir, FPS);
    const out = path.join(dir, 'out.mp4');
    await encodeVideo(dir, out, FPS);
    const mp4 = await fs.readFile(out);
    res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': mp4.length });
    res.end(mp4);
  } catch (e) {
    const status = e instanceof ScriptError || e instanceof SyntaxError ? 400 : e.status ?? 500;
    sendJson(res, status, { error: e.message });
  } finally {
    if (dir) await fs.rm(dir, { recursive: true, force: true });
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (req.method === 'POST' && url.pathname === '/api/export') return handleExport(req, res);
  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  const file = resolveStatic(url.pathname);
  try {
    if (!file) throw new Error('not found');
    const body = await fs.readFile(file);
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => console.log(`GEPV1 running at http://localhost:${PORT}/`));
