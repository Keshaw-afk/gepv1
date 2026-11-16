-- Packets travel through routers (Clear the stage first). Shapes: rect, circle, text, arrow.
local r1, r2, r3 = rect("R1", 110, 180), rect("R2", 320, 90), rect("R3", 530, 180)
arrow(r1, r2); arrow(r2, r3); arrow(r1, r3)
text("Router network", 320, 330)
wait(0.5)
for i = 1, 3 do
  local p = node("p" .. i, 110, 180)
  color(p, "blue", 0)
  local via = (i == 2) and { r3 } or { r2, r3 }     -- packet 2 takes the direct route
  for _, r in ipairs(via) do
    local x, y = pos(r)
    color(r, "orange", 0.2)
    move(p, x, y, 0.7, "smooth"); wait(0.7)
    color(r, "lightgrey", 0.2)
  end
  color(p, "green", 0.2); wait(0.2)
  remove(p)
end
wait(0.3)
