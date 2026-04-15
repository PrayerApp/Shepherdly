-- V2 tree connections: directed edges from a person appearance on one layer
-- to a person appearance on a lower-ranked layer. Allows multi-parent and
-- layer skips. Each (parent, parent_layer) -> (child, child_layer) is unique.
CREATE TABLE IF NOT EXISTS tree_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  parent_layer_id uuid REFERENCES tree_layers(id) ON DELETE CASCADE,
  child_person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  child_layer_id uuid REFERENCES tree_layers(id) ON DELETE CASCADE,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(parent_person_id, parent_layer_id, child_person_id, child_layer_id),
  CHECK (NOT (parent_person_id = child_person_id AND parent_layer_id = child_layer_id))
);
ALTER TABLE tree_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tree_connections_church" ON tree_connections FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_tree_connections_parent ON tree_connections(parent_person_id, parent_layer_id);
CREATE INDEX IF NOT EXISTS idx_tree_connections_child ON tree_connections(child_person_id, child_layer_id);
