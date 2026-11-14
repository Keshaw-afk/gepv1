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

The page opens with the DFS example loaded:
1. **Stage:** edit the graph (click to add, drag to move, Shift-drag or right-drag to connect).
2. **Behaviour:** edit `script.lua`.
3. **Run:** watch the preview and read the trace, then **Export video (MP4)**.

## CLI

```sh
npm run demo
# = node node/cli.js examples/stage.lua examples/dfs.lua --trace --video out/dfs.mp4
```

Options: `--trace`, `--frames DIR`, `--video OUT.mp4`, `--fps N` (default 25).

## Tests

```sh
npm test
```
