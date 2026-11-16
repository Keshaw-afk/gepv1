import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from './helpers.js';
import { writeFrames, encodeVideo, hasFfmpeg } from '../node/export.js';
import { outputSettings } from '../core/output.js';

test('frames are encoded into an MP4 with the expected frame count and size', { skip: !hasFfmpeg() && 'ffmpeg with librsvg not available' }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'gepv1-test-'));
  try {
    const { timeline } = run('A = node("A", 100, 100)', 'color(A, "red", 0.2)'); // 0.2 s -> 6 frames at 25 fps
    assert.equal(await writeFrames(timeline, dir, outputSettings({ scale: 2 })), 6);
    const out = path.join(dir, 'out.mp4');
    await encodeVideo(dir, out, 25);
    const probe = spawnSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'csv=p=0', out], { encoding: 'utf8' });
    assert.equal(probe.stdout.trim(), '1280,720,6');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
