-- Per-team stats so the /statistics page can expand a service_type row
-- and show one row per individual team underneath.
--
-- team_type_stats_v aggregates over all teams in a service_type;
-- team_stats_v keeps the same columns but at per-team granularity. The
-- two views share the same shape so the UI can reuse the same row
-- renderer.

CREATE MATERIALIZED VIEW team_stats_v AS
SELECT
  t.church_id,
  t.id AS team_id,
  t.name AS team_name,
  t.service_type_id AS type_id,
  st.name AS type_name,
  1 AS contexts,
  COUNT(DISTINCT tm.person_id) FILTER (
    WHERE tm.is_active AND NOT (COALESCE(tm.role, '') ~* 'leader|co.?leader')
  ) AS members,
  COUNT(DISTINCT tm.person_id) FILTER (
    WHERE tm.is_active AND COALESCE(tm.role, '') ~* 'leader|co.?leader'
  ) AS leaders,
  COUNT(*) FILTER (
    WHERE tm.joined_at IS NOT NULL AND tm.joined_at >= now() - interval '90 days'
  ) AS joined_recent,
  COUNT(*) FILTER (
    WHERE tm.left_at IS NOT NULL AND tm.left_at >= now() - interval '90 days'
  ) AS exited_recent,
  ROUND(EXTRACT(EPOCH FROM AVG(now() - tm.joined_at) FILTER (
    WHERE tm.is_active AND tm.joined_at IS NOT NULL
  )) / 86400)::int AS avg_tenure_active_days,
  ROUND(EXTRACT(EPOCH FROM AVG(tm.left_at - tm.joined_at) FILTER (
    WHERE NOT tm.is_active
      AND tm.joined_at IS NOT NULL
      AND tm.left_at IS NOT NULL
  )) / 86400)::int AS avg_tenure_exited_days
FROM teams t
JOIN service_types st
  ON st.id = t.service_type_id
 AND st.church_id = t.church_id
 AND st.is_tracked = true
LEFT JOIN team_memberships tm
  ON tm.team_id = t.id
 AND tm.church_id = t.church_id
WHERE t.is_active = true
GROUP BY t.church_id, t.id, t.name, t.service_type_id, st.name;

CREATE UNIQUE INDEX team_stats_v_pk
  ON team_stats_v (team_id);

CREATE INDEX team_stats_v_type
  ON team_stats_v (church_id, type_id);

-- Same trend snapshots, but at per-team granularity so the per-team
-- detail rows can show their own mini-bar trend.
CREATE MATERIALIZED VIEW team_trend_v AS
WITH snapshots AS (
  SELECT generate_series(0, 4) AS offset_idx
)
SELECT
  t.church_id,
  t.id AS team_id,
  s.offset_idx,
  (now() - make_interval(days => s.offset_idx * 90)) AS snapshot_at,
  COUNT(DISTINCT tm.person_id) FILTER (
    WHERE tm.joined_at IS NOT NULL
      AND tm.joined_at <= (now() - make_interval(days => s.offset_idx * 90))
      AND (tm.left_at IS NULL OR tm.left_at > (now() - make_interval(days => s.offset_idx * 90)))
      AND NOT (COALESCE(tm.role, '') ~* 'leader|co.?leader')
  ) AS members,
  COUNT(DISTINCT tm.person_id) FILTER (
    WHERE tm.joined_at IS NOT NULL
      AND tm.joined_at <= (now() - make_interval(days => s.offset_idx * 90))
      AND (tm.left_at IS NULL OR tm.left_at > (now() - make_interval(days => s.offset_idx * 90)))
      AND COALESCE(tm.role, '') ~* 'leader|co.?leader'
  ) AS leaders
FROM service_types st
JOIN teams t
  ON t.service_type_id = st.id
 AND t.church_id = st.church_id
 AND t.is_active = true
LEFT JOIN team_memberships tm
  ON tm.team_id = t.id
 AND tm.church_id = t.church_id
CROSS JOIN snapshots s
WHERE st.is_tracked = true
GROUP BY t.church_id, t.id, s.offset_idx;

CREATE UNIQUE INDEX team_trend_v_pk
  ON team_trend_v (team_id, offset_idx);

-- Extend refresh_analytics_views() to include the per-team views.
CREATE OR REPLACE FUNCTION refresh_analytics_views()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY care_coverage_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY weekly_attendance_trend;
  REFRESH MATERIALIZED VIEW CONCURRENTLY context_summary;
  REFRESH MATERIALIZED VIEW CONCURRENTLY group_type_stats_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY team_type_stats_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY group_type_trend_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY team_type_trend_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY staff_per_type_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY person_engagement_status;
  REFRESH MATERIALIZED VIEW CONCURRENTLY team_stats_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY team_trend_v;
END;
$$;

REFRESH MATERIALIZED VIEW team_stats_v;
REFRESH MATERIALIZED VIEW team_trend_v;

GRANT SELECT ON team_stats_v TO authenticated, service_role;
GRANT SELECT ON team_trend_v TO authenticated, service_role;
