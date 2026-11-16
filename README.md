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
3. **Result:** works in **frames**, the same frames as the MP4. Step with ‹ › or ←/→ (Shift: 10),
   type a frame number, or jump between **Moments**: the frames where a change has just finished,
   with the step or Lua line that made it (`[` `]`). Download an **MP4 video**, an **animated SVG**
   (one file that plays in any browser) or **this frame** as `frame_00043.svg`. **Output** sets the
   size, frame rate, font and background (transparent for SVG). The SVG code of the current frame
   and the pipeline trace are in collapsible sections with Copy, Save and Wrap.

Exported SVG is meant to be reused: every object has an id (`A`, `A-B`) and a class (`node`,
`edge`), and shared styling is one `<style>` block.

## CLI

```sh
npm run demo
# = node node/cli.js examples/stage.lua examples/dfs.lua --trace --video out/dfs.mp4
```

Options: `--trace`, `--frame N OUT.svg` (one frame), `--frames DIR` (every frame), `--video OUT.mp4`,
`--svg OUT.svg` (animated SVG), `--fps N` (default 25), `--scale 1|2|3`, `--background C|transparent`,
`--font sans-serif|serif|monospace`.

## Tests

```sh
npm test
```

## Walkthrough

[presentation/GEPV1_walkthrough.pdf](presentation/GEPV1_walkthrough.pdf): one DFS example built in the GUI,
from stage to MP4 (also as `.pptx`).

## Licence

[Apache-2.0](LICENSE)
