# GEPV1 Lua API

Every function a GEPV1 program can call. The functions are defined in `core/lua_api.js`, and every
example here runs as it stands. Each call becomes a command on the timeline. That timeline is what
plays in the player, and what gives the still frames, the animated SVG and the MP4.

- [How a program runs](#how-a-program-runs) · [Time](#time-only-wait-moves-the-clock) · [The canvas](#the-canvas)
- **Create:** [node](#node) · [rect](#rect) · [triangle](#triangle) · [text](#text) · [cell](#cell) · [grid](#grid) · [edge](#edge) · [arrow](#arrow)
- **Animate:** [move](#move) · [path](#path) · [color](#color) · [label](#label) · [size](#size) · [remove](#remove) · [wait](#wait) · [finish](#finish)
- **Ask:** [pos](#pos) · [neighbors](#neighbors) · [edge_of](#edge_of) · [print](#print)
- [Maths in labels](#maths-in-labels) · [Colour names](#colour-names) · [Limits and the sandbox](#limits-and-the-sandbox) · [Error messages](#error-messages) · [A whole script](#a-whole-script-depth-first-search)

## How a program runs

```
stage.lua  →  steps.lua  →  script.lua
```

The files run one after another in **one** Lua state, so they share one clock and the same globals:

- **stage.lua** is the starting picture.
- **steps.lua** is the keyframes, made on the canvas or typed in the **Code** tab (a REPL). Each
  entry you type becomes a keyframe. An entry whose changes all start together becomes ordinary
  steps; anything else (waits, loops, algorithms) is a *code keyframe*, played as written inside
  `do … end; finish()`. So `local` variables stay inside their entry, and globals carry on.
- **script.lua** is code that plays after all the keyframes. It's for the command line, and for
  projects from before the REPL.

A variable made in stage.lua, such as `A`, can be used in later code. When an object's label is a
valid Lua name, the editor names the variable after it: `A = node("A", 100, 180)`. A name you typed
in the REPL (`b = node("ball", …)`) is kept. Other labels get a generated name; the Code tab shows
every keyframe as Lua, so you can see it there.

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
| `cell` | 40 × 30 px, square corners | white `#ffffff` |
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

### cell

`cell(label, x, y, w?, h?) → id`

A table cell: a white box with square corners and a label. It takes the same arguments as
[`node`](#node). Cells side by side share their borders, so they look like a table; [`grid`](#grid)
makes a whole table at once.

```lua
c = cell("7", 320, 180)
```

### grid

`grid(rows, cols, x, y, w?, h?) → t`

A table of empty cells, with its top-left corner at `(x, y)`. It returns a Lua table: `t[r][c]` is
the cell in row `r` and column `c`, counting from 1. Fill it with [`label`](#label) and highlight
cells with [`color`](#color).

| Argument | Meaning |
|---|---|
| `rows, cols` | how many rows and columns (at most 400 cells) |
| `x, y` | the top-left corner, in pixels |
| `w, h` | optional cell size factors, as for [`node`](#node) (a cell is 40 × 30 px at 1) |

In the Code tab, `t = grid(…)` becomes a code keyframe so that later entries can still use `t`.

```lua
t = grid(3, 4, 240, 120)          -- 3 rows of 4 cells, 160 × 90 px
for c = 1, 4 do label(t[1][c], c) end
color(t[2][3], "yellow")
wait(0.5)
label(t[2][3], "x")
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

### label

`label(id, text)`

Changes the label of a shape, or the words of a text, at once. `text` can be a string or a number,
and can contain [maths](#maths-in-labels). Use it for values that change: a counter, a cell of a
table, a variable.

```lua
count = text("0", 320, 40)
for i = 1, 3 do
  wait(0.5)
  label(count, i)
end
```

In stage.lua, `label(A, "x")` straight after creating A sets its starting label.

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

## Maths in labels

The parts of a label between `$` signs are maths, written like LaTeX. They can have symbols,
subscripts and superscripts; there are no fractions or other layout. Outside `$…$` a label is shown
as written, and `\$` is a dollar sign.

```lua
text([[$c_{i,j} = c_{i-1,j-1} + 1$]], 320, 60)   -- c with subscript i,j …
text([[$x^2 \le n \times m$]], 320, 100)          -- x², ≤ and ×
text([[$a <= b$ and $i -> j$]], 320, 140)         -- ASCII shortcuts
```

**Write maths in long strings, `[[…]]`.** In an ordinary `"…"` string Lua reads a backslash as an
escape: `"\le"` is an error and `"\times"` becomes a tab followed by "imes".

| Write | For |
|---|---|
| `x_i`, `x_{i+1}` | a subscript (one character, or a `{group}`) |
| `x^2`, `2^{n-1}` | a superscript |
| `-` | a minus sign (−) |
| `<=` `>=` `!=` | ≤ ≥ ≠ |
| `->` `<-` `=>` `<=>` `+-` `...` | → ← ⇒ ⇔ ± … |
| `\le \ge \ne \approx \equiv` | ≤ ≥ ≠ ≈ ≡ |
| `\times \cdot \div \pm` | × · ÷ ± |
| `\leftarrow \rightarrow \uparrow \downarrow \nwarrow \nearrow \Rightarrow \iff` | ← → ↑ ↓ ↖ ↗ ⇒ ⇔ |
| `\in \notin \subset \subseteq \cup \cap \emptyset` | ∈ ∉ ⊂ ⊆ ∪ ∩ ∅ |
| `\forall \exists \neg \land \lor` | ∀ ∃ ¬ ∧ ∨ |
| `\sum \prod \int \sqrt \infty \partial` | ∑ ∏ ∫ √ ∞ ∂ |
| `\lfloor \rfloor \lceil \rceil \langle \rangle \ldots` | ⌊ ⌋ ⌈ ⌉ ⟨ ⟩ … |
| `\alpha` … `\omega`, `\Gamma` … `\Omega` | Greek letters |
| `\,` `\quad` | a thin and a wide space |

An unknown command is shown as typed, so a typing mistake is easy to see.

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

(For tables and maths, see `examples/lcs.lua`: the dynamic-programming table of the longest common
subsequence, filled cell by cell with `grid`, `label` and `color`, then traced back.)

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
