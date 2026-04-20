-- Add is_hidden flag to tree_layers so users can toggle layer visibility.
ALTER TABLE tree_layers ADD COLUMN IF NOT EXISTS is_hidden boolean NOT NULL DEFAULT false;
