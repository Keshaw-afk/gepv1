import fs from 'node:fs';
import fengari from 'fengari';
import { runProgram } from '../core/lua_api.js';

export const run = (stage, script = '') => runProgram(fengari, { stage, script });
export const example = (name) => fs.readFileSync(new URL(`../examples/${name}`, import.meta.url), 'utf8');
