# GEPV1

Draw a stage, define behaviour (GUI steps or Lua), get SVG frames, an animated SVG and an MP4.
JavaScript (ES modules) + Lua via Fengari; the same `core/` runs in the browser and in Node.

**Read first:** [HANDOFF.md](HANDOFF.md) (state, decisions, checks, known issues, how to work with
the user), then [ARCHITECTURE.md](ARCHITECTURE.md) and [TODO.md](TODO.md).

## Commands

```sh
npm install
npm start                 # http://localhost:8080 ; to show the user: xdg-open http://localhost:8080/
npm test                  # node:test, all must pass
npm run check:pixels      # renderer vs v1.0.0 in librsvg (needs ffmpeg with librsvg)
npm run check:animated    # writes out/animated_check.html; open in Chrome, read the title
npm run check:layout      # crossings etc. at the end of examples/untangle.lua
node node/cli.js stage.lua script.lua --trace --frame N out.svg --svg anim.svg --video out.mp4
```

## Rules of the house

- The GUI only generates plain Lua API calls (`stage.lua`, `steps.lua`); never a separate format.
- New API function → add it to `API_NAMES` in `core/lua_api.js`, the ARCHITECTURE API list and the
  API hint in `web/index.html`.
- Anything that moves must stay exact in every frame: record commands, bake simulations, and keep
  the player, still frames and the animated SVG in agreement (`npm run check:animated`).
- Keep README, ARCHITECTURE, TODO and HANDOFF current with every change.
- Commit per phase locally. **Ask before** pushing, tagging or bumping the version.
- UI: lively but uncluttered, one thing on screen at a time; British spelling, plain copy.
