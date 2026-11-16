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
2. **Behaviour:** either
   - **Steps** (no code): click an object, then pick a colour; drag it to record a move; add
     objects that appear partway, connect them, remove things, or **tidy the tree** so it glides
     into rows; push things and **let it move** under a rule; add pauses. Each step plays after the previous one, or "with previous". The
     generated `steps.lua` is shown underneath.
   - **Code** for loops and algorithms (starts empty; DFS, BFS and others are under **Load example…**).
   Run plays stage → steps → code.
3. **Result:** works in **frames**, the same frames as the MP4. Step with ‹ › or ←/→ (Shift: 10),
   type a frame number, or jump between **Moments**: the frames where a change has just finished,
   with the step or Lua line that made it (`[` `]`). Download an **MP4 video**, an **animated SVG**
   (one file that plays in any browser) or **this frame** as `frame_00043.svg`. **Output** sets the
   size, frame rate, font and background (transparent for SVG). The SVG code of the current frame
   and the pipeline trace are in collapsible sections with Copy, Save and Wrap.

Exported SVG is meant to be reused: every object has an id (`A`, `A-B`) and a class (`node rect`,
`edge arrow`, …), each shape is placed with one `translate()`, and shared styling is one `<style>`
block.

In code, `move(id, x, y, dur, "smooth")` eases in and out, `pos(id)` says where a node is now,
`remove(id)` makes it disappear and `tree_layout(root)` tidies a tree after it changes shape (see the
**Tree rotation** example).

**Motion by rules:** `push(id, vx, vy)` gives a node a speed and `simulate(seconds, rule)` lets time
run while a rule moves things: a Lua function of your own, or a ready-made one such as `"spread"`
(a graph untangles itself) or `"fall"`. In Steps: drag with the **Push** tool (it adds a 2 s **Let it move** after it, which you can change),
or pick a rule under **Let it move**. The motion
is worked out once and stored, so every frame and every export shows exactly the same thing (see
the **Untangle** and **Push, fall, your own rule** examples).

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
npm run check:layout      # how tidy examples/untangle.lua ends up
```

See [HANDOFF.md](HANDOFF.md) §4 for what each one should report.

## Walkthrough

[presentation/GEPV1_walkthrough.pdf](presentation/GEPV1_walkthrough.pdf): one DFS example built in the GUI,
from stage to MP4 (also as `.pptx`).

## Licence

[Apache-2.0](LICENSE)
