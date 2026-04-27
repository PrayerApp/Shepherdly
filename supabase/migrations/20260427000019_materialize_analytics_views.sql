-- Materialize the three aggregation views the dashboard reads on every page load.
--
-- These views recompute on every read. Their inputs only change when the PCO
-- cron sync runs (daily) or when shepherd assignments change. Materializing
-- them moves work from the read path to a once-per-cron refresh.
--
-- We deliberately keep `active_unconnected_people` as a live view: when a
-- shepherd assignment changes, the unassigned page should update immediately,
-- not after the next cron tick.

-- ────────────────────────────────────────────────────────────
-- care_coverage_summary
-- One row. Drop the live view and replace with a materialized view.
-- ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS care_coverage_summary CASCADE;

CREATE MATERIALIZED VIEW care_coverage_summary AS
SELECT
  COUNT(*) FILTER (WHERE p.status = 'active' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete') AS total_active_people,
  COUNT(*) FILTER (WHERE p.status = 'active' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete' AND LOWER(p.membership_type) IN ('member', 'attender')) AS active_attenders,
  COUNT(*) FILTER (WHERE p.status = 'active' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NULL) AS unconnected_active,
  COUNT(*) FILTER (WHERE p.status = 'active' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NOT NULL) AS has_shepherd,
  COUNT(*) FILTER (WHERE p.status = 'inactive' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete') AS total_inactive,
  CASE
    WHEN COUNT(*) FILTER (WHERE p.status = 'active' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete') > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE p.status = 'active' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NOT NULL)
      / COUNT(*) FILTER (WHERE p.status = 'active' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete'),
      1
    )
    ELSE NULL
  END AS connection_pct
FROM people p
LEFT JOIN (
  SELECT DISTINCT person_id, shepherd_id
  FROM shepherding_relationships
  WHERE is_active = true
) sr ON sr.person_id = p.id;

-- Single-row materialized view doesn't strictly need a unique index, but
-- having one lets us use REFRESH ... CONCURRENTLY if we ever change the
-- view to be multi-row.
CREATE UNIQUE INDEX care_coverage_summary_unique_idx
  ON care_coverage_summary ((1));

-- ────────────────────────────────────────────────────────────
-- weekly_attendance_trend
-- N rows, keyed by week_start.
-- ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS weekly_attendance_trend CASCADE;

CREATE MATERIALIZED VIEW weekly_attendance_trend AS
SELECT
  date_trunc('week', ge.starts_at)::date AS week_start,
  COUNT(DISTINCT gea.person_id) AS unique_attenders,
  COUNT(gea.id) AS total_checkins
FROM group_event_attendances gea
JOIN group_events ge ON ge.id = gea.event_id
WHERE gea.attended = true
  AND ge.starts_at IS NOT NULL
GROUP BY date_trunc('week', ge.starts_at)
ORDER BY week_start;

CREATE UNIQUE INDEX weekly_attendance_trend_week_start_idx
  ON weekly_attendance_trend (week_start);

-- ────────────────────────────────────────────────────────────
-- context_summary
-- Per group/team aggregation, keyed by (context_type, context_id).
-- ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS context_summary CASCADE;

CREATE MATERIALIZED VIEW context_summary AS
SELECT
  'group' AS context_type,
  g.id AS context_id,
  g.name,
  g.group_type AS sub_type,
  COUNT(DISTINCT gm.person_id) FILTER (WHERE gm.is_active) AS member_count,
  COUNT(DISTINCT gm.person_id) FILTER (WHERE gm.is_active AND gm.role IN ('leader', 'Leader')) AS leader_count,
  g.church_id
FROM groups g
LEFT JOIN group_memberships gm ON gm.group_id = g.id
WHERE g.is_active = true
GROUP BY g.id, g.name, g.group_type, g.church_id

UNION ALL

SELECT
  'team' AS context_type,
  t.id AS context_id,
  t.name,
  t.team_type AS sub_type,
  COUNT(DISTINCT tm.person_id) AS member_count,
  COUNT(DISTINCT tm.person_id) FILTER (WHERE tm.role IN ('leader', 'Leader')) AS leader_count,
  t.church_id
FROM teams t
LEFT JOIN team_memberships tm ON tm.team_id = t.id
WHERE t.is_active = true
GROUP BY t.id, t.name, t.team_type, t.church_id;

CREATE UNIQUE INDEX context_summary_pk_idx
  ON context_summary (context_type, context_id);

CREATE INDEX context_summary_church_idx
  ON context_summary (church_id);

-- ────────────────────────────────────────────────────────────
-- refresh_analytics_views()
-- Single entrypoint the cron sync calls after PCO data is loaded.
-- Refreshes concurrently where possible so the dashboard never sees
-- a transient empty state.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY care_coverage_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_attendance_trend;
  REFRESH MATERIALIZED VIEW CONCURRENTLY context_summary;
END;
$$;

-- Initial population so the views aren't empty between this migration
-- and the next cron run.
REFRESH MATERIALIZED VIEW care_coverage_summary;
REFRESH MATERIALIZED VIEW weekly_attendance_trend;
REFRESH MATERIALIZED VIEW context_summary;

-- RLS-on-materialized-view note: PostgreSQL doesn't support RLS on
-- materialized views directly. The original views relied on the joined
-- `people`/`groups`/`teams` tables for RLS via SECURITY INVOKER. Since
-- the dashboard is read with the church-scoped admin client and the
-- views aggregate across the whole church anyway, we grant SELECT to
-- authenticated and rely on the application-level church_id filter the
-- API routes already apply on context_summary.
GRANT SELECT ON care_coverage_summary TO authenticated, service_role;
GRANT SELECT ON weekly_attendance_trend TO authenticated, service_role;
GRANT SELECT ON context_summary TO authenticated, service_role;
