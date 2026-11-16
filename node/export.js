// Frames -> video, using ffmpeg (its built-in librsvg decoder reads the SVG frames directly).

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { frameTimes } from '../core/player.js';
import { renderFrame, frameName } from '../core/frames.js';

export function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-hide_banner', '-decoders'], { encoding: 'utf8' }).stdout?.includes('librsvg') ?? false;
}

/** Writes frame_00000.svg, frame_00001.svg, ... into dir (exported SVG, see svg.js). Returns the frame count. */
export async function writeFrames(timeline, dir, output) {
  await fs.mkdir(dir, { recursive: true });
  const times = frameTimes(timeline.durationMs, output.fps);
  for (let i = 0; i < times.length; i++) {
    await fs.writeFile(path.join(dir, frameName(i)), renderFrame(timeline, times, i, output));
  }
  return times.length;
}

/** Encodes the SVG frames in dir into an MP4 at outFile. */
export function encodeVideo(dir, outFile, fps) {
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-framerate', String(fps),
    '-i', path.join(dir, 'frame_%05d.svg'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', outFile];
  return new Promise((resolve, reject) => {
    const p = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`could not run ffmpeg: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve(outFile) : reject(new Error(`ffmpeg failed (${code}): ${err.trim()}`))));
  });
}
