// Output settings: everything about the exported picture that isn't part of the program.
// The scene is always drawn in 640×360 units (viewBox); size only scales width/height.

import { parseColor, toHex } from './colors.js';

export const SCALES = [1, 2, 3];
export const FONTS = ['sans-serif', 'serif', 'monospace'];
export const DEFAULT_OUTPUT = Object.freeze({ scale: 1, background: '#ffffff', font: 'sans-serif', fps: 25 });

/** Fills in defaults and validates settings from the page, the server or the CLI. Throws on bad values. */
export function outputSettings(o = {}) {
  const v = { ...DEFAULT_OUTPUT };
  for (const [k, x] of Object.entries(o ?? {})) if (k in v && x !== undefined && x !== null && x !== '') v[k] = x;
  const scale = Number(v.scale), fps = Number(v.fps);
  if (!SCALES.includes(scale)) throw new Error(`size must be ${SCALES.join(', ')} (× 640×360)`);
  if (!(Number.isInteger(fps) && fps >= 1 && fps <= 60)) throw new Error('frame rate must be a whole number from 1 to 60');
  if (!FONTS.includes(v.font)) throw new Error(`font must be one of ${FONTS.join(', ')}`);
  let background = 'transparent';
  if (v.background !== 'transparent') {
    const rgb = parseColor(String(v.background));
    if (!rgb) throw new Error(`unknown background colour '${v.background}'`);
    background = toHex(rgb);
  }
  return { scale, fps, font: v.font, background };
}

/** H.264 has no alpha channel, so a transparent background becomes white in the video. */
export const forVideo = (o) => (o.background === 'transparent' ? { ...o, background: '#ffffff' } : o);
