// docs/LUA_API.md stays true: every API function has a section, and every Lua example runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fengari from 'fengari';
import { runProgram, API_NAMES } from '../core/lua_api.js';

const doc = readFileSync(new URL('../docs/LUA_API.md', import.meta.url), 'utf8');

test('the Lua API reference has a section for every API function', () => {
  for (const name of [...API_NAMES, 'print']) assert.match(doc, new RegExp(`^### ${name}$`, 'm'), `no section for ${name}`);
});

test('every Lua example in the reference runs', () => {
  const blocks = [...doc.matchAll(/```lua\n([\s\S]*?)```/g)].map((m) => m[1]);
  assert.ok(blocks.length >= 15);
  // The examples talk about A, B and C (as made in the Build tab): give them a stage with those.
  const stage = 'A = node("A", 100, 180)\nB = node("B", 300, 180)\nC = node("C", 500, 180)';
  for (const script of blocks) assert.doesNotThrow(() => runProgram(fengari, { stage, script }), script);
});
