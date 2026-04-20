-- Track mapping-driven auto-generated connections, and add an auto_connect
-- flag to group/team mappings.

ALTER TABLE group_team_layer_mappings
  ADD COLUMN IF NOT EXISTS auto_connect boolean DEFAULT false;

ALTER TABLE tree_connections
  ADD COLUMN IF NOT EXISTS source_mapping_id uuid
    REFERENCES group_team_layer_mappings(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_tree_connections_source_mapping
  ON tree_connections(source_mapping_id);
