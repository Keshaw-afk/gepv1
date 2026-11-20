// The loop that lets a (very small) model carry out a user's message with the tools: the message is
// split into single instructions (core/instructions.js) and the model gets them one at a time, each
// with a one-line picture of what exists now. That keeps every request tiny: one sentence in, one or
// two tool calls out. A failed call goes back to the model with the error, for one or two retries.
// Used by the in-app assistant (web/assistant.js) and tools/ai_eval.mjs.

import { TOOLS } from './plugins/index.js';
import { schemaOf, RECIPE } from './ai_tools.js';
import { splitInstructions, fromWords, placesIn, obviousCall, toolFromWords } from './instructions.js';

export const SYSTEM = `${RECIPE}
Always use the tools; never answer with code or explanations.`;

export const TOOL_SCHEMAS = () => TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schemaOf(t) } }));

/**
 * Carries out `message`. Callbacks:
 *   ask(messages) -> assistant message ({content, tool_calls})   one chat request
 *   run(name, args) -> { text } | { error }                       runs a tool on the project
 *   brief() -> string                                             what exists now (briefState)
 *   names() -> [string]                                           names of the objects now
 *   on(event)                                                     progress: {type: 'step'|'call'|'say', …}
 *   stopped() -> boolean
 * Returns { calls, failed } (failed: instructions that did not get a working call).
 */
export async function carryOut(message, { ask, run, brief, names = () => [], on = () => {}, stopped = () => false, retries = 2 }) {
  const steps = splitInstructions(message);
  const one = steps.length <= 1;
  const calls = [], failed = [];
  for (const [i, step] of steps.entries()) {
    if (stopped()) break;
    on({ type: 'step', step, index: i, count: steps.length });
    const messages = [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `${brief()}\n${one ? '' : `This is instruction ${i + 1} of ${steps.length}; do only this one.\n`}Instruction: ${step}` },
    ];
    let done = false, nudged = false;
    for (let round = 0; round <= retries + 1 && !done && !stopped(); round++) {
      const msg = await ask(messages);
      messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length && { tool_calls: msg.tool_calls }) });
      if (!msg.tool_calls?.length) {
        const words = String(msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        if (nudged) { if (words) on({ type: 'say', text: words }); break; }
        nudged = true;
        messages.push({ role: 'user', content: `Do it now with a tool call. Instruction: ${step}` });
        continue;
      }
      let ok = true;
      for (const call of msg.tool_calls) {
        let args = call.function.arguments;
        try { args = typeof args === 'string' ? JSON.parse(args || '{}') : args ?? {}; } catch { /* the tool reports it */ }
        // the words name the tool plainly ("make queue yellow") and the model picked another: the words win
        let tool = call.function.name;
        const said = toolFromWords(step);
        if (said && said !== tool && ['move', 'color', 'resize', 'remove', 'draw', 'connect'].includes(tool)) {
          args = said === 'connect' ? { from: args?.from ?? args?.label, to: args?.to } : { label: tool === 'draw' ? undefined : args?.label };
          tool = said;
        }
        if (args && typeof args === 'object') args = fromWords(step, tool, args, names());
        // the same call twice for one instruction (after the fixes above): once is what was asked
        const key = `${tool} ${JSON.stringify(args && typeof args === 'object' ? Object.fromEntries(Object.entries(args).sort()) : args)}`;
        if (calls.some((k) => k.step === step && !k.error && k.key === key)) {
          messages.push({ role: 'tool', tool_call_id: call.id, content: 'Already done.' });
          continue;
        }
        const r = run(tool, args);
        calls.push({ step, key, name: tool, args, ...r });
        on({ type: 'call', step, name: tool, args, ...r });
        if (r.error) ok = false;
        messages.push({ role: 'tool', tool_call_id: call.id, content: r.error ? `Error: ${r.error} Try again.` : r.text });
      }
      // a working call: on to the next instruction (no chance to add what wasn't asked), unless it
      // names more places than were drawn ("three circles at (…), (…) and (…)")
      const drawn = calls.filter((k) => k.step === step && !k.error && ['draw', 'write', 'add'].includes(k.name)).length;
      const places = placesIn(step);
      if (ok && drawn && drawn < places && round <= retries) {
        messages.push({ role: 'user', content: `${places - drawn} more to draw: the instruction names ${places} places and ${drawn} ${drawn > 1 ? 'are' : 'is'} drawn. Draw the rest now.` });
        continue;
      }
      done = ok;
    }
    if (!done && !stopped() && !calls.some((k) => k.step === step && !k.error)) {
      // the model would not do it: a simple instruction ("hide it", "wait 2 seconds") has an obvious call
      const guess = obviousCall(step, names());
      if (guess) {
        const r = run(guess.name, guess.args);
        calls.push({ step, name: guess.name, args: guess.args, guessed: true, ...r });
        on({ type: 'call', step, name: guess.name, args: guess.args, guessed: true, ...r });
        done = !r.error;
      }
    }
    if (!done) failed.push(step);
  }
  return { calls, failed };
}
