-- A tangled graph sorts itself out (Clear the stage first): the "spread" rule.
-- Nodes push each other apart, lines pull their ends together, friction lets it settle.
local names = { "A", "B", "C", "D", "E", "F", "G", "H", "I", "J" }
local n = {}
for i, name in ipairs(names) do
  n[name] = node(name, 260 + (i * 47) % 120, 120 + (i * 71) % 120)   -- thrown in a heap
end
for _, p in ipairs({ {"A","B"}, {"A","C"}, {"A","D"}, {"B","E"}, {"B","F"}, {"C","G"}, {"D","H"}, {"D","I"}, {"I","J"} }) do
  edge(n[p[1]], n[p[2]])
end
wait(0.5)
simulate(3, "spread")
color(n.A, "orange", 0.3)
wait(0.5)
