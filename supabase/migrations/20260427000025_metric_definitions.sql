-- New-metric ergonomics.
--
-- Today, adding a new dashboard metric means: write SQL fragments in a
-- route, write JS aggregation, add a chart component, wire it through
-- /api/analytics — four files, 100+ lines per metric.
--
-- This table makes metrics declarative. A metric is a row with a
-- machine key, human label, the SQL expression that computes its
-- value (operating against the materialized stats views), units, and
-- a default-visible flag. The /api/analytics route can resolve which
-- metrics a page asks for, evaluate them via a bounded SECURITY
-- INVOKER function, and return their values without app-code edits.
--
-- This migration ships the table + seed rows for the metrics already
-- exposed by /api/statistics. Wiring the analytics route to evaluate
-- arbitrary metric_definitions rows is a follow-up; ships that needs
-- careful SQL-expression sandboxing and is its own change.

CREATE TABLE IF NOT EXISTS metric_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  /* Stable machine key, e.g. 'avg_contexts_per_person'. Used by the
   * client to request specific metrics. */
  key text UNIQUE NOT NULL,
  /* Human label rendered in the UI. */
  label text NOT NULL,
  /* Optional longer description shown in tooltips. */
  description text,
  /* SQL expression operating on the analytics views. Evaluated by a
   * trusted, fixed SQL function — NOT executed via dynamic SQL by app
   * code. Examples:
   *   "SELECT AVG(total_contexts) FROM person_analytics
   *      WHERE church_id = $1"
   *   "SELECT 100.0 * COUNT(*) FILTER (WHERE status='shepherded')
   *      / NULLIF(COUNT(*), 0)
   *      FROM person_engagement_status
   *      WHERE church_id = $1"
   * Until the evaluator lands, this column is informational. */
  sql_expression text NOT NULL,
  /* 'count', 'percent', 'days', 'ratio', etc. Drives client-side
   * formatting (3 vs 3% vs 3 days). */
  unit text NOT NULL DEFAULT 'count' CHECK (unit IN ('count', 'percent', 'days', 'ratio', 'currency')),
  /* Whether this metric appears on the default stats page render. */
  default_visible boolean NOT NULL DEFAULT true,
  /* Sort order in the UI. Lower numbers come first. */
  display_order integer NOT NULL DEFAULT 100,
  /* Per-church scoping — different churches can enable/disable
   * different metrics. */
  church_id uuid REFERENCES churches(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE metric_definitions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "metric_definitions_church" ON metric_definitions
  FOR ALL USING (
    church_id IS NULL  -- global metrics readable by everyone
    OR church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
  );

CREATE INDEX IF NOT EXISTS idx_metric_definitions_church
  ON metric_definitions (church_id, is_active, display_order);

-- Seed the metrics already exposed by /api/statistics so the table is
-- the source of truth from day one. New metrics get added here, not
-- in route code.
INSERT INTO metric_definitions (key, label, description, sql_expression, unit, default_visible, display_order)
VALUES
  ('avg_contexts_per_person',
   'Avg contexts / person',
   'Average number of group + team memberships per active person.',
   'SELECT ROUND(AVG(total_contexts)::numeric, 2) FROM person_analytics WHERE church_id = $1',
   'count', true, 10),
  ('avg_group_attendance_rate',
   'Avg group attendance rate',
   'Average ratio of attended-to-scheduled group events across people.',
   'SELECT ROUND(AVG(group_attendance_rate)::numeric, 3) FROM person_analytics WHERE church_id = $1',
   'ratio', true, 20),
  ('connection_pct',
   'Care coverage',
   'Percentage of active people with at least one shepherd assigned.',
   'SELECT connection_pct FROM care_coverage_summary',
   'percent', true, 30),
  ('shepherded_count',
   'Shepherded people',
   'Active people with a shepherd, group/team membership, or recent check-in.',
   'SELECT COUNT(*) FROM person_engagement_status WHERE church_id = $1 AND status = ''shepherded''',
   'count', true, 40),
  ('present_count',
   'Present (no signal)',
   'Active people with no shepherd, no membership, no recent touchpoint.',
   'SELECT COUNT(*) FROM person_engagement_status WHERE church_id = $1 AND status = ''present''',
   'count', false, 50)
ON CONFLICT (key) DO NOTHING;
