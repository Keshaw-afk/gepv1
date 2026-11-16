// Timeline: an ordered list of timestamped commands plus the script clock.
// All times are integer milliseconds so traces and frame counts stay exact.
//
// Command shapes:
//   { op: 'create', id, kind: 'node', props: { label, pos: {x, y}, color }, t, dur: 0 }
//   { op: 'create', id, kind: 'edge', props: { a, b, color }, t, dur: 0 }
//   { op: 'set', id, prop: 'color' | 'pos', value, t, dur }
// Commands made by Lua also carry src: { file, line } (or null).

export const toMs = (seconds) => Math.round(seconds * 1000);

export class Timeline {
  constructor() {
    this.commands = [];
    this.clockMs = 0;
  }

  /** Append a command starting at the current script clock. Does not advance the clock. */
  add(cmd) {
    const c = { ...cmd, t: this.clockMs, dur: cmd.dur ?? 0 };
    this.commands.push(c);
    return c;
  }

  wait(ms) {
    if (!(ms >= 0)) throw new Error('wait time must be >= 0');
    this.clockMs += ms;
  }

  /** Length of the animation: until the last command finishes or the clock, whichever is later. */
  get durationMs() {
    let end = this.clockMs;
    for (const c of this.commands) end = Math.max(end, c.t + c.dur);
    return end;
  }
}
