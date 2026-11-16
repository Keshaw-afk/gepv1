-- Right rotation at 50 in a binary search tree (Clear the stage first).
-- Rewire two lines, then tree_layout glides every node to its new place.
local n = {}
for _, p in ipairs({ {50, 320}, {30, 220}, {70, 420}, {20, 160}, {40, 280} }) do
  n[p[1]] = node(tostring(p[1]), p[2], 60)
end
edge(n[50], n[30]); edge(n[50], n[70]); edge(n[30], n[20]); edge(n[30], n[40])
tree_layout(n[50], 0)                       -- tidy straight away
local note = text("Right rotation at 50", 320, 330)
wait(0.8)

color(n[50], "orange"); color(n[30], "orange"); wait(0.6)
color(edge_of(n[30], n[40]), "red"); wait(0.5)
remove(edge_of(n[50], n[30])); remove(edge_of(n[30], n[40]))
edge(n[30], n[50]); color(edge(n[50], n[40]), "red"); wait(0.4)
tree_layout(n[30], 1)                       -- 30 is the new root
wait(1.2)
color(n[50], "lightgrey"); color(n[30], "lightgrey"); color(edge_of(n[50], n[40]), "grey")
color(note, "green"); wait(0.6)
