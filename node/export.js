// Frames -> video, using ffmpeg (its built-in librsvg decoder reads the SVG frames directly).

import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { sceneAt, frameTimes } from '../core/player.js';
import { renderSVG } from '../core/svg.js';

export function hasFfmpeg() {
  return spawnSync('ffmpeg', ['-hide_banner', '-decoders'], { encoding: 'utf8' }).stdout?.includes('librsvg') ?? false;
}

/** Writes frame_00000.svg, frame_00001.svg, ... into dir. Returns the frame count. */
export async function writeFrames(timeline, dir, fps) {
  await fs.mkdir(dir, { recursive: true });
  const times = frameTimes(timeline.durationMs, fps);
  for (const [i, t] of times.entries()) {
    const file = path.join(dir, `frame_${String(i).padStart(5, '0')}.svg`);
    await fs.writeFile(file, renderSVG(sceneAt(timeline, t)));
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
