-- Manual per-layer additions in V2 tree: admin can add a specific
-- person to a specific layer directly, without going through a PCO list
-- or a Group/Team mapping.
CREATE TABLE IF NOT EXISTS tree_layer_inclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  layer_id uuid REFERENCES tree_layers(id) ON DELETE CASCADE,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(person_id, layer_id)
);
ALTER TABLE tree_layer_inclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tree_layer_inclusions_church" ON tree_layer_inclusions FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_tree_layer_inclusions_layer ON tree_layer_inclusions(layer_id);
CREATE INDEX IF NOT EXISTS idx_tree_layer_inclusions_person ON tree_layer_inclusions(person_id);

-- Functional index for fast case-insensitive name search on the people table.
CREATE INDEX IF NOT EXISTS idx_people_name_lower ON people (church_id, lower(name));
