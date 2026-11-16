// Pixel check: does the current renderer draw the same pictures as the renderer at a git ref?
//
//   node tools/pixel_compare.mjs [ref=v1.0.0] [--every N=7]
//
// Renders every Nth frame of the examples that both versions can run, with the old renderer (taken
// from `git archive <ref> core`) and the current one in both flavours (export and inline), rasterises
// each SVG with ffmpeg's librsvg decoder (the same one the MP4 uses) and compares the pixels.
// Prints, per differing frame, how many channel values differ and by how much at most.
// Expected today vs v1.0.0: 4 of 89 frames differ by at most 2 (anti-aliasing: translate() vs cx/cy).
// Use it after any change to core/svg.js or core/shapes.js.

import fengari from 'fengari';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { runProgram } from '../core/lua_api.js';
import { sceneAt, frameTimes } from '../core/player.js';
import { renderSVG, timelineIds } from '../core/svg.js';

const args = process.argv.slice(2);
const every = Number(args[args.indexOf('--every') + 1]) || 7;
const ref = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--every') ?? 'v1.0.0';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gepv1-pixels-'));

try {
  execSync(`git -C "${root}" archive ${ref} core | tar -x -C "${tmp}"`);
  const old = await import(pathToFileURL(path.join(tmp, 'core/svg.js')).href);
  const raster = (svg) => {
    fs.writeFileSync(path.join(tmp, 'p.svg'), svg);
    const r = spawnSync('ffmpeg', ['-v', 'error', '-i', path.join(tmp, 'p.svg'), '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 26 });
    if (r.status) throw new Error(r.stderr.toString());
    return r.stdout;
  };
  const compare = (a, b) => {
    let count = 0, max = 0;
    for (let k = 0; k < a.length; k++) { const d = Math.abs(a[k] - b[k]); if (d) { count++; max = Math.max(max, d); } }
    return { count, max };
  };
  const ex = (f) => fs.readFileSync(path.join(root, 'examples', f), 'utf8');
  const stage = ex('stage.lua');
  let total = 0, differ = 0;
  // examples that only use the v1.0.0 API (circles, lines, colour, linear moves)
  for (const [name, st] of [['dfs', stage], ['bfs', stage], ['packets', stage], ['sort', '']]) {
    const { timeline } = runProgram(fengari, { stage: st, script: ex(`${name}.lua`) });
    const times = frameTimes(timeline.durationMs, 25);
    for (let i = 0; i < times.length; i += every) {
      const state = sceneAt(timeline, times[i]);
      const o = raster(old.renderSVG(state, { export: true }));
      const e = raster(renderSVG(state, { export: true, ids: timelineIds(timeline) }));
      const inl = raster(renderSVG(state));
      total++;
      const a = compare(o, e), b = compare(e, inl);
      if (a.count || b.count) {
        differ++;
        console.log(`${name} frame ${i}: ${ref} vs export ${a.count} values (max ${a.max}); export vs inline ${b.count} values (max ${b.max})`);
      }
    }
  }
  console.log(`${total} frames compared, ${differ} differ`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
