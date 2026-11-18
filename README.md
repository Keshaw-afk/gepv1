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

The page has three tabs: **Stage → Behaviour → Result**.
1. **Stage:** draw the starting picture with the tool row: circles, rectangles, triangles, text,
   lines and arrows (pick a shape and click to add, drag to move, line or arrow tool to connect).
   **Draw a loop on empty space** to lasso several objects (a quick straight drag selects the box
   between its ends; Ctrl/Cmd-click adds one; Ctrl+A selects all), then move, colour, delete, duplicate
   or line them up together (lining up never piles objects on top of each other). A selected object has
   handles: right edge = width, bottom edge = height, corner = both (Shift keeps the proportions); or
   type **W** and **H**. The label never stretches. Colours picked on the Stage are the starting colours. Undo/redo (Ctrl+Z / Ctrl+Shift+Z), copy and paste, arrow keys
   to nudge, and an optional snap-to-grid (G) are there too. Your work is autosaved in the browser;
   **New project** starts again.
2. **Behaviour:** either
   - **Steps** (no code): click an object, then pick a colour; drag it to record a move; add
     objects that appear partway, connect them, remove things, **resize** them, align or spread a
     selection; add pauses. A step on a selection of several objects plays all at once. Each step plays after the previous one, or "with previous". The
     generated `steps.lua` is shown underneath.
   - **Code** for loops and algorithms (starts empty; DFS, BFS and others are under **Load example…**).
   Run plays stage → steps → code.
3. **Result:** works in **frames**, the same frames as the MP4. Step with ‹ › or ←/→ (Shift: 10),
   type a frame number, or jump between **Moments**: the frames where a change has just finished,
   with the step or Lua line that made it (`[` `]`). Download an **MP4 video**, or open the **animated SVG**
   (plays by itself) or **this frame** in a new tab, to look at or save from there (Ctrl+S). **Output** sets the
   size, frame rate, font and background (transparent for SVG). The SVG code of the current frame
   and the pipeline trace are in collapsible sections with Copy, Save and Wrap.

Exported SVG is meant to be reused: every object has an id (`A`, `A-B`) and a class (`node rect`,
`edge arrow`, …), each shape is placed with one `translate()`, and shared styling is one `<style>`
block.

In code, `move(id, x, y, dur, "smooth")` eases in and out, `pos(id)` says where a node is now,
`remove(id)` makes it disappear and `size(id, w, h, dur)` makes a node wider and/or taller about its
centre (factors 0.25 to 5; `size(id, 2)` = both ×2; `rect("A", x, y, 3, 1)` starts stretched). Sizes show in frames, the animated SVG and the MP4.

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
