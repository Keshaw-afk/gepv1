-- Breadth-first search from A
local seen = { [A] = true }
local queue = { A }
color(A, "orange"); wait(0.4)
while #queue > 0 do
  local v = table.remove(queue, 1)
  color(v, "red"); wait(0.4)
  for _, n in ipairs(neighbors(v)) do
    if not seen[n] then
      seen[n] = true
      color(edge_of(v, n), "red")
      color(n, "orange"); wait(0.4)
      table.insert(queue, n)
    end
  end
  color(v, "black"); wait(0.3)
end
