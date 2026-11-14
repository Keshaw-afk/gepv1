# GEPV1

Draw a stage with drag and drop, drive it with a Lua script, get an animation and an MP4.
See [ARCHITECTURE.md](ARCHITECTURE.md) for how it works.

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
1. **Stage:** draw the starting picture (click to add, drag to move, Shift-drag or right-drag to connect).
2. **Behaviour:** either
   - **Steps** (no code): click a node or line, then pick a colour; drag a node to record a move;
     add pauses. Each step plays after the previous one, or "with previous". The generated
     `steps.lua` is shown underneath.
   - **Code** for loops and algorithms (starts empty; DFS, BFS and others are under **Load example…**).
   Run plays stage → steps → code.
3. **Result:** preview, scrub, and download an **MP4 video**, an **animated SVG** (one file that plays
   in any browser), or **this frame** as a still SVG. The SVG code of the current frame and the
   pipeline trace are in the collapsible sections.

## CLI

```sh
npm run demo
# = node node/cli.js examples/stage.lua examples/dfs.lua --trace --video out/dfs.mp4
```

Options: `--trace`, `--frames DIR` (one SVG per frame), `--video OUT.mp4`, `--svg OUT.svg`
(animated SVG), `--fps N` (default 25).

## Tests

```sh
npm test
```
