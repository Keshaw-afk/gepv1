// The in-app assistant: you describe an animation, an AI builds it with the same tools as the MCP
// server (core/ai_tools.js + plugins), run on the live project. It talks to any OpenAI-compatible
// chat API (OpenAI, OpenRouter, Ollama, LM Studio) through the local server (/api/llm), with the
// user's own key, which is kept in this browser's localStorage only.

import { TOOLS } from '../core/plugins/index.js';
import { schemaOf, RECIPE } from '../core/ai_tools.js';

const SETTINGS_KEY = 'gepv1.assistant';
const MAX_ROUNDS = 40; // tool rounds per request: plenty for a short animation, stops a loop
const SYSTEM = `${RECIPE}
Always use the tools to build the animation; do not answer with code. When you are done, say in one or two sentences what the animation shows.`;

const $ = (id) => document.getElementById(id);

/** runTool(name, args) -> { text } | { error } runs a tool on the app's project. */
export function setupAssistant({ runTool }) {
  const fields = { baseUrl: $('ai-base'), model: $('ai-model'), apiKey: $('ai-key') };
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}'); } catch { /* private window */ }
  for (const [k, input] of Object.entries(fields)) {
    input.value = saved[k] ?? '';
    input.addEventListener('change', () => {
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings())); } catch { /* no storage */ }
    });
  }
  const settings = () => ({
    baseUrl: fields.baseUrl.value.trim() || 'https://api.openai.com/v1',
    model: fields.model.value.trim() || 'gpt-4o-mini',
    apiKey: fields.apiKey.value.trim(),
  });
  if (!saved.baseUrl && !saved.apiKey) $('ai-settings').open = true; // first time: show where the key goes

  const tools = TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: schemaOf(t) } }));
  let messages = [{ role: 'system', content: SYSTEM }];
  let busy = false, stopped = false;

  const say = (cls, text) => {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    $('chat').append(li);
    $('chat').scrollTop = $('chat').scrollHeight;
    return li;
  };

  async function ask(body) {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: settings().baseUrl, apiKey: settings().apiKey, body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.error) throw new Error(data.error?.message ?? data.error ?? `HTTP ${res.status}`);
    return data.choices?.[0]?.message ?? { role: 'assistant', content: '' };
  }

  async function send(text) {
    busy = true;
    stopped = false;
    $('send').disabled = true;
    $('stop').hidden = false;
    say('you', text);
    messages.push({ role: 'user', content: text });
    const thinking = say('thinking', 'Thinking…');
    let usedTools = false, nudged = false;
    try {
      for (let round = 0; round < MAX_ROUNDS && !stopped; round++) {
        // a small local model (Ollama, LM Studio) is much faster and more reliable with tools when it
        // doesn't reason first; hosted APIs reject this setting on models that don't reason
        const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(settings().baseUrl + '/');
        const msg = await ask({ model: settings().model, messages, tools, tool_choice: 'auto', ...(local && { reasoning_effort: 'none' }) });
        // keep only what the API needs back (some providers add extra fields)
        messages.push({ role: 'assistant', content: msg.content ?? '', ...(msg.tool_calls?.length && { tool_calls: msg.tool_calls }) });
        if (!msg.tool_calls?.length) {
          const words = String(msg.content ?? '').replace(/<think>[\s\S]*?<\/think>/g, '').trim(); // reasoning models
          // a small model sometimes describes a plan instead of doing it: nudge it once
          if (!usedTools && !nudged) {
            nudged = true;
            messages.push({ role: 'user', content: 'Now build it: call the tools (start with start_over), do not describe it.' });
            continue;
          }
          if (words) say('ai', words);
          break;
        }
        usedTools = true;
        for (const call of msg.tool_calls) {
          let args = call.function.arguments;
          try { args = typeof args === 'string' ? JSON.parse(args || '{}') : args ?? {}; } catch { /* the tool reports bad JSON */ }
          const r = runTool(call.function.name, args);
          const line = say(r.error ? 'tool failed' : 'tool', `${r.error ? '✗' : '✓'} ${call.function.name}${args?.label ? ` ${args.label}` : ''}: ${r.error ?? r.text.split('. ')[0]}`);
          line.title = r.error ?? r.text;
          messages.push({ role: 'tool', tool_call_id: call.id, content: r.error ? `Error: ${r.error}` : r.text });
        }
        if (round === MAX_ROUNDS - 1) say('ai', `Stopped after ${MAX_ROUNDS} rounds of tool calls.`);
      }
      if (stopped) say('ai', 'Stopped.');
    } catch (e) {
      say('error', e.message);
    } finally {
      thinking.remove();
      busy = false;
      $('send').disabled = false;
      $('stop').hidden = true;
    }
  }

  $('ask').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('prompt').value.trim();
    if (!text || busy) return;
    $('prompt').value = '';
    send(text);
  });
  $('prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('ask').requestSubmit(); }
  });
  $('stop').addEventListener('click', () => { stopped = true; });
  $('new-chat').addEventListener('click', () => {
    if (busy) return;
    messages = [{ role: 'system', content: SYSTEM }];
    $('chat').replaceChildren();
  });
}
