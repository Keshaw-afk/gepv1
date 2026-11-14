#!/usr/bin/env node
// gepv1 CLI: node node/cli.js stage.lua script.lua [--trace] [--frames DIR] [--video OUT.mp4] [--fps N]

import fs from 'node:fs/promises';
import path from 'node:path';
import fengari from 'fengari';
import { runProgram, ScriptError } from '../core/lua_api.js';
import { formatTrace } from '../core/trace.js';
import { writeFrames, encodeVideo } from './export.js';

const USAGE = 'usage: gepv1 stage.lua script.lua [--trace] [--frames DIR] [--video OUT.mp4] [--fps N]';

function parseArgs(argv) {
  const opts = { files: [], trace: false, frames: null, video: null, fps: 25 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trace') opts.trace = true;
    else if (a === '--frames') opts.frames = argv[++i];
    else if (a === '--video') opts.video = argv[++i];
    else if (a === '--fps') opts.fps = Number(argv[++i]);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}\n${USAGE}`);
    else opts.files.push(a);
  }
  if (opts.files.length !== 2) throw new Error(USAGE);
  if (!(opts.fps > 0 && opts.fps <= 60)) throw new Error('--fps must be between 1 and 60');
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const [stage, script] = await Promise.all(opts.files.map((f) => fs.readFile(f, 'utf8')));
  const result = runProgram(fengari, { stage, script });

  if (opts.trace) console.log(formatTrace(result, { fps: opts.fps }).join('\n'));
  else for (const l of result.log) console.log(l);

  const framesDir = opts.frames ?? (opts.video ? path.join(path.dirname(opts.video), 'frames') : null);
  if (framesDir) {
    await fs.rm(framesDir, { recursive: true, force: true });
    const n = await writeFrames(result.timeline, framesDir, opts.fps);
    console.log(`[svg]       wrote ${n} frames to ${framesDir}/`);
  }
  if (opts.video) {
    await fs.mkdir(path.dirname(opts.video), { recursive: true });
    await encodeVideo(framesDir, opts.video, opts.fps);
    console.log(`[video]     ${opts.video} (ffmpeg)`);
  }
}

main().catch((e) => {
  console.error(e instanceof ScriptError ? `Lua error: ${e.message}` : e.message);
  process.exit(1);
});
