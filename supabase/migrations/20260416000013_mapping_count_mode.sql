-- How to count shepherding when a group/team has multiple leaders.
-- 'all'        = every leader counts all members (default)
-- 'split'      = members divided evenly across leaders (fractional)
-- 'split_round' = members divided evenly, rounded up per leader
ALTER TABLE group_team_layer_mappings
  ADD COLUMN IF NOT EXISTS count_mode text DEFAULT 'all'
  CHECK (count_mode IN ('all', 'split', 'split_round'));
