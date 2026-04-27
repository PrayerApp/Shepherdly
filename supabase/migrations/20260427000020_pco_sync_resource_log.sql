-- Per-resource sync observability.
--
-- Today `pco_sync_log` has only a single status row per run. When a sync
-- slows down, fails halfway, or silently drops rows due to unresolvable
-- foreign keys, there is no way to see which resource caused it. This
-- table records one row per run × resource so we can answer:
--
--   * which resource is slow?
--   * are we silently losing rows? if so, on which table?
--   * did the sync get partway through and crash? where exactly?

CREATE TABLE IF NOT EXISTS pco_sync_resource_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sync_log_id uuid REFERENCES pco_sync_log(id) ON DELETE CASCADE,
  resource_table text NOT NULL,
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  duration_ms integer,
  rows_seen integer NOT NULL DEFAULT 0,
  rows_upserted integer NOT NULL DEFAULT 0,
  rows_skipped_unresolvable_fk integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'running',
  error_message text,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE pco_sync_resource_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pco_sync_resource_log_church" ON pco_sync_resource_log
  FOR ALL USING (
    church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_pco_sync_resource_log_run
  ON pco_sync_resource_log (sync_log_id);

CREATE INDEX IF NOT EXISTS idx_pco_sync_resource_log_recent
  ON pco_sync_resource_log (church_id, started_at DESC);
