#!/usr/bin/env node
// gepv1 CLI: node node/cli.js stage.lua script.lua [options]   (see USAGE)

import fs from 'node:fs/promises';
import path from 'node:path';
import fengari from 'fengari';
import { runProgram, ScriptError } from '../core/lua_api.js';
import { formatTrace } from '../core/trace.js';
import { renderAnimatedSVG } from '../core/animated_svg.js';
import { frameTimes } from '../core/player.js';
import { renderFrame } from '../core/frames.js';
import { outputSettings, forVideo } from '../core/output.js';
import { writeFrames, encodeVideo } from './export.js';

const USAGE = `usage: gepv1 stage.lua script.lua [options]
  --trace              print what each pipeline stage produced
  --frame N OUT.svg    write frame N (0 = first; same numbering as the page and --frames)
  --frames DIR         write every frame as DIR/frame_00000.svg, ...
  --svg OUT.svg        write the animated SVG
  --video OUT.mp4      encode an MP4 with ffmpeg
  --fps N              frames per second (default 25)
  --scale N            1, 2 or 3 × 640×360 (default 1)
  --background C       colour, or "transparent" (SVG only; the video uses white)
  --font F             sans-serif, serif or monospace`;

function parseArgs(argv) {
  const opts = { files: [], trace: false, frame: null, frames: null, video: null, svg: null, output: {} };
  const value = (i, flag) => {
    if (i >= argv.length || argv[i].startsWith('--')) throw new Error(`${flag} needs a value\n${USAGE}`);
    return argv[i];
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--trace') opts.trace = true;
    else if (a === '--frame') opts.frame = { n: Number(value(++i, a)), out: value(++i, a) };
    else if (a === '--frames') opts.frames = value(++i, a);
    else if (a === '--video') opts.video = value(++i, a);
    else if (a === '--svg') opts.svg = value(++i, a);
    else if (['--fps', '--scale', '--background', '--font'].includes(a)) opts.output[a.slice(2)] = value(++i, a);
    else if (a.startsWith('--')) throw new Error(`unknown option ${a}\n${USAGE}`);
    else opts.files.push(a);
  }
  if (opts.files.length !== 2) throw new Error(USAGE);
  opts.output = outputSettings(opts.output);
  return opts;
}

async function write(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const { output } = opts;
  const [stage, script] = await Promise.all(opts.files.map((f) => fs.readFile(f, 'utf8')));
  const result = runProgram(fengari, { stage, script });
  const times = frameTimes(result.timeline.durationMs, output.fps);

  if (opts.trace) console.log(formatTrace(result, { fps: output.fps }).join('\n'));
  else for (const l of result.log) console.log(l);

  if (opts.frame) {
    const { n, out } = opts.frame;
    if (!(Number.isInteger(n) && n >= 0 && n < times.length)) throw new Error(`--frame must be 0 to ${times.length - 1}`);
    await write(out, renderFrame(result.timeline, times, n, output));
    console.log(`[svg]       ${out} (frame ${n}, t = ${(times[n] / 1000).toFixed(2)} s)`);
  }
  const framesDir = opts.frames ?? (opts.video ? path.join(path.dirname(opts.video), 'frames') : null);
  if (framesDir) {
    await fs.rm(framesDir, { recursive: true, force: true });
    // The video needs an opaque background, so frames written for it use white instead of transparent.
    const n = await writeFrames(result.timeline, framesDir, opts.video ? forVideo(output) : output);
    console.log(`[svg]       wrote ${n} frames to ${framesDir}/`);
  }
  if (opts.svg) {
    await write(opts.svg, renderAnimatedSVG(result.timeline, output));
    console.log(`[svg]       ${opts.svg} (animated, plays in a browser)`);
  }
  if (opts.video) {
    await fs.mkdir(path.dirname(opts.video), { recursive: true });
    await encodeVideo(framesDir, opts.video, output.fps);
    console.log(`[video]     ${opts.video} (ffmpeg)`);
  }
}

main().catch((e) => {
  console.error(e instanceof ScriptError ? `Lua error: ${e.message}` : e.message);
  process.exit(1);
});
