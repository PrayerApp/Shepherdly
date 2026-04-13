-- PCO Lists: stores REFERENCE lists synced from PCO
CREATE TABLE IF NOT EXISTS pco_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE NOT NULL,
  name text NOT NULL,
  description text,
  total_people integer DEFAULT 0,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE pco_lists ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pco_lists_church" ON pco_lists FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);

-- PCO List People: which people are in which list
CREATE TABLE IF NOT EXISTS pco_list_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid REFERENCES pco_lists(id) ON DELETE CASCADE,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  pco_list_id text,
  pco_person_id text,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(list_id, person_id)
);
ALTER TABLE pco_list_people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pco_list_people_church" ON pco_list_people FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_pco_list_people_list ON pco_list_people(list_id);
CREATE INDEX IF NOT EXISTS idx_pco_list_people_person ON pco_list_people(person_id);

-- Link a PCO list to a tree layer (admin config: one list → one layer)
CREATE TABLE IF NOT EXISTS pco_list_layer_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid REFERENCES pco_lists(id) ON DELETE CASCADE,
  layer_id uuid REFERENCES tree_layers(id) ON DELETE CASCADE,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(list_id, church_id)
);
ALTER TABLE pco_list_layer_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pco_list_layer_links_church" ON pco_list_layer_links FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
