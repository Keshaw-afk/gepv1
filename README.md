# GEPV1

Draw a stage with drag and drop, drive it with a Lua script, get an animation and an MP4.
See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works and [HANDOFF.md](HANDOFF.md) for the current
state, design decisions and how to check changes.

## Requirements

- Node.js 20+
- ffmpeg with the librsvg decoder (check with `ffmpeg -decoders | grep librsvg`). It's only
  needed for video export.

## Run

```sh
npm install
npm start            # http://localhost:8080  (PORT=xxxx npm start to change)
```

The page has two tabs: **Build → Result**.
1. **Build** has one canvas, two modes and, in the panel, a list that starts with **Start** followed by
   your steps. Click a row to work at that point (like keyframes); the canvas shows the picture there.
   - **✎ Arrange:** place, drag, resize, colour and connect freely; **nothing is recorded**. At Start this
     is the starting picture. At a later step a change adjusts whatever already decides it there: the
     move or size step that put the object there (a curved move bends to its new end), the step that
     added it, or the starting picture. A new object (or line, or paste) appears at the moment you are
     looking at: at Start it is part of the starting picture, later it gets a keyframe of its own there.
     (In Record too: an object added while a keyframe moves things appears when that keyframe ends.)
   - **● Record:** changes are recorded in **keyframes**. Everything you change goes into the current
     keyframe and plays together: drag A, drag B, colour C, and all three happen at once. Press **+ New
     keyframe** (or N, from either mode) to add one at the end; it plays after everything else. Dragging the same object again
     in a keyframe carries its move on (one move through both places); a new colour or size replaces
     the old one. **Drag in a curve for a curved move** (smoothed, at even speed). Click a keyframe to
     record into it again; each keyframe has its duration, and pauses sit between keyframes. If a new
     step removes something later steps used, those steps go and a note says so.

   Everywhere: **draw a loop on empty space** to lasso several objects (a quick straight drag selects the
   box between its ends; Ctrl/Cmd-click adds one; Ctrl+A selects all), then move, colour, delete, duplicate
   or line them up together (lining up never piles objects on top of each other). A selected object has
   handles: right edge = width, bottom edge = height, corner = both (Shift keeps the proportions); or
   type **W** and **H**. The label never stretches. Undo/redo (Ctrl+Z / Ctrl+Shift+Z), copy and paste,
   arrow keys to nudge (at Start), and an optional snap-to-grid (G) are there too, and a **coordinates** guide (the ∟ button: x and y on the canvas, and where the pointer is, for instructions like "draw a circle at (100, 180)"). Your work is autosaved
   in the browser; **New project** starts again.
   - **Code** is a REPL: type Lua and press Enter, and it becomes the next keyframe, at the end
     (Shift+Enter for a new line, ↑ for what you typed before). Above the box, Start and every keyframe
     are shown as Lua, whether you made them by typing or on the canvas; click one to see it.
     Changes that all start together become ordinary keyframes you can also change on the canvas.
     Anything else (waits, loops, algorithms such as DFS from **Example…**) is one **code keyframe**,
     played as written. **Edit** on any keyframe or pause puts its Lua back in the box, and Enter
     replaces it there (objects it makes again keep their identity, so later keyframes that use them
     stay). **Delete** (or emptying the box while editing, then Enter) deletes the whole keyframe; so
     does the × beside a keyframe in Picture and steps. Ctrl+Z brings it back. Objects a code keyframe makes are changed
     only in code, and `local` variables don't carry over to the next entry (globals do).
   - Code from before the REPL still plays after all keyframes; **Make it the last keyframe** turns it
     into a code keyframe.
2. **Result:** works in **frames**, the same frames as the MP4. Step with ‹ › or ←/→ (Shift: 10),
   type a frame number, or jump between **Moments**: the frames where a change has just finished,
   with the step or Lua line that made it (`[` `]`). Download an **MP4 video**, or open the **animated SVG**
   (plays by itself) or **this frame** in a new tab, to look at or save from there (Ctrl+S). **Output** sets the
   size, frame rate, font and background (transparent for SVG). The SVG code of the current frame
   and the pipeline trace are in collapsible sections with Copy, Save and Wrap.

Exported SVG is meant to be reused: every object has an id (`A`, `A-B`) and a class (`node rect`,
`edge arrow`, …), each shape is placed with one `translate()`, and shared styling is one `<style>`
block.

The full Lua API, with examples, is in [docs/LUA_API.md](docs/LUA_API.md). In code, `move(id, x, y, dur, "smooth")` eases in and out, `pos(id)` says where a node is now,
`path(id, {{x, y}, …}, dur)` moves along a smooth curve through the points at even speed,
`remove(id)` makes it disappear and `size(id, w, h, dur)` makes a node wider and/or taller about its
centre (factors 0.25 to 5; `size(id, 2)` = both ×2; `rect("A", x, y, 3, 1)` starts stretched). Sizes show in frames, the animated SVG and the MP4.

For academic animations:

- **Tables:** `t = grid(rows, cols, x, y)` makes a table of cells (`t[r][c]`, from 1; `cell(label, x, y)`
  is one cell). Fill it with `label(t[r][c], "3")` and highlight with `color(t[r][c], "yellow")`.
- **Changing values:** `label(id, text)` changes any shape's label, or a text's words, at once: counters,
  variables, table entries.
- **Maths in labels:** text between `$` signs is maths, LaTeX-style: `[[$c_{i,j} = c_{i-1,j-1} + 1$]]`,
  `[[$x^2 \le n$]]`, `\times`, `\nwarrow`, Greek letters, and shortcuts like `<=` and `->`. Write it in
  `[[…]]` strings, since Lua reads `"\t…"` as a tab. Symbols, subscripts and superscripts only.
- **Example:** `examples/lcs.lua` fills the dynamic-programming table of the longest common
  subsequence and traces the answer back (Code → Example… → LCS table). As a video:
  `node node/cli.js /dev/null examples/lcs.lua --scale 2 --fps 30 --video out/lcs_dp_table.mp4`.

## Use it with an AI

GEPV1 is aimed at **academic animations** (diagrams of circles, boxes, triangles, text, lines and
arrows). You say what you want step by step, in plain words, and an AI (even a very small, cheap
one) carries it out with a small set of tools. What it makes is ordinary Start + keyframes, so you
can click any keyframe and edit it.

> Draw a circle A at (100, 180) and a box B at (400, 180). Move A to (300, 80) in 3 seconds and at
> the same time turn B red. Then wait 1 second. Make these green, then move them down by 50.

- **Tools**, one per everyday verb: `draw`, `write`, `move`, `color`, `resize`, `connect`, `remove`,
  `rename`, `wait`, `undo`, `clear`, `show`.
  - Each action happens after the previous one; "at the same time" plays it together with the
    previous one. Time goes on the action ("in 3 seconds"), up to 60 s.
  - Point at what to change: a label ("A"), several ("A, B and C"), "all circles", "the red ones",
    "everything", "it" / "them" (the last ones), or **"these"** for what you selected on the Stage.
  - "Move it right by 100", "in an arc", "twice as big", "increase its radius by 50", "100 pixels
    wider", "name the circle Bomb", "centre it", "turn it different colours 6 times" work as
    you'd expect. Nothing you didn't say is added: "draw a
    circle" is a plain grey circle in a free spot.
- **The assistant splits your message into single instructions** and gives the model one at a time.
  The words you typed win over the model's guesses (times, distances, "at the same time", colours,
  labels), so a 0.6B model gets most simple instructions right. `node tools/ai_eval.mjs` measures it.
- **Plugins** (`make_row`, `make_tree`, `make_graph`, `swap`, `throw`) do a whole diagram in one call.
- **Over MCP** (Claude Code, Claude Desktop, any MCP client):
  `claude mcp add gepv1 -- node /path/to/gepv1/node/mcp.js`. It starts the app server if needed and
  opens the app in your browser; you watch the AI build the animation there.
  - Claude Desktop JSON: `{"mcpServers": {"gepv1": {"command": "node", "args": ["/path/to/gepv1/node/mcp.js"]}}}`
- **In the app:** Build → **✦ Assistant**. Under *AI settings*, give any OpenAI-compatible API: OpenAI
  (base URL `https://api.openai.com/v1`, your key), OpenRouter, or a local Ollama / LM Studio
  (`http://localhost:11434/v1`, no key). The key stays in your browser; requests go through the local
  server to that provider only.

## CLI

```sh
npm run demo
# = node node/cli.js examples/stage.lua examples/dfs.lua --trace --video out/dfs.mp4
```

Options: `--trace`, `--frame N OUT.svg` (one frame), `--frames DIR` (every frame), `--video OUT.mp4`,
`--svg OUT.svg` (animated SVG), `--fps N` (default 25), `--scale 1|2|3`, `--background C|transparent`,
`--font sans-serif|serif|monospace`.

## Tests and checks

```sh
npm test                  # unit and integration tests
npm run check:pixels      # pictures vs v1.0.0, rendered by librsvg
npm run check:animated    # writes out/animated_check.html: animated SVG vs the player, in Chrome
```

See [HANDOFF.md](HANDOFF.md) §4 for what each one should report.

## Walkthrough

[presentation/GEPV1_walkthrough.pdf](presentation/GEPV1_walkthrough.pdf): one DFS example built in the GUI,
from stage to MP4 (also as `.pptx`).

## Licence

[Apache-2.0](LICENSE)
