// Frames and landmarks. A frame is one picture of the video: frame i is at times[i] (see
// frameTimes in player.js). The page, the CLI and the MP4 all use the same numbering, so frame 43
// in the page is frame_00043.svg from `--frames` and the 44th picture of the video.

import { sceneAt } from './player.js';
import { renderSVG, timelineIds } from './svg.js';

/** The frame on screen at time t: the last frame that starts at or before t. */
export function frameAt(times, tMs) {
  let lo = 0, hi = times.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (times[mid] <= tMs) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/** The first frame at or after time t (clamped to the last frame). */
export function frameFrom(times, tMs) {
  const i = frameAt(times, tMs);
  return times[i] >= tMs || i === times.length - 1 ? i : i + 1;
}

/**
 * Landmarks: the frames where something has just finished changing ("after D turns black").
 * Each command lands on the first frame at or after its end; commands landing on the same frame
 * share a landmark. Objects in the starting picture (created at t = 0) aren't landmarks.
 * Returns [{ frame, t, cmds }] in frame order.
 */
export function landmarks(timeline, times) {
  const byFrame = new Map();
  for (const c of timeline.commands) {
    if (c.op === 'create' && c.t === 0) continue;
    const frame = frameFrom(times, c.t + c.dur);
    if (!byFrame.has(frame)) byFrame.set(frame, []);
    byFrame.get(frame).push(c);
  }
  return [...byFrame.entries()].sort((a, b) => a[0] - b[0]).map(([frame, cmds]) => ({ frame, t: times[frame], cmds }));
}

export const frameName = (i) => `frame_${String(i).padStart(5, '0')}.svg`;

/** Frame i as an exported SVG, with a comment saying which frame it is. */
export function renderFrame(timeline, times, i, output) {
  const comment = `GEPV1 frame ${i} / ${times.length - 1}, t = ${(times[i] / 1000).toFixed(2)} s`;
  return renderSVG(sceneAt(timeline, times[i]), { export: true, output, comment, ids: timelineIds(timeline) });
}
