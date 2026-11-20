# GEPV1 Lua API

Every function a GEPV1 program can call. The functions are defined in `core/lua_api.js`, and every
example here runs as it stands. Each call becomes a command on the timeline. That timeline is what
plays in the player, and what gives the still frames, the animated SVG and the MP4.

- [How a program runs](#how-a-program-runs) · [Time](#time-only-wait-moves-the-clock) · [The canvas](#the-canvas)
- **Create:** [node](#node) · [rect](#rect) · [triangle](#triangle) · [text](#text) · [edge](#edge) · [arrow](#arrow)
- **Animate:** [move](#move) · [path](#path) · [color](#color) · [size](#size) · [remove](#remove) · [wait](#wait) · [finish](#finish)
- **Ask:** [pos](#pos) · [neighbors](#neighbors) · [edge_of](#edge_of) · [print](#print)
- [Colour names](#colour-names) · [Limits and the sandbox](#limits-and-the-sandbox) · [Error messages](#error-messages) · [A whole script](#a-whole-script-depth-first-search)

## How a program runs

```
stage.lua  →  steps.lua  →  script.lua
```

The three files run one after another in **one** Lua state, so they share one clock and the same
globals. The Build tab writes the first two for you:

- **stage.lua** is the starting picture.
- **steps.lua** holds the steps and keyframes you made in Build.
- **script.lua** is the Code tab.

A variable made in stage.lua, such as `A`, can be used in the script. When an object's label is a
valid Lua name, the editor names the variable after it: `A = node("A", 100, 180)`. Other labels get a
generated name; to see it, open **stage.lua and steps.lua (generated)** in Build.

## Time: only `wait` moves the clock

An animation call starts at the current script time and returns at once. Calls made one after
another start together. `wait(t)` moves the clock on, so the next call starts later.

```lua
move(A, 500, 100, 1)    -- starts at 0 s
move(B, 500, 260, 1)    -- also starts at 0 s: they move together
wait(1)                 -- the clock is now 1 s
color(A, "green")       -- starts at 1 s, lasts the default 0.5 s
```

Durations are in seconds and default to **0.5 s**. A duration of `0` changes the thing at once. The
animation lasts until its last change ends, so you don't need a `wait` at the end to see it finish.

## The canvas

The canvas is 640 × 360 pixels. `(0, 0)` is the top left; x grows to the right and y grows **down**.
A position is the centre of the shape. The coordinates button in the Build toolbar shows this grid.

| Shape | Natural size (size 1) | Default colour |
|---|---|---|
| circle (`node`) | 48 px across | light grey `#cccccc` |
| box (`rect`) | 64 × 40 px, rounded corners | light grey |
| `triangle` | 56 × 48 px | light grey |
| `text` | 17 px bold letters | dark grey `#333333` |
| line, arrow | between two shapes, follows them | grey `#888888` |

## Create

Each of these returns the new object's id, a number. Keep it in a variable to animate the object
later. An object made in stage.lua is part of the starting picture. One made later appears at the
current script time.

### node

`node(label, x, y, w?, h?) → id`

A circle with a label written on it.

| Argument | Meaning |
|---|---|
| `label` | the text on it, a string (it can be empty: `""`) |
| `x, y` | the centre, in pixels |
| `w, h` | optional starting size: width and height factors from 0.25 to 5 (1 = normal). Give only `w` to scale both ways. |

```lua
A = node("A", 100, 180)
big = node("root", 320, 60, 1.5)       -- 1.5 times as big
wide = rect("queue", 320, 300, 3, 1)   -- 3 times as wide, normal height
```

### rect

`rect(label, x, y, w?, h?) → id`

A box with rounded corners and a label. It takes the same arguments as [`node`](#node). Boxes suit
arrays, stacks and queues.

```lua
box = rect("5", 200, 180)
```

### triangle

`triangle(label, x, y, w?, h?) → id`

A triangle with a label. It takes the same arguments as [`node`](#node).

```lua
tri = triangle("T", 320, 180)
```

### text

`text(words, x, y, w?, h?) → id`

Just text, with no shape around it, for titles, notes and values. `color` colours the letters and
`size` scales them.

```lua
title = text("Bubble sort", 320, 30)
```

### edge

`edge(a, b) → id`

A line between two shapes. `a` and `b` are the ids of the two shapes (not lines). The line follows
the shapes when they move, and goes when either of them is removed.

```lua
A = node("A", 100, 180)
B = node("B", 300, 180)
line = edge(A, B)
```

Two shapes can have only **one** line between them, in either direction. A second one is an error:
`edge between B and A already exists`.

### arrow

`arrow(a, b) → id`

Like [`edge`](#edge), with an arrowhead halfway along, pointing from `a` to `b`.

```lua
C = node("C", 500, 180)
ptr = arrow(B, C)      -- B → C
```

## Animate

These start at the current script time and run for `dur` seconds (0.5 s when it's left out). They
don't move the clock; [`wait`](#wait) does.

### move

`move(id, x, y, dur?, ease?)`

Moves a shape in a straight line to `(x, y)`.

| Argument | Meaning |
|---|---|
| `id` | a shape (lines follow their shapes) |
| `x, y` | where to, in pixels |
| `dur` | seconds, 0 or more (default 0.5) |
| `ease` | `"linear"` (the default, an even speed) or `"smooth"` (slow in, slow out) |

```lua
move(A, 500, 180, 2)
wait(2)
move(A, 100, 180, 1, "smooth")
```

### path

`path(id, {{x, y}, …}, dur?, ease?)`

A curved move. The shape starts where it is now, goes through each point and ends at the last one.
The curve is smoothed and travelled at an even speed.

- The points are a table of 1 to 500 `{x, y}` pairs.
- `dur` and `ease` work as for [`move`](#move).

```lua
ball = node("ball", 60, 300)
path(ball, {{320, 60}, {580, 300}}, 2)   -- up over the top, down the other side
```

### color

`color(id, c, dur?)`

Fades a shape, a line or some text to a new colour.

- `id` is a shape or a line.
- `c` is a [colour name](#colour-names) or a hex code (`"#f00"` or `"#ff0000"`).
- `dur` is in seconds (default 0.5); `0` changes the colour at once.

```lua
color(A, "red")
wait(1)
color(A, "#1e88e5", 2)
```

In stage.lua, `color(A, "red", 0)` straight after creating A sets its starting colour. That's how
the editor saves coloured shapes.

### size

`size(id, w, h?, dur?, ease?)`

Scales a shape about its centre. The factors are relative to the shape's natural size, not its
current size.

- `w` and `h` are the width and height factors, from 0.25 to 5 (1 = normal). `size(A, 2)` is short
  for `size(A, 2, 2)`.
- `dur` and `ease` work as for [`move`](#move). Give `h` before a duration: `size(A, 2, 2, 1)`.

```lua
size(A, 2, 2, 1)     -- grows to twice its size over 1 s
wait(1)
size(A, 3, 1)        -- 3 times as wide, normal height
```

A label never stretches: it scales with the smaller of the two factors.

### remove

`remove(id)`

The shape or line disappears at the current script time. A shape takes its lines with it. After
`remove`, the id no longer works, and using it is an error.

```lua
edge(A, B)
wait(1)
remove(A)      -- A and the line A–B go at 1 s
```

### wait

`wait(t)`

Moves the script clock on by `t` seconds (0 or more), so everything called afterwards starts later.
See [Time](#time-only-wait-moves-the-clock).

```lua
move(A, 500, 100, 1)
move(B, 500, 260, 1)   -- together with A
wait(1)
color(A, "green")      -- after both moves
```

### finish

`finish()`

Waits until every change that has started has ended. Use it instead of working out a `wait` by
hand. Each code keyframe from the REPL ends with it, so the next keyframe starts after everything in
it has finished.

```lua
color(A, "red", 2)
move(B, 500, 260, 1)
finish()               -- the clock is now 2 s: the colour change has ended too
color(B, "green")
```

## Ask

These read the picture as it is at the current script time, so an algorithm can work on whatever
graph you drew in the Build tab.

### pos

`pos(id) → x, y`

Returns where a shape is now, as two numbers. It works halfway through a move too.

```lua
move(A, 500, 180, 2)   -- A starts at (100, 180)
wait(1)
local x, y = pos(A)    -- 300, 180: halfway
```

### neighbors

`neighbors(id) → {id, …}`

Returns the shapes joined to this one by a line or an arrow, as a list in the order the lines were
made. Here, arrows count in both directions.

```lua
for _, n in ipairs(neighbors(A)) do
  color(edge_of(A, n), "red"); wait(0.3)
  color(n, "red"); wait(0.3)
end
```

### edge_of

`edge_of(a, b) → id or nil`

Returns the line between two shapes (in either direction), or `nil` when they aren't joined. Use it
to colour the line you travel along.

```lua
local e = edge_of(A, B)
if e then color(e, "red") end
```

### print

`print(…)`

Writes a line to the trace in the Result tab. It draws nothing; use it to check what a script is
doing.

```lua
print("A is", A)      -- A is	1
```

## Colour names

You can use any of these names, or a hex code. `gray` and `grey` are both accepted.

| Name | Hex | Name | Hex | Name | Hex |
|---|---|---|---|---|---|
| black | `#000000` | orange | `#fb8c00` | lime | `#c0ca33` |
| white | `#ffffff` | purple | `#8e24aa` | navy | `#283593` |
| red | `#e53935` | pink | `#ec407a` | teal | `#00897b` |
| green | `#43a047` | cyan | `#00acc1` | grey | `#9e9e9e` |
| blue | `#1e88e5` | magenta | `#d81b60` | lightgrey | `#cccccc` |
| yellow | `#fdd835` | brown | `#6d4c41` | darkgrey | `#555555` |

## Limits and the sandbox

| | |
|---|---|
| Lua libraries | the basic functions, plus `table`, `string` and `math`. There's no `io`, `os`, `require`, `dofile` or `loadfile`, so a script can't touch files. |
| Running time | about 50 million Lua instructions, then the script stops (this catches endless loops) |
| Commands | 50,000 API calls that draw or change something |
| Sizes | 0.25 to 5 times the natural size |
| Durations | 0 or more seconds (the Build tab's fields allow 0.1 to 60) |
| `path` points | 1 to 500 |

## Error messages

An error names the file and line, then says what went wrong. These are real messages from the
engine:

```
script.lua:1: argument #1: no node with id 42
script.lua:2: size must be from 0.25 to 5 (1 is the normal size)
script.lua:2: unknown easing 'bouncy' (use "linear" or "smooth")
script.lua:3: unknown colour 'sparkly' (use a name like "red" or a hex code like "#ff0000")
script ran too long (infinite loop?)
```

"no node with id" usually means the variable is `nil`, or the object was removed.

## A whole script: depth-first search

This is the Code tab's DFS example (`examples/dfs.lua`). It runs on whatever graph is drawn in
Build, starting from `A`.

```lua
local visited = {}

local function dfs(v)
  visited[v] = true
  color(v, "red"); wait(0.5)            -- visiting v
  for _, n in ipairs(neighbors(v)) do
    if not visited[n] then
      color(edge_of(v, n), "red"); wait(0.3)
      dfs(n)
    end
  end
  color(v, "black"); wait(0.3)          -- finished with v
end

dfs(A)
```
