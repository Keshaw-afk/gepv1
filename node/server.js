// Local web server: serves the editor page and runs video export (ffmpeg can't run in a browser).
// Usage: node node/server.js   (PORT env var, default 8080; listens on 127.0.0.1 only)

import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fengari from 'fengari';
import { runProgram, ScriptError } from '../core/lua_api.js';
import { outputSettings, forVideo } from '../core/output.js';
import { writeFrames, encodeVideo } from './export.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8080;
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
    const { stage = '', steps = '', script = '', output: o } = JSON.parse(await readBody(req));
    let output;
    try { output = forVideo(outputSettings(o)); } catch (e) { throw Object.assign(e, { status: 400 }); }
    const { timeline } = runProgram(fengari, { stage: String(stage), steps: String(steps), script: String(script) });
    if (timeline.durationMs > MAX_VIDEO_MS) throw Object.assign(new Error(`animation longer than ${MAX_VIDEO_MS / 1000} s`), { status: 400 });
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gepv1-'));
    await writeFrames(timeline, dir, output);
    const out = path.join(dir, 'out.mp4');
    await encodeVideo(dir, out, output.fps);
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

// ---------- Live link: AI tools run in the open app tab ----------
// The tab owns the project (undo, autosave, what you see). A tool call (from node/mcp.js) is sent to
// the tab over server-sent events; the tab runs it with core/ai_tools.js and posts the reply back.
const tabs = new Set(); // open /api/live connections, newest last
const waiting = new Map(); // tool call id -> resolve
const TOOL_TIMEOUT_MS = 30_000;
const OPEN_WAIT_MS = 10_000;

function handleLive(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write(': connected\n\n');
  tabs.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 20_000);
  req.on('close', () => { clearInterval(ping); tabs.delete(res); });
}

const newestTab = () => [...tabs].at(-1);

/** Waits for an app tab; if none is open, opens the app in the default browser first. */
async function aTab() {
  if (tabs.size) return newestTab();
  if (!process.env.GEPV1_NO_OPEN) spawn('xdg-open', [`http://localhost:${PORT}/`], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  const until = Date.now() + OPEN_WAIT_MS;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 200));
    if (tabs.size) return newestTab();
  }
  throw Object.assign(new Error(`GEPV1 is not open. Open http://localhost:${PORT}/ in a browser, then try again.`), { status: 503 });
}

/** PNG of an SVG, via ffmpeg's librsvg decoder (as the MP4 frames; it reads SVG from a file only). */
async function svgToPng(svg) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gepv1-png-'));
  try {
    await fs.writeFile(path.join(dir, 'f.svg'), svg);
    await new Promise((resolve, reject) => {
      const p = spawn('ffmpeg', ['-v', 'error', '-i', 'f.svg', '-frames:v', '1', 'f.png'], { cwd: dir, stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      p.stderr.on('data', (d) => { err += d; });
      p.on('error', reject);
      p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg: ${err.trim()}`))));
    });
    return await fs.readFile(path.join(dir, 'f.png'));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function handleTool(req, res) {
  try {
    const { name, args = {} } = JSON.parse(await readBody(req));
    const tab = await aTab();
    const id = randomUUID();
    const reply = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { waiting.delete(id); reject(Object.assign(new Error('The app did not answer in time.'), { status: 504 })); }, TOOL_TIMEOUT_MS);
      waiting.set(id, (r) => { clearTimeout(timer); resolve(r); });
      tab.write(`event: tool\ndata: ${JSON.stringify({ id, name, args })}\n\n`);
    });
    if (reply.svg) {
      try { reply.png = (await svgToPng(reply.svg)).toString('base64'); } catch { /* no picture, the text still helps */ }
      delete reply.svg;
    }
    sendJson(res, 200, reply);
  } catch (e) {
    sendJson(res, e.status ?? 400, { error: e.message });
  }
}

async function handleToolResult(req, res) {
  try {
    const r = JSON.parse(await readBody(req));
    const done = waiting.get(r.id);
    if (done) { waiting.delete(r.id); done({ text: r.text, error: r.error, svg: r.svg }); }
    sendJson(res, 200, { ok: !!done });
  } catch (e) {
    sendJson(res, 400, { error: e.message });
  }
}

// ---------- The in-app assistant: chat requests to an OpenAI-compatible API ----------
// Relayed here (no CORS trouble in the browser); the key goes only to the provider the user chose.
async function handleLlm(req, res) {
  try {
    const { baseUrl, apiKey, body } = JSON.parse(await readBody(req));
    const base = new URL(String(baseUrl || 'https://api.openai.com/v1'));
    if (!['http:', 'https:'].includes(base.protocol)) throw new Error('the base URL must start with http:// or https://');
    const r = await fetch(`${base.href.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(180_000),
    });
    const text = await r.text();
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') ?? 'application/json' });
    res.end(text);
  } catch (e) {
    sendJson(res, 502, { error: { message: `Could not reach the AI: ${e.cause?.message ?? e.message}` } });
  }
}

/**
 * The /api routes change the project or call out: only this app's own pages (or a program with no
 * Origin, like node/mcp.js) may use them. JSON only, so another site's form can't post here.
 */
function trusted(req) {
  const origin = req.headers.origin;
  if (origin && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return false;
  return req.method !== 'POST' || /^application\/json\b/.test(req.headers['content-type'] ?? '');
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/') && !trusted(req)) return sendJson(res, 403, { error: 'not allowed' });
  if (req.method === 'POST' && url.pathname === '/api/llm') return handleLlm(req, res);
  if (req.method === 'POST' && url.pathname === '/api/export') return handleExport(req, res);
  if (req.method === 'POST' && url.pathname === '/api/tool') return handleTool(req, res);
  if (req.method === 'POST' && url.pathname === '/api/tool-result') return handleToolResult(req, res);
  if (req.method === 'GET' && url.pathname === '/api/live') return handleLive(req, res);
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
export { server };
