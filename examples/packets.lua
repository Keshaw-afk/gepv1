-- Packets hop A -> B -> D, one after another
local where = { [A] = {100, 180}, [B] = {270, 90}, [D] = {440, 180} }
local route = { A, B, D }
for i = 1, 3 do
  local p = node("p" .. i, 100, 180)
  color(p, "blue", 0)
  color(edge_of(A, B), "orange"); color(edge_of(B, D), "orange")
  for k = 2, #route do
    local x, y = table.unpack(where[route[k]])
    move(p, x, y, 0.6); wait(0.6)       -- wait so the next hop starts after this one
  end
  color(p, "green"); wait(0.3)
end
