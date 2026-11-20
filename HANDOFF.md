# Handoff notes

For whoever works on GEPV1 next (person or AI). Read this, then [ARCHITECTURE.md](ARCHITECTURE.md)
for how it works and [TODO.md](TODO.md) for what's left. The Lua API reference is
[docs/LUA_API.md](docs/LUA_API.md). Last updated 2026-11-20.

---


> **AI round (after v2.0.0, 2026-11-19).** The user narrowed GEPV1 to **academic animations built by an AI**.
> The AI calls keyframe tools (`core/ai_tools.js`, plugins in `core/plugins/`), over MCP (`node/mcp.js`) or
> through the in-app ✦ Assistant (`web/assistant.js`, any OpenAI-compatible API with the user's key). The tools
> run in the open app tab via the server's live link, so every keyframe is editable afterwards. **The tools must
> stay very easy for a simple AI** (labels not ids, optional positions, forgiving arguments, replies that say what
> to do next). See ARCHITECTURE §3b. The Fabric.js + Matter.js rebuild plan was dropped.
> **AI round 2 (2026-11-20).** The user's philosophy: **very small, cheap models**, and users who describe what
> they want **step by step in plain words**, pointing at an object or a set of objects ("make these red").
> So the tools became one per everyday verb (`draw`, `move`, `color`, …) with no keyframe bookkeeping
> (`next_keyframe` is gone: actions are sequential, `together` for "at the same time", `seconds` on the
> action), sets as targets (incl. the Stage selection), and the assistant gives the model **one instruction
> at a time** while the user's own words override its guesses (`core/instructions.js`, `core/ai_loop.js`).
> Measured with `node tools/ai_eval.mjs` on qwen3:0.6b, 26 prompts in four batches; each new batch was
> written before tuning on it. Each batch's first, untuned run: round-1-style tools 4/8 → one
> instruction at a time 5/8 → words win 8/8 (tuned); then 3/6 held out, 3/6 fresh, **4/6 new** (the
> latest honest figure). After fixing what those showed, all 26 pass (2026-11-20). The remaining risk
> is phrasing nobody has tried yet: grow the eval with the user's real instructions, new prompts first.
> Plugins were only ported (the user will talk about plugins later).
> **Round 3 (2026-11-20), from the user's own session:** "draw a circle." gave a *red* circle at an invented
> place, and "name the circle Bomb and increase its radius by 50" turned it red and did neither. Six new
> prompts (the PLAIN batch, `SUITE=plain node tools/ai_eval.mjs`) scored **1/6** before tuning, 6/6 after:
> nothing the user didn't say (colour, place, size, a shape word as label), split at "and <verb>"
> (name, call, label, increase, reduce…), rename and pixel sizes read from the words, made-up names
> resolved to what the user pointed at, and no `color` call without a colour word. A second message
> ("center the bomb … different colors in 0.6 seconds, 6 times") added "centre" and repeated colour
> changes; four prompts for those were written with the fix, so they are not an untuned measure.
> Full run after round 3: 36/36 (8 tuned, 6 held out, 6 fresh, 6 new, 10 plain words; the one miss,
> "flash red three times" read as a resize, was fixed and re-run). Next idea discussed with the user:
> a fine-tuned small model (generated, verified training data; held-out eval), see TODO.
> **v2.0.0 (the round after v1.1.0).** At the user's request:
> **removed** `tree_layout`, `push`, `simulate`, rules (spread/fall/drift/towards), the Push tool, Tidy tree,
> Let it move and the rotation/untangle/rules examples (`core/layout.js`, `core/motion.js`, their tests and
> tools are gone). **Added:** `size(id, s, dur?, ease?)` and `node(..., size)` (0.25 to 5; SVG `scale()`; animated
> SVG scales an inner group); lasso and multi-select, group move, resize handle and Size field (Stage and
> Steps), align/spread (`core/arrange.js`), duplicate, copy/paste, nudge, snap-to-grid, undo/redo and
> autosave (`web/history.js`, localStorage `gepv1.project`), New project. A step on several objects is
> several steps with `together`.
> **After v2.0.0:** Build has two modes. **Arrange** records nothing: at Start it edits the stage, at a later
> point it adjusts the step that decides the property there (`sourceOf`, `reshapePath` in core/steps.js) or the
> stage. **Record** makes steps; a bent drag becomes `path(id, {{x, y}, …}, dur)` (core/paths.js, even speed).
> `point` is now 0..n (0 = Start; no more null).
> Durations in the GUI are 0.1–10 s (`seconds()` in web/app.js; an empty field = 0.5 s). It used to read an
> empty field as 0, so curved moves were saved with 0 s and jumped; `visibleMoves` gives saved 0 s moves 0.5 s.
> **Restart `npm start` after changing core/**: the server keeps the core modules it loaded (MP4 export). Record works in **keyframes** (`recordSteps`, `keyframes`,
> `keepKeyframes` in core/steps.js): changes join the current keyframe until Next keyframe (N); the steps
> list shows Keyframe 1, 2… with their changes. The old per-step "with previous" select is gone.
> **Third pass:** Stage and Behaviour are one **Build** tab (tabs: Build → Result). The steps list starts
> with **Start**; clicking a row sets `point` (null = Start, k = after k steps) and the canvas shows that point;
> edits at a step are spliced in there (`addSteps`, `pasteSteps`), with a note when later steps get pruned.
> Undo/redo now also autosave (before, a reload could bring back an undone change).
> **Second pass (user feedback):** free-hand loop lasso (straight drag = box); align/spread moves apart
> objects that would overlap (`separate()` in arrange.js, 30 px); size is width × height `{w, h}` with
> width/height/corner handles and W/H fields, label scales by the smaller factor; colours on the Stage
> (`color(A, "red", 0)` in stage.lua becomes the starting colour, stage.lua only); Animated SVG and This frame
> open in a new tab (blob URL) instead of downloading. Copy/paste keeps colours. Test in Chrome on
> `127.0.0.1:8080`, not `localhost`: autosave lives in localStorage per origin, and localhost holds the
> user's own work. Sections 2 to 5 below
> still describe v1.1.0 where they mention the removed features: read those as history.
> Released as **v2.0.0** (major: the Lua API lost `tree_layout`, `push` and `simulate`).

## 1. Where things stand

- Current release: **v2.0.0** (2026-11-18, tagged and pushed to the private GitHub repo `gepv1`): the
  Build tab, lasso, width/height, stage colours, undo/autosave; rule motion and tree layout removed (see
  the note above). Previous: **v1.1.0** (2026-11-17), v1.0.0 plus shapes and motion. Chosen as a minor bump: every v1.0.0 Lua script still runs;
  the exported SVG *code* changed (`cx`/`cy` → `translate()`, arrows are `<polyline>` with a marker,
  see §3) but the pictures are the same, and nothing was parsing the SVG yet.

  | Commit | What |
  |--------|------|
  | `a008fc8` | Core: rect, triangle, text, arrow; `remove`; smooth moves; `pos`; `tree_layout`; transform-based SVG |
  | `c791157` | Animated SVG: arrows follow instant moves; exact keyTimes |
  | `2cc34b9` | GUI: tool row; Steps that add, connect, remove and tidy |
  | `8b26cd4` | Behaviour hint follows a renamed step object |
  | `21003ca` | Motion by rules: `push`, `simulate`, Push tool, Let it move |
  | `5fc1b24` | Rules can't change things; Let it move defaults to 2 s |
  | `512aac0` | Verification tools in `tools/`, these notes, `CLAUDE.md` |
  | `9113a03` | A push from the GUI brings its own Let it move (a push alone didn't move anything) |
  | `109b185` | Push: the drag is where the object lands, not a speed |

- Next release: ask the user which bump (semver: MAJOR breaks old scripts/output, MINOR adds,
  PATCH fixes); release with `npm version <x.y.z>` and push with `--follow-tags`, **only when asked**.
- `npm test`: 51 tests, all passing.

## 2. What was added in this round (shapes and motion)

The user asked for more shapes, for "forces" (by which they meant *movement in Behaviour* in
general, with a self-balancing tree reorganising as their example, not a physics catalogue), for
objects that can pop up during Behaviour (not only on the Stage), and for a lively but uncluttered
UI. What exists now:

| Area | What | Where |
|------|------|-------|
| Shapes | `rect`, `triangle`, `text` next to `node` (circle); `arrow` next to `edge` | `core/shapes.js`, `core/lua_api.js` |
| Appear / disappear | `remove(id)` (a node takes its lines); creating mid-script already worked | `lua_api.js`, `player.js` (`'remove'` op) |
| Smooth moves | `move(id, x, y, dur, "smooth")`; linear stays the default | `core/easing.js` |
| Where is it now | `pos(id)`, also mid-move and inside a rule | `lua_api.js` (`positionAt`) |
| Layout motion | `tree_layout(root, dur?)`: the tree glides into tidy rows (rotation = rewire, then tidy) | `core/layout.js` |
| Motion by rules | `push(id, vx, vy)`, `simulate(seconds, rule, {only, target})`; rules `drift`, `spread`, `fall`, `towards` or a Lua function | `core/motion.js`, `lua_api.js` |
| Tool row | select, circle, rectangle, triangle, text, line, arrow, push (keys V C R T X L A P) | `web/editor.js`, `web/index.html` |
| Steps | add object, connect, remove, tidy tree, push, let it move, plus the old colour/move/pause | `core/steps.js`, `web/app.js` |
| Lively UI | pop-in of new objects, new step slides in, faint red move trails in Behaviour, red second accent for appear/disappear/motion | `web/style.css`, `core/svg.js` (`opts.fresh`, `opts.trails`) |
| Examples | Tree rotation, Router network, Untangle a graph, Push/fall/your own rule (all "empty stage") | `examples/` |
| Tools | pixel check, animated-SVG check, layout check, spread tuning | `tools/` (§4) |

## 3. Design decisions worth knowing (and why)

**The three things that define the project** (the user's words): it produces **SVG**; the **GUI
generates readable Lua** in the background; **any frame can be had as an SVG**. The "teacher"
in older docs was only a persona for the prototype. Judge changes by these three.

- **The GUI only ever writes plain API calls.** Stage → `stage.lua`, Steps → `steps.lua`. Every new
  GUI feature must come out as Lua someone could have typed (Let it move → `simulate(2, "spread")`).
- **Record, then play.** The Lua API never draws; it appends commands to a timeline. Commands now
  also carry `name` (the object's name *when it ran*, so traces read well after a removal) and
  `src` (file and line, which is how Moments say "Step 3").
- **Simulations are baked.** `simulate` runs once, in fixed 10 ms ticks, and emits **one** `set pos`
  command per moving node carrying its whole path (`cmd.path`, a flat `[x0, y0, x1, y1, …]`, one
  position per tick, `cmd.motion` = rule name). Why: every frame stays exact and cheap, the animated
  SVG can replay it, a simulation is one moment and one trace line (not hundreds), and it is
  deterministic. Don't change this to many small moves: Moments, trace and animated SVG would flood.
- **Inside a rule time stands still.** A rule only returns an acceleration; `color`, `move`,
  `remove`, `wait`, `push`, creating objects or a nested `simulate` raise a clear error
  (`notInRule` in `lua_api.js`). Without that guard they silently landed at the simulation's start.
- **Velocity:** set by `push`, kept between simulations, cleared by `move()`; below 10 px/s at the
  end of a simulation counts as settled (`SETTLED` in `motion.js`), otherwise leftover crawl from
  "spread" made everything drift in a later simulation. The canvas edges are walls (`BOUNCE` 0.5).
- **"spread"** is a force layout: push ∝ 1/d, lines pull towards 90 px, weak pull to the centre,
  and friction that **rises over the run** (`world.f` = fraction done), so twisted graphs can unfold
  early and still settle by the end. Tuned with `tools/spread_tune.mjs` (§4). Known limit in §5.
- **One transform per object.** Every shape is drawn around its centre in a
  `<g transform="translate(x y)">`, so a move is one `animateTransform` whatever the shape.
  The editor's pop-in animation sits on an *inner* group: a CSS transform on the outer group would
  replace the translate and send the shape to the corner.
- **Arrows** are a 3-point `<polyline>` (start, middle, end) with `marker-mid` and
  `fill="context-stroke"` (librsvg 2.62 supports it), so the head takes the arrow's colour. The page
  (inline flavour) draws the head as a polygon instead. In the animated SVG the middle point depends
  on both ends, so arrow points are **sampled every 10 ms** while either end moves, with an explicit
  jump (two values at one key time) when an end moves instantly.
- **"smooth"** is CSS `ease-in-out`, cubic-bezier(0.42, 0, 0.58, 1), because SMIL can do exactly the
  same curve (`calcMode="spline"`), so preview and animated SVG agree.
- **Ids in exported SVG** come from `timelineIds(timeline)`: computed once from *every* object the
  timeline ever creates, so ids are stable across frames even after removals. `arrowhead` is reserved.
- **Two kinds of editor ids.** Stage objects have numbers; objects created by steps have strings
  `s1`, `s2`, … (`nextStepId`), so they can never clash. The Behaviour canvas shows the program's
  result mapped back to editor ids by `toEditorIds`: stage objects by creation order, step-created
  objects by the steps.lua **line** that created them (`stepAtLine`).
- **A step is kept only while its object exists at that point in the list** (`walk`/`pruneSteps` in
  `core/steps.js`): stage objects, plus earlier creates, minus earlier removes (with the lines of
  removed nodes). Deleting an "add" step therefore cascades. `INSTANT` steps have no duration;
  `RUNS_TIME` steps (pause, let it move) are lines of their own and nothing plays "with" them.
- **A push from the GUI comes with a "let it move"** (`addPush` in `core/steps.js`): `push()` only
  sets a speed and takes no time, so a push step on its own moved nothing and the video was only as
  long as the other steps (the user hit this). Now the Push tool adds `push` + a 2 s drift; pushes made
  one after another go in front of that same step, so they move together. **The drag is where it
  lands**, not a speed: speed = drag ÷ that step's length (the user found "speed = 2 × drag", which
  flew 4× the drag and bounced, confusing). After landing it keeps the speed, which is what makes a
  push different from a recorded move (a later fall or spread carries on from it). In code, `push` still
  needs an explicit `simulate`, which is the plain API and stays as it is.
- **`API_NAMES`** in `lua_api.js` is the single list of API globals: generated variable names avoid
  them and the code highlighter is built from them. Add every new API function there.

## 4. How to check your work

| Command | What it checks | Expected today |
|---------|----------------|----------------|
| `npm test` | 87 unit/integration tests (engine, steps, SVG, CLI, MP4, AI tools, loop, the Lua API reference) | all pass |
| `node tools/ai_eval.mjs` | small-model eval: step-by-step prompts through the assistant's loop (Ollama qwen3:0.6b) | see the AI round 2 note |
| `npm run check:pixels` | current renderer vs `v1.0.0` (librsvg pixels; export and inline flavours) | 89 frames, 4 differ by ≤ 2 in a channel (anti-aliasing of `translate()` vs `cx`) |
| `npm run check:animated` | writes `out/animated_check.html`: the animated SVG vs the player, every 23 ms, 6 cases (dfs, network, edge, sizes, curves, stretch) | open in Chrome: title says `20337 checks, 3 failures` (all `network` at 2100 ms, a command's exact start instant where Chrome's clock is 0.5 ms behind) |

- `check:animated --web` writes `web/_check.html` instead (served by `npm start`, handy for browser
  automation; it's git-ignored, delete it afterwards). The check must run after page load: SMIL
  timelines don't start before that and you get thousands of false failures.
- Re-run `check:pixels` after touching `core/svg.js` or `core/shapes.js`, and `check:animated` after
  touching `core/animated_svg.js`, `core/player.js`, easing or motion. Add a case to
  `tools/animated_check.mjs` for every new kind of animation.
- **GUI by hand** (no automated UI tests): Stage: each tool adds its shape, line/arrow drag connects,
  text asks for its words. Behaviour: a shape click adds an "appears" step and the object pops in;
  colour, Tidy tree, Remove, Push (adds its own Let it move; two pushes share it); delete an "add" step and its dependants go too;
  Run → Moments say "Step N". Watch the console for errors and screenshot each tab for clutter.

## 5. Known issues and limits

- **"spread" can leave one crossing on graphs with a cycle** (a square settles as a bow-tie from
  some starts; a 3×3 grid keeps a few). Trees untangle cleanly, which is why the Untangle example is
  a tree. Ideas: a smarter start (e.g. place by BFS before simulating), or temporarily stronger
  repulsion early on.
- **Let it move (GUI) moves everything, including text captions.** Only code has `{only = …}`.
  Open question for the user: should text stay put by default?
- **`simulate` takes over from moves still in progress** (it starts from where things are; the rest
  of the earlier move is dropped). Documented, not a bug, but can surprise.
- **Steps aren't saved** (only `stage.lua` is). Reloading the page loses steps and code.
- **Animated SVG size grows with simulations** (a position per node per 10 ms). Fine for seconds;
  for long simulations consider thinning the path (every 2nd–4th tick) in `animated_svg.js` only.
- **"spread" is O(n²) per tick**; `MAX_SECONDS` is 30. Large graphs (100+) will be slow in the page.
- The Behaviour panel is getting busy (palette, Tidy/Remove, duration, Pause, Let it move…). The user
  wants "lively, still uncluttered": screenshot and simplify before adding more there.
- Small things: the Push drag shows a plain dashed line (a real arrow with the speed would be
  livelier); motion trails exist only in Behaviour (a toggle in the Result preview was considered).

## 6. Next steps (also in TODO.md)

1. Screenshot every tab and remove clutter (Behaviour first).
2. Ask the user about text captions and Let it move.
3. Ask which version to release (mention the SVG format change), then `npm version`, push when asked.
4. Optional: motion trails toggle in Result; Push arrow with speed; collisions; a rule written once
   in code and reused from Steps; saving steps; better "spread" starts.

## 7. Working with this user

- They give **examples of intent, not specs** ("gravity and springs were examples"). Build the
  general mechanism, show the design first when it's a big one, and confirm before building.
- **Ask before:** a version bump, pushing, adding scope. Commit per phase locally (imperative
  subject, a body saying why). Keep README, ARCHITECTURE and TODO up to date as you go.
- **UI taste:** numbered flow (1 Stage → 2 Behaviour → 3 Result), one canvas + one panel, one thing
  on screen at a time, secondary detail in closed `<details>`; light greys, one blue accent
  (`#2f6fde`) plus red (`#e5484d`) as a second accent for things appearing, disappearing and moving;
  no shadows or gradients; respect reduced motion.
- **Copy:** British spelling (colour, behaviour), short plain sentences, "·" as a separator,
  errors as `file.lua:LINE: message`. Docs claim only what was checked.
- **"Run it" / "open it"** means `npm start` and `xdg-open http://localhost:8080/` in their own
  browser, not a browser-automation tab.
- Shell is **zsh**: `echo =====` fails (`=` expansion), `for x in $list` doesn't word-split (use
  `bash -c` or arrays), and `pkill -f "node node/server.js"` kills its own shell (use
  `pkill -f "[n]ode/server.js"`).
