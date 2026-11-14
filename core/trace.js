// Trace: a readable report of what every pipeline stage produced.

import { sceneAt, frameTimes } from './player.js';

const sec = (ms) => (ms / 1000).toFixed(2);

function describe(cmd, scene) {
  const name = scene.nameOf(cmd.id);
  if (cmd.op === 'create' && cmd.kind === 'node') {
    return `create node ${name} (${Math.round(cmd.props.pos.x)},${Math.round(cmd.props.pos.y)})`;
  }
  if (cmd.op === 'create') return `create edge ${name}`;
  const v = cmd.prop === 'pos' ? `(${Math.round(cmd.value.x)},${Math.round(cmd.value.y)})` : cmd.value;
  return `set ${name}.${cmd.prop} -> ${v}  dur=${sec(cmd.dur)}`;
}

/** Returns the trace as an array of lines. */
export function formatTrace({ scene, timeline, log, stageCommands }, { fps = 25 } = {}) {
  const cmds = timeline.commands;
  const stageCmds = cmds.slice(0, stageCommands);
  const lines = [];
  const count = (list, kind) => list.filter((c) => c.op === 'create' && c.kind === kind).length;

  lines.push(`[stage]     ${count(stageCmds, 'node')} nodes, ${count(stageCmds, 'edge')} edges (from stage.lua)`);
  lines.push(`[commands]`);
  for (const c of cmds) lines.push(`  t=${sec(c.t)}  ${describe(c, scene)}`);
  for (const l of log) lines.push(`[print]     ${l}`);

  const creates = cmds.filter((c) => c.op === 'create').length;
  lines.push(`[timeline]  ${cmds.length} commands (${creates} create, ${cmds.length - creates} set), total ${sec(timeline.durationMs)} s`);

  // Show the player interpolating: sample the first animated change halfway through.
  const tween = cmds.find((c) => c.op === 'set' && c.dur > 0);
  if (tween) {
    const mid = tween.t + tween.dur / 2;
    const st = sceneAt(timeline, mid);
    const obj = [...st.nodes, ...st.edges].find((o) => o.id === tween.id);
    const pos = (p) => `(${Math.round(p.x)},${Math.round(p.y)})`;
    const val = tween.prop === 'pos' ? pos(obj) : obj.color;
    const target = tween.prop === 'pos' ? pos(tween.value) : tween.value;
    lines.push(`[player]    t=${sec(mid)}  ${scene.nameOf(tween.id)}.${tween.prop} = ${val}  (halfway to ${target})`);
  }

  const n = frameTimes(timeline.durationMs, fps).length;
  lines.push(`[svg]       ${n} frames at ${fps} fps`);
  return lines;
}
