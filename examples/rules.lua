-- Motion by rules (Clear the stage first): push things, then let time run under a rule.
local balls = {}
for i, c in ipairs({ "red", "orange", "green", "blue" }) do
  balls[i] = node(tostring(i), 80 + i * 90, 80)
  color(balls[i], c, 0)
  push(balls[i], 70 * i - 170, -150)          -- a speed in pixels per second
end
local note = text("fall", 320, 30)
simulate(2.5, "fall", { only = balls })      -- a ready-made rule

-- A rule of your own: each ball heads for its own place on a line.
-- It gets a node and its position and speed, and returns an acceleration.
local place = {}
for i, b in ipairs(balls) do place[b] = 140 + (i - 1) * 120 end
color(note, "blue", 0.3)
simulate(2, function(id, x, y, vx, vy)
  return 30 * (place[id] - x) - 11 * vx, 30 * (180 - y) - 11 * vy
end, { only = balls })
wait(0.3)
