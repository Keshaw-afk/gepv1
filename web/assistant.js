// The in-app assistant: you describe an animation step by step and a (small, cheap) AI carries it out
// with the same tools as the MCP server, on the live project. The message is split into single
// instructions and the model gets one at a time (core/ai_loop.js). It talks to any OpenAI-compatible
// chat API (OpenAI, OpenRouter, Ollama, LM Studio) through the local server (/api/llm), with the
// user's own key, which is kept in this browser's localStorage only.

import { carryOut, TOOL_SCHEMAS } from '../core/ai_loop.js';

const SETTINGS_KEY = 'gepv1.assistant';
const $ = (id) => document.getElementById(id);

/**
 * runTool(name, args) -> { text } | { error } runs a tool on the app's project; brief() says what
 * exists now; names() lists the objects' names.
 */
export function setupAssistant({ runTool, brief, names }) {
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

  const tools = TOOL_SCHEMAS();
  let busy = false, stopped = false;

  const say = (cls, text) => {
    const li = document.createElement('li');
    li.className = cls;
    li.textContent = text;
    $('chat').append(li);
    $('chat').scrollTop = $('chat').scrollHeight;
    return li;
  };

  async function ask(messages) {
    // a small local model (Ollama, LM Studio) is much faster and more reliable with tools when it
    // doesn't reason first; hosted APIs reject this setting on models that don't reason
    const local = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(settings().baseUrl + '/');
    const body = { model: settings().model, messages, tools, tool_choice: 'auto', temperature: 0, ...(local && { reasoning_effort: 'none' }) };
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
    const thinking = say('thinking', 'Working…');
    try {
      const { failed } = await carryOut(text, {
        ask,
        run: runTool,
        brief,
        names,
        stopped: () => stopped,
        on(e) {
          if (e.type === 'step') thinking.textContent = e.count > 1 ? `Step ${e.index + 1} of ${e.count}: ${e.step}` : 'Working…';
          if (e.type === 'call') {
            const line = say(e.error ? 'tool failed' : 'tool', `${e.error ? '✗' : '✓'} ${e.error ? `${e.name}: ${e.error}` : e.text.split('. ')[0]}`);
            line.title = `${e.step}\n${e.name} ${JSON.stringify(e.args)}`;
            thinking.after(line); // keep "Working…" last
            $('chat').append(thinking);
          }
          if (e.type === 'say') say('ai', e.text);
        },
      });
      if (stopped) say('ai', 'Stopped.');
      else if (failed.length) say('error', `Not done: ${failed.map((f) => `“${f}”`).join(', ')}. Try saying it more simply, or do it by hand.`);
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
    $('chat').replaceChildren();
  });
}
