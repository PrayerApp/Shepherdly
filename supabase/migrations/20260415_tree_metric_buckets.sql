-- User-configurable metric buckets for the V2 person cards.
-- Each bucket has a short label (e.g. "S"), a full name (e.g. "Staff"),
-- an optional color, and is mapped to one or more layers. The count
-- shown on a card for a bucket is the number of distinct people among
-- that card's connection descendants that sit on a layer in that
-- bucket. Each layer belongs to at most one bucket.
CREATE TABLE IF NOT EXISTS tree_metric_buckets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  full_name text NOT NULL,
  color text,
  sort_order integer DEFAULT 0,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE tree_metric_buckets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tree_metric_buckets_church" ON tree_metric_buckets FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_tree_metric_buckets_church ON tree_metric_buckets(church_id);

CREATE TABLE IF NOT EXISTS tree_metric_bucket_layers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id uuid REFERENCES tree_metric_buckets(id) ON DELETE CASCADE,
  layer_id uuid REFERENCES tree_layers(id) ON DELETE CASCADE,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(layer_id, church_id)
);
ALTER TABLE tree_metric_bucket_layers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tree_metric_bucket_layers_church" ON tree_metric_bucket_layers FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_tmbl_bucket ON tree_metric_bucket_layers(bucket_id);
CREATE INDEX IF NOT EXISTS idx_tmbl_layer ON tree_metric_bucket_layers(layer_id);
