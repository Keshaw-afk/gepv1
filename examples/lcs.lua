-- Longest common subsequence: the dynamic-programming table, filled cell by cell, then traced back.
-- Runs on an empty stage. Change X and Y to try other strings (up to about 7 letters each).

local X, Y = "ABCBDAB", "BDCABA"
local m, n = #X, #Y

-- colours
local HEAD, LIT, NOW, FROM, PATH = "#eef1f5", "#cfe3ff", "#fff3b0", "#d9f2dc", "#ffcc80"

-- the picture: a title, the table (with the letters of X down the side, Y along the top), the rule
text("Longest common subsequence", 320, 24)
local t = grid(m + 2, n + 2, 20, 48)
local function at(i, j) return t[i + 2][j + 2] end -- DP cell c[i][j], i and j from 0
for c = 1, n + 2 do color(t[1][c], HEAD, 0) end
for r = 2, m + 2 do color(t[r][1], HEAD, 0) end
for j = 1, n do label(t[1][j + 2], Y:sub(j, j)) end
for i = 1, m do label(t[i + 2][1], X:sub(i, i)) end

text("X = " .. X .. ",  Y = " .. Y, 490, 66)
text([[if $x_i = y_j$:  $c_{i,j} = c_{i-1,j-1} + 1$]], 490, 104, 0.85)
text([[else:  $c_{i,j} = max(c_{i-1,j}, c_{i,j-1})$]], 490, 130, 0.85)
local where = text("", 490, 182)
local why = text("", 490, 212)
local value = text("", 490, 242)
local answer = text("", 490, 300)
wait(1)

-- row 0 and column 0 are all 0
local c, from = {}, {}
for i = 0, m do c[i] = {}; from[i] = {} end
label(where, "Empty prefix: length 0")
for j = 0, n do c[0][j] = 0; label(at(0, j), 0); wait(0.06) end
for i = 1, m do c[i][0] = 0; label(at(i, 0), 0); wait(0.06) end
wait(0.8)

-- every other cell, row by row: the first row slowly, the rest faster
for i = 1, m do
  local pace = i == 1 and 1 or 0.45
  for j = 1, n do
    local xi, yj = X:sub(i, i), Y:sub(j, j)
    color(t[i + 2][1], LIT, 0.15); color(t[1][j + 2], LIT, 0.15); color(at(i, j), NOW, 0.15)
    label(where, string.format("$i = %d,  j = %d$", i, j))
    local deps
    if xi == yj then
      c[i][j] = c[i - 1][j - 1] + 1
      from[i][j] = "↖"
      deps = { at(i - 1, j - 1) }
      label(why, string.format("$x_%d = y_%d =$ %s", i, j, xi))
      label(value, string.format("$c_{%d,%d} = %d + 1 = %d$", i, j, c[i - 1][j - 1], c[i][j]))
    else
      local up, left = c[i - 1][j], c[i][j - 1]
      c[i][j] = math.max(up, left)
      from[i][j] = up >= left and "↑" or "←"
      deps = { at(i - 1, j), at(i, j - 1) }
      label(why, string.format("$x_%d$ = %s $!=$ %s $= y_%d$", i, xi, yj, j))
      label(value, string.format("$c_{%d,%d} = max(%d, %d) = %d$", i, j, up, left, c[i][j]))
    end
    for _, d in ipairs(deps) do color(d, FROM, 0.15) end
    wait(pace * 0.6)
    label(at(i, j), from[i][j] .. c[i][j])
    wait(pace * 0.4)
    -- back to plain at once, so the highlights always match the text
    for _, d in ipairs(deps) do color(d, "white", 0) end
    color(at(i, j), "white", 0); color(t[i + 2][1], HEAD, 0); color(t[1][j + 2], HEAD, 0)
  end
end
wait(0.6)

-- the answer: follow the arrows back from the last cell; every ↖ is a letter of the LCS
label(where, string.format("Length: $c_{%d,%d} = %d$", m, n, c[m][n]))
label(why, "Follow the arrows back")
label(value, [[$\nwarrow$: a letter of the LCS]])
wait(1.4)
local i, j, lcs = m, n, ""
while i > 0 and j > 0 do
  color(at(i, j), PATH, 0.2)
  if from[i][j] == "↖" then
    lcs = X:sub(i, i) .. lcs
    color(t[i + 2][1], PATH, 0.2); color(t[1][j + 2], PATH, 0.2)
    label(answer, "LCS = " .. lcs)
    wait(0.6)
    i, j = i - 1, j - 1
  elseif from[i][j] == "↑" then
    wait(0.35); i = i - 1
  else
    wait(0.35); j = j - 1
  end
end
wait(0.4)
label(where, "")
label(why, "")
label(value, "")
label(answer, string.format("LCS = %s  (length %d)", lcs, #lcs))
size(answer, 1.3, 1.3, 0.4, "smooth")
color(answer, "#1e6b3a", 0.4)
wait(2)
