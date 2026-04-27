-- Move the statistics route's in-memory aggregation into SQL views.
--
-- Today /api/statistics fires 14 parallel queries and aggregates everything
-- in JavaScript: per-type counts, leader/member splits, joined/exited
-- windows, tenure averages, 5 trend snapshots, staff-by-type lookups
-- (tree-walked), and person engagement classification.
--
-- All of these are pure functions of tables that only change when the
-- cron sync runs (or when an admin edits tree connections, mappings,
-- inclusions). Materializing them moves the work from the read path
-- to a once-per-refresh batch. Adding a new statistic now means
-- editing one view definition instead of also wiring it through 200
-- lines of TypeScript.
--
-- All views are refreshed by the existing refresh_analytics_views()
-- RPC, called from the cron orchestrator after each sync.
--
-- Refresh cadence note: snapshot dates inside the trend views shift
-- forward by however long has passed since the last refresh. Cron
-- runs daily, so trend points are accurate to ±1 day, which is well
-- inside the noise floor of a 12-month chart.

-- ────────────────────────────────────────────────────────────
-- group_type_stats_v
-- One row per (church_id, group_type_id) for tracked group_types.
-- ────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW group_type_stats_v AS
SELECT
  g.church_id,
  g.group_type_id AS type_id,
  gt.name AS type_name,
  COUNT(DISTINCT g.id) AS contexts,
  COUNT(DISTINCT gm.person_id) FILTER (
    WHERE gm.is_active AND NOT (COALESCE(gm.role, '') ~* 'leader|co.?leader')
  ) AS members,
  COUNT(DISTINCT gm.person_id) FILTER (
    WHERE gm.is_active AND COALESCE(gm.role, '') ~* 'leader|co.?leader'
  ) AS leaders,
  COUNT(*) FILTER (
    WHERE gm.joined_at IS NOT NULL AND gm.joined_at >= now() - interval '90 days'
  ) AS joined_recent,
  COUNT(*) FILTER (
    WHERE gm.left_at IS NOT NULL AND gm.left_at >= now() - interval '90 days'
  ) AS exited_recent,
  -- AVG returns NULL on empty filter set, exactly what the route wants.
  ROUND(EXTRACT(EPOCH FROM AVG(now() - gm.joined_at) FILTER (
    WHERE gm.is_active AND gm.joined_at IS NOT NULL
  )) / 86400)::int AS avg_tenure_active_days,
  ROUND(EXTRACT(EPOCH FROM AVG(gm.left_at - gm.joined_at) FILTER (
    WHERE NOT gm.is_active
      AND gm.joined_at IS NOT NULL
      AND gm.left_at IS NOT NULL
  )) / 86400)::int AS avg_tenure_exited_days
FROM group_types gt
JOIN groups g
  ON g.group_type_id = gt.id
 AND g.church_id = gt.church_id
 AND g.is_active = true
LEFT JOIN group_memberships gm
  ON gm.group_id = g.id
 AND gm.church_id = g.church_id
WHERE gt.is_tracked = true
GROUP BY g.church_id, g.group_type_id, gt.name;

CREATE UNIQUE INDEX group_type_stats_v_pk
  ON group_type_stats_v (church_id, type_id);

-- ────────────────────────────────────────────────────────────
-- team_type_stats_v — same shape for service_types/teams
-- ────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW team_type_stats_v AS
SELECT
  t.church_id,
  t.service_type_id AS type_id,
  st.name AS type_name,
  COUNT(DISTINCT t.id) AS contexts,
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
FROM service_types st
JOIN teams t
  ON t.service_type_id = st.id
 AND t.church_id = st.church_id
 AND t.is_active = true
LEFT JOIN team_memberships tm
  ON tm.team_id = t.id
 AND tm.church_id = t.church_id
WHERE st.is_tracked = true
GROUP BY t.church_id, t.service_type_id, st.name;

CREATE UNIQUE INDEX team_type_stats_v_pk
  ON team_type_stats_v (church_id, type_id);

-- ────────────────────────────────────────────────────────────
-- group_type_trend_v / team_type_trend_v
-- 5 snapshot points per type. snapshot_offset 0 = current, 4 = 12 months ago.
-- The "members at time t" count uses joined_at <= t AND (left_at IS NULL
-- OR left_at > t), matching the in-memory countMembersAt logic.
-- ────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW group_type_trend_v AS
WITH snapshots AS (
  SELECT generate_series(0, 4) AS offset_idx
)
SELECT
  g.church_id,
  g.group_type_id AS type_id,
  s.offset_idx,
  (now() - make_interval(days => s.offset_idx * 90)) AS snapshot_at,
  COUNT(DISTINCT gm.person_id) FILTER (
    WHERE gm.joined_at IS NOT NULL
      AND gm.joined_at <= (now() - make_interval(days => s.offset_idx * 90))
      AND (gm.left_at IS NULL OR gm.left_at > (now() - make_interval(days => s.offset_idx * 90)))
      AND NOT (COALESCE(gm.role, '') ~* 'leader|co.?leader')
  ) AS members,
  COUNT(DISTINCT gm.person_id) FILTER (
    WHERE gm.joined_at IS NOT NULL
      AND gm.joined_at <= (now() - make_interval(days => s.offset_idx * 90))
      AND (gm.left_at IS NULL OR gm.left_at > (now() - make_interval(days => s.offset_idx * 90)))
      AND COALESCE(gm.role, '') ~* 'leader|co.?leader'
  ) AS leaders
FROM group_types gt
JOIN groups g
  ON g.group_type_id = gt.id
 AND g.church_id = gt.church_id
 AND g.is_active = true
LEFT JOIN group_memberships gm
  ON gm.group_id = g.id
 AND gm.church_id = g.church_id
CROSS JOIN snapshots s
WHERE gt.is_tracked = true
GROUP BY g.church_id, g.group_type_id, s.offset_idx;

CREATE UNIQUE INDEX group_type_trend_v_pk
  ON group_type_trend_v (church_id, type_id, offset_idx);

CREATE MATERIALIZED VIEW team_type_trend_v AS
WITH snapshots AS (
  SELECT generate_series(0, 4) AS offset_idx
)
SELECT
  t.church_id,
  t.service_type_id AS type_id,
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
GROUP BY t.church_id, t.service_type_id, s.offset_idx;

CREATE UNIQUE INDEX team_type_trend_v_pk
  ON team_type_trend_v (church_id, type_id, offset_idx);

-- ────────────────────────────────────────────────────────────
-- staff_per_type_v
-- Staff persons (placed on a tree_layer with category='staff') who
-- shepherd at least one active member of each tracked type. Walks
-- shepherding_connections for placement, tree_connections for the
-- shepherding edge.
--
-- One row per (church_id, kind, type_id). `kind` is 'group' or 'team'.
-- staff_person_ids holds the deduped set so the totals row in the
-- stats UI can compute "distinct staff across all types" cheaply.
-- ────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW staff_per_type_v AS
WITH staff_placements AS (
  SELECT DISTINCT sc.church_id, sc.person_id
  FROM shepherding_connections sc
  JOIN tree_layers tl ON tl.id = sc.layer_id AND tl.category = 'staff'
)
SELECT
  g.church_id,
  'group'::text AS kind,
  g.group_type_id AS type_id,
  COUNT(DISTINCT sp.person_id) AS staff_count,
  COALESCE(array_agg(DISTINCT sp.person_id) FILTER (WHERE sp.person_id IS NOT NULL), '{}') AS staff_person_ids
FROM groups g
JOIN group_types gt
  ON gt.id = g.group_type_id
 AND gt.church_id = g.church_id
 AND gt.is_tracked = true
JOIN group_memberships gm
  ON gm.group_id = g.id
 AND gm.church_id = g.church_id
 AND gm.is_active = true
LEFT JOIN tree_connections tc
  ON tc.child_person_id = gm.person_id
 AND tc.church_id = g.church_id
LEFT JOIN staff_placements sp
  ON sp.person_id = tc.parent_person_id
 AND sp.church_id = g.church_id
WHERE g.is_active = true
  AND g.group_type_id IS NOT NULL
GROUP BY g.church_id, g.group_type_id

UNION ALL

SELECT
  t.church_id,
  'team'::text AS kind,
  t.service_type_id AS type_id,
  COUNT(DISTINCT sp.person_id) AS staff_count,
  COALESCE(array_agg(DISTINCT sp.person_id) FILTER (WHERE sp.person_id IS NOT NULL), '{}') AS staff_person_ids
FROM teams t
JOIN service_types st
  ON st.id = t.service_type_id
 AND st.church_id = t.church_id
 AND st.is_tracked = true
JOIN team_memberships tm
  ON tm.team_id = t.id
 AND tm.church_id = t.church_id
 AND tm.is_active = true
LEFT JOIN tree_connections tc
  ON tc.child_person_id = tm.person_id
 AND tc.church_id = t.church_id
LEFT JOIN staff_placements sp
  ON sp.person_id = tc.parent_person_id
 AND sp.church_id = t.church_id
WHERE t.is_active = true
  AND t.service_type_id IS NOT NULL
GROUP BY t.church_id, t.service_type_id;

CREATE UNIQUE INDEX staff_per_type_v_pk
  ON staff_per_type_v (church_id, kind, type_id);

-- ────────────────────────────────────────────────────────────
-- person_engagement_status
-- Per (church, person) classification: excluded / shepherded / active /
-- present. Mirrors the rules in the in-memory categorization loop.
-- ────────────────────────────────────────────────────────────
CREATE MATERIALIZED VIEW person_engagement_status AS
WITH p_signals AS (
  SELECT
    p.id AS person_id,
    p.church_id,
    p.membership_type,
    EXISTS (
      SELECT 1 FROM group_memberships gm
      WHERE gm.person_id = p.id AND gm.is_active
    ) AS in_group,
    EXISTS (
      SELECT 1 FROM team_memberships tm
      WHERE tm.person_id = p.id AND tm.is_active
    ) AS in_team,
    EXISTS (
      SELECT 1 FROM attendance_records ar
      WHERE ar.person_id = p.id
        AND ar.checked_in_at >= now() - interval '12 months'
    ) AS recent_checkin,
    EXISTS (
      SELECT 1 FROM pco_signup_attendees a
      WHERE a.person_id = p.id
        AND a.registered_at >= now() - interval '12 months'
        AND COALESCE(a.canceled, false) = false
        AND (COALESCE(a.active, false) OR COALESCE(a.waitlisted, false))
    ) AS recent_registration,
    EXISTS (
      SELECT 1 FROM pco_form_submissions fs
      JOIN pco_form_sync_config fc
        ON fc.form_pco_id = fs.form_pco_id
       AND fc.church_id = fs.church_id
      WHERE fs.person_id = p.id
        AND fs.submitted_at >= now() - interval '12 months'
        AND fc.purpose = 'prayer'
        AND fc.is_active = true
    ) AS recent_prayer
  FROM people p
  WHERE p.status = 'active'
    AND LEFT(p.name, 1) NOT IN ('_', '-')
)
SELECT
  person_id,
  church_id,
  CASE
    WHEN membership_type IN ('SYSTEM USE - Do Not Delete', 'Former Member') THEN 'excluded'
    WHEN in_group OR in_team
      OR membership_type = 'Outreach Partner'
      OR recent_checkin THEN 'shepherded'
    WHEN recent_registration
      OR recent_prayer
      OR membership_type IN ('Benevolence Only', 'Activity Only', 'Parent Only', 'Online Submission Only') THEN 'active'
    ELSE 'present'
  END AS status
FROM p_signals;

CREATE UNIQUE INDEX person_engagement_status_pk
  ON person_engagement_status (person_id);

CREATE INDEX person_engagement_status_church
  ON person_engagement_status (church_id, status);

-- ────────────────────────────────────────────────────────────
-- Refresh: extend the existing refresh_analytics_views() RPC
-- so cron picks up the new views automatically.
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
  REFRESH MATERIALIZED VIEW CONCURRENTLY group_type_stats_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY team_type_stats_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY group_type_trend_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY team_type_trend_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY staff_per_type_v;
  REFRESH MATERIALIZED VIEW CONCURRENTLY person_engagement_status;
END;
$$;

-- Initial population.
REFRESH MATERIALIZED VIEW group_type_stats_v;
REFRESH MATERIALIZED VIEW team_type_stats_v;
REFRESH MATERIALIZED VIEW group_type_trend_v;
REFRESH MATERIALIZED VIEW team_type_trend_v;
REFRESH MATERIALIZED VIEW staff_per_type_v;
REFRESH MATERIALIZED VIEW person_engagement_status;

GRANT SELECT ON group_type_stats_v TO authenticated, service_role;
GRANT SELECT ON team_type_stats_v TO authenticated, service_role;
GRANT SELECT ON group_type_trend_v TO authenticated, service_role;
GRANT SELECT ON team_type_trend_v TO authenticated, service_role;
GRANT SELECT ON staff_per_type_v TO authenticated, service_role;
GRANT SELECT ON person_engagement_status TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- get_event_attendance_counts(event_ids)
-- One round-trip aggregation for the analytics ?detail=group view's
-- "attendees per event" sparkline. Replaces fetching every
-- group_event_attendances row and counting in JS.
-- ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION get_event_attendance_counts(p_event_ids uuid[])
RETURNS TABLE(event_id uuid, attendee_count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT event_id, COUNT(*)::bigint
  FROM group_event_attendances
  WHERE event_id = ANY(p_event_ids)
    AND attended = true
  GROUP BY event_id;
$$;

GRANT EXECUTE ON FUNCTION get_event_attendance_counts(uuid[]) TO authenticated, service_role;
