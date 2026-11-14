-- Depth-first search over whatever graph was drawn in the editor.
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
