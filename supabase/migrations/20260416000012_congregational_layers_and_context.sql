-- Mark a layer as "congregational" (lowest level / non-leadership).
ALTER TABLE tree_layers
  ADD COLUMN IF NOT EXISTS is_congregational boolean DEFAULT false;

-- Record which group/team an auto-generated connection came from so the
-- UI can render one card per membership on congregational layers.
ALTER TABLE tree_connections
  ADD COLUMN IF NOT EXISTS context_group_id uuid REFERENCES groups(id) ON DELETE CASCADE;
ALTER TABLE tree_connections
  ADD COLUMN IF NOT EXISTS context_team_id uuid REFERENCES teams(id) ON DELETE CASCADE;

-- Drop the prior 4-tuple uniqueness so multiple edges between the same
-- pair can coexist when they come from different group/team contexts.
-- We rely on application-level dedup going forward. Try every likely
-- auto-generated constraint name so the migration is idempotent across
-- environments.
DO $$
DECLARE
  con record;
BEGIN
  FOR con IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'tree_connections'::regclass AND contype = 'u'
  LOOP
    EXECUTE 'ALTER TABLE tree_connections DROP CONSTRAINT ' || quote_ident(con.conname);
  END LOOP;
END$$;

CREATE INDEX IF NOT EXISTS idx_tree_connections_context_group
  ON tree_connections(context_group_id);
CREATE INDEX IF NOT EXISTS idx_tree_connections_context_team
  ON tree_connections(context_team_id);
