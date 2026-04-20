-- Per-layer exclusions for V2 tree: admin can remove a specific person
-- from a specific layer even though they appear on the PCO list linked to it.
CREATE TABLE IF NOT EXISTS tree_layer_exclusions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  layer_id uuid REFERENCES tree_layers(id) ON DELETE CASCADE,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(person_id, layer_id)
);
ALTER TABLE tree_layer_exclusions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tree_layer_exclusions_church" ON tree_layer_exclusions FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_tree_layer_exclusions_layer ON tree_layer_exclusions(layer_id);
CREATE INDEX IF NOT EXISTS idx_tree_layer_exclusions_person ON tree_layer_exclusions(person_id);
