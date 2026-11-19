// Plugins: tools that do the thinking for common academic diagrams, built only from the core tools.
// Importing this module registers them (once) next to the core tools.
import { registerTools, TOOLS } from '../ai_tools.js';
import row from './row.js';
import tree from './tree.js';
import graph from './graph.js';
import swap from './swap.js';
import throwTool from './throw.js';

export const PLUGINS = [row, tree, graph, swap, throwTool];
if (!TOOLS.some((t) => t.name === row.name)) registerTools(PLUGINS);
export { TOOLS };
