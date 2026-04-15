-- Map a curated set of PCO Groups (or Service-Type Teams) onto a
-- pair of tree layers: one for leaders, one for members.
-- Multiple mappings can coexist (e.g. Worship A TEAM and B TEAM can
-- use different layer pairs), and each mapping can include any subset
-- of groups/teams from a given kind.
CREATE TABLE IF NOT EXISTS group_team_layer_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('groups', 'teams')),
  leader_layer_id uuid REFERENCES tree_layers(id) ON DELETE CASCADE,
  member_layer_id uuid REFERENCES tree_layers(id) ON DELETE CASCADE,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE group_team_layer_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "group_team_layer_mappings_church" ON group_team_layer_mappings FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_gtlm_leader ON group_team_layer_mappings(leader_layer_id);
CREATE INDEX IF NOT EXISTS idx_gtlm_member ON group_team_layer_mappings(member_layer_id);

-- Which specific group or team IDs are included in each mapping.
-- `item_id` references groups.id when parent mapping.kind = 'groups',
-- and teams.id when kind = 'teams'. Enforced in application code.
CREATE TABLE IF NOT EXISTS group_team_layer_mapping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mapping_id uuid REFERENCES group_team_layer_mappings(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(mapping_id, item_id)
);
ALTER TABLE group_team_layer_mapping_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "gtlm_items_church" ON group_team_layer_mapping_items FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_gtlm_items_mapping ON group_team_layer_mapping_items(mapping_id);
CREATE INDEX IF NOT EXISTS idx_gtlm_items_item ON group_team_layer_mapping_items(item_id);
