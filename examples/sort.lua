-- Bubble sort: nodes are array cells, move() swaps them (Clear the stage first)
local values = { 5, 2, 4, 1, 3 }
local cells = {}
for i, v in ipairs(values) do cells[i] = node(tostring(v), 80 + i * 80, 180) end
wait(0.5)
for i = #values, 2, -1 do
  for j = 1, i - 1 do
    color(cells[j], "orange", 0.2); color(cells[j + 1], "orange", 0.2); wait(0.3)
    if values[j] > values[j + 1] then
      move(cells[j], 80 + (j + 1) * 80, 180, 0.4)
      move(cells[j + 1], 80 + j * 80, 180, 0.4); wait(0.5)
      values[j], values[j + 1] = values[j + 1], values[j]
      cells[j], cells[j + 1] = cells[j + 1], cells[j]
    end
    color(cells[j], "lightgrey", 0.2); color(cells[j + 1], "lightgrey", 0.2); wait(0.2)
  end
  color(cells[i], "green"); wait(0.3)
end
color(cells[1], "green")
