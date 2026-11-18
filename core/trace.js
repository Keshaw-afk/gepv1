// Trace: a readable report of what every pipeline stage produced.

import { sceneAt, frameTimes } from './player.js';
import { sizeOf } from './shapes.js';

const sec = (ms) => (ms / 1000).toFixed(2);
const sizeText = (s) => { const z = sizeOf(s); const f = (v) => Number(v.toFixed(2)); return z.w === z.h ? `×${f(z.w)}` : `${f(z.w)}×${f(z.h)}`; };

// Names come from the command (the name when it ran), so removed objects still read well.
function describe(cmd) {
  const name = cmd.name ?? `#${cmd.id}`;
  if (cmd.op === 'create' && cmd.kind === 'node') {
    const what = cmd.props.shape && cmd.props.shape !== 'circle' ? cmd.props.shape : 'node';
    return `create ${what} ${name} (${Math.round(cmd.props.pos.x)},${Math.round(cmd.props.pos.y)})`;
  }
  if (cmd.op === 'create') return `create ${cmd.props.directed ? 'arrow' : 'edge'} ${name}`;
  if (cmd.op === 'remove') return `remove ${name}`;
  const v = cmd.prop === 'pos' ? `(${Math.round(cmd.value.x)},${Math.round(cmd.value.y)})` : cmd.prop === 'size' ? sizeText(cmd.value) : cmd.value;
  const how = cmd.ease ? ` ${cmd.ease}` : '';
  return `set ${name}.${cmd.prop} -> ${v}  dur=${sec(cmd.dur)}${how}`;
}

/** Returns the trace as an array of lines. */
export function formatTrace({ timeline, log, stageCommands }, { fps = 25 } = {}) {
  const cmds = timeline.commands;
  const stageCmds = cmds.slice(0, stageCommands);
  const lines = [];
  const count = (list, kind) => list.filter((c) => c.op === 'create' && c.kind === kind).length;

  lines.push(`[stage]     ${count(stageCmds, 'node')} nodes, ${count(stageCmds, 'edge')} edges (from stage.lua)`);
  lines.push(`[commands]`);
  const what = cmds.map((c) => describe(c));
  const width = Math.max(0, ...what.map((w) => w.length));
  cmds.forEach((c, i) => {
    const src = c.src ? `  ${c.src.file}:${c.src.line}` : '';
    lines.push(`  t=${sec(c.t)}  ${src ? what[i].padEnd(width) : what[i]}${src}`.trimEnd());
  });
  for (const l of log) lines.push(`[print]     ${l}`);

  const countOp = (op) => cmds.filter((c) => c.op === op).length;
  const removes = countOp('remove');
  lines.push(`[timeline]  ${cmds.length} commands (${countOp('create')} create, ${countOp('set')} set${removes ? `, ${removes} remove` : ''}), total ${sec(timeline.durationMs)} s`);

  // Show the player interpolating: sample the first animated change halfway through.
  const tween = cmds.find((c) => c.op === 'set' && c.dur > 0);
  if (tween) {
    const mid = tween.t + tween.dur / 2;
    const st = sceneAt(timeline, mid);
    const obj = [...st.nodes, ...st.edges].find((o) => o.id === tween.id);
    const pos = (p) => `(${Math.round(p.x)},${Math.round(p.y)})`;
    const show = (v) => (tween.prop === 'pos' ? pos(v) : tween.prop === 'size' ? sizeText(v) : v);
    const val = show(tween.prop === 'pos' ? obj : tween.prop === 'size' ? obj.size : obj.color);
    const target = show(tween.value);
    lines.push(`[player]    t=${sec(mid)}  ${tween.name}.${tween.prop} = ${val}  (halfway to ${target})`);
  }

  const n = frameTimes(timeline.durationMs, fps).length;
  lines.push(`[svg]       ${n} frames at ${fps} fps`);
  return lines;
}
