-- Filter calculated-inactive people out of every shepherding-stats view.
--
-- Sister migration to 29 (which adds people.is_calculated_active and
-- the refresh function). The application-layer routes already filter
-- direct queries; this migration takes care of the materialized views
-- and DB functions that aggregate on the read path.
--
-- Skipped intentionally:
--   * group_type_trend_v / team_type_trend_v / team_trend_v — historical
--     snapshots. Filtering by the *current* is_calculated_active flag
--     would erase people who were active at the time of an old
--     snapshot, which is wrong.
--   * weekly_attendance_trend — same reasoning. Past attendance is
--     attendance whether or not the person is currently calc-active.
--   * person_analytics — joined back through `people` in /api/people,
--     which already filters; the analytics rows for inactive people
--     are simply never reached.

-- ────────────────────────────────────────────────────────────
-- care_coverage_summary
-- Adds AND p.is_calculated_active = true to every counted predicate.
-- ────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS care_coverage_summary CASCADE;

CREATE MATERIALIZED VIEW care_coverage_summary AS
SELECT
  COUNT(*) FILTER (WHERE p.status = 'active' AND p.is_calculated_active = true AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete') AS total_active_people,
  COUNT(*) FILTER (WHERE p.status = 'active' AND p.is_calculated_active = true AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete' AND LOWER(p.membership_type) IN ('member', 'attender')) AS active_attenders,
  COUNT(*) FILTER (WHERE p.status = 'active' AND p.is_calculated_active = true AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NULL) AS unconnected_active,
  COUNT(*) FILTER (WHERE p.status = 'active' AND p.is_calculated_active = true AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NOT NULL) AS has_shepherd,
  COUNT(*) FILTER (WHERE p.status = 'inactive' AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete') AS total_inactive,
  CASE
    WHEN COUNT(*) FILTER (WHERE p.status = 'active' AND p.is_calculated_active = true AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete') > 0
    THEN ROUND(
      100.0 * COUNT(*) FILTER (WHERE p.status = 'active' AND p.is_calculated_active = true AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete' AND sr.shepherd_id IS NOT NULL)
      / COUNT(*) FILTER (WHERE p.status = 'active' AND p.is_calculated_active = true AND LEFT(p.name, 1) NOT IN ('_', '-') AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete'),
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

CREATE UNIQUE INDEX care_coverage_summary_unique_idx
  ON care_coverage_summary ((1));

GRANT SELECT ON care_coverage_summary TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- active_unconnected_people (regular view — supports OR REPLACE
-- only when the column shape is unchanged; we DROP CASCADE first
-- because get_unconnected_type_counts depends on it).
-- ────────────────────────────────────────────────────────────
DROP VIEW IF EXISTS active_unconnected_people CASCADE;

CREATE VIEW active_unconnected_people AS
SELECT p.id, p.name, p.pco_id, p.membership_type, p.church_id
FROM people p
LEFT JOIN shepherding_relationships sr
  ON sr.person_id = p.id AND sr.is_active = true
WHERE p.status = 'active'
  AND p.is_calculated_active = true
  AND sr.id IS NULL
  AND LEFT(p.name, 1) NOT IN ('_', '-')
  AND COALESCE(p.membership_type, '') != 'SYSTEM USE - Do Not Delete'
ORDER BY p.name;

GRANT SELECT ON active_unconnected_people TO authenticated, service_role;

-- get_unconnected_type_counts depends on active_unconnected_people,
-- so we recreate it after the view (CASCADE dropped it above).
CREATE OR REPLACE FUNCTION get_unconnected_type_counts(p_church_id uuid)
RETURNS TABLE(membership_type text, cnt bigint)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    COALESCE(p.membership_type, 'Unknown') AS membership_type,
    COUNT(*) AS cnt
  FROM active_unconnected_people p
  WHERE p.church_id = p_church_id
  GROUP BY p.membership_type
  ORDER BY cnt DESC;
$$;

GRANT EXECUTE ON FUNCTION get_unconnected_type_counts(uuid) TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- context_summary
-- Per group/team membership counts. Join people so memberships
-- belonging to inactive folks don't contribute to member_count or
-- leader_count. The LEFT JOIN preserves rows for empty contexts.
-- ────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS context_summary CASCADE;

CREATE MATERIALIZED VIEW context_summary AS
SELECT
  'group' AS context_type,
  g.id AS context_id,
  g.name,
  g.group_type AS sub_type,
  COUNT(DISTINCT p.id) FILTER (WHERE gm.is_active) AS member_count,
  COUNT(DISTINCT p.id) FILTER (WHERE gm.is_active AND gm.role IN ('leader', 'Leader')) AS leader_count,
  g.church_id
FROM groups g
LEFT JOIN group_memberships gm ON gm.group_id = g.id
LEFT JOIN people p ON p.id = gm.person_id AND p.is_calculated_active = true
WHERE g.is_active = true
GROUP BY g.id, g.name, g.group_type, g.church_id

UNION ALL

SELECT
  'team' AS context_type,
  t.id AS context_id,
  t.name,
  t.team_type AS sub_type,
  COUNT(DISTINCT p.id) AS member_count,
  COUNT(DISTINCT p.id) FILTER (WHERE tm.role IN ('leader', 'Leader')) AS leader_count,
  t.church_id
FROM teams t
LEFT JOIN team_memberships tm ON tm.team_id = t.id
LEFT JOIN people p ON p.id = tm.person_id AND p.is_calculated_active = true
WHERE t.is_active = true
GROUP BY t.id, t.name, t.team_type, t.church_id;

CREATE UNIQUE INDEX context_summary_pk_idx
  ON context_summary (context_type, context_id);

CREATE INDEX context_summary_church_idx
  ON context_summary (church_id);

GRANT SELECT ON context_summary TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- group_type_stats_v
-- Same join-and-count-on-p.id pattern. p.is_calculated_active=true is
-- on the LEFT JOIN clause so contexts with zero active members still
-- appear in the stats with count=0.
-- ────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS group_type_stats_v CASCADE;

CREATE MATERIALIZED VIEW group_type_stats_v AS
SELECT
  g.church_id,
  g.group_type_id AS type_id,
  gt.name AS type_name,
  COUNT(DISTINCT g.id) AS contexts,
  COUNT(DISTINCT p.id) FILTER (
    WHERE gm.is_active AND NOT (COALESCE(gm.role, '') ~* 'leader|co.?leader')
  ) AS members,
  COUNT(DISTINCT p.id) FILTER (
    WHERE gm.is_active AND COALESCE(gm.role, '') ~* 'leader|co.?leader'
  ) AS leaders,
  COUNT(*) FILTER (
    WHERE p.id IS NOT NULL
      AND gm.joined_at IS NOT NULL AND gm.joined_at >= now() - interval '90 days'
  ) AS joined_recent,
  COUNT(*) FILTER (
    WHERE p.id IS NOT NULL
      AND gm.left_at IS NOT NULL AND gm.left_at >= now() - interval '90 days'
  ) AS exited_recent,
  ROUND(EXTRACT(EPOCH FROM AVG(now() - gm.joined_at) FILTER (
    WHERE p.id IS NOT NULL AND gm.is_active AND gm.joined_at IS NOT NULL
  )) / 86400)::int AS avg_tenure_active_days,
  ROUND(EXTRACT(EPOCH FROM AVG(gm.left_at - gm.joined_at) FILTER (
    WHERE p.id IS NOT NULL
      AND NOT gm.is_active
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
LEFT JOIN people p
  ON p.id = gm.person_id
 AND p.is_calculated_active = true
WHERE gt.is_tracked = true
GROUP BY g.church_id, g.group_type_id, gt.name;

CREATE UNIQUE INDEX group_type_stats_v_pk
  ON group_type_stats_v (church_id, type_id);

GRANT SELECT ON group_type_stats_v TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- team_type_stats_v
-- ────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS team_type_stats_v CASCADE;

CREATE MATERIALIZED VIEW team_type_stats_v AS
SELECT
  t.church_id,
  t.service_type_id AS type_id,
  st.name AS type_name,
  COUNT(DISTINCT t.id) AS contexts,
  COUNT(DISTINCT p.id) FILTER (
    WHERE tm.is_active AND NOT (COALESCE(tm.role, '') ~* 'leader|co.?leader')
  ) AS members,
  COUNT(DISTINCT p.id) FILTER (
    WHERE tm.is_active AND COALESCE(tm.role, '') ~* 'leader|co.?leader'
  ) AS leaders,
  COUNT(*) FILTER (
    WHERE p.id IS NOT NULL
      AND tm.joined_at IS NOT NULL AND tm.joined_at >= now() - interval '90 days'
  ) AS joined_recent,
  COUNT(*) FILTER (
    WHERE p.id IS NOT NULL
      AND tm.left_at IS NOT NULL AND tm.left_at >= now() - interval '90 days'
  ) AS exited_recent,
  ROUND(EXTRACT(EPOCH FROM AVG(now() - tm.joined_at) FILTER (
    WHERE p.id IS NOT NULL AND tm.is_active AND tm.joined_at IS NOT NULL
  )) / 86400)::int AS avg_tenure_active_days,
  ROUND(EXTRACT(EPOCH FROM AVG(tm.left_at - tm.joined_at) FILTER (
    WHERE p.id IS NOT NULL
      AND NOT tm.is_active
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
LEFT JOIN people p
  ON p.id = tm.person_id
 AND p.is_calculated_active = true
WHERE st.is_tracked = true
GROUP BY t.church_id, t.service_type_id, st.name;

CREATE UNIQUE INDEX team_type_stats_v_pk
  ON team_type_stats_v (church_id, type_id);

GRANT SELECT ON team_type_stats_v TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- staff_per_type_v
-- The "members" inputs for both halves of the UNION ALL get the
-- same active-person gate. Staff placements themselves are derived
-- from shepherding_connections → tree_layers; we don't filter the
-- staff side because shepherds may legitimately be marked
-- calc-inactive while still actively shepherding. (If you want that
-- too, change sp.person_id check below.)
-- ────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS staff_per_type_v CASCADE;

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
JOIN people p
  ON p.id = gm.person_id
 AND p.is_calculated_active = true
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
JOIN people p
  ON p.id = tm.person_id
 AND p.is_calculated_active = true
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

GRANT SELECT ON staff_per_type_v TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- team_stats_v (per-team, mirrors team_type_stats_v shape)
-- ────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS team_stats_v CASCADE;

CREATE MATERIALIZED VIEW team_stats_v AS
SELECT
  t.church_id,
  t.id AS team_id,
  t.name AS team_name,
  t.service_type_id AS type_id,
  st.name AS type_name,
  1 AS contexts,
  COUNT(DISTINCT p.id) FILTER (
    WHERE tm.is_active AND NOT (COALESCE(tm.role, '') ~* 'leader|co.?leader')
  ) AS members,
  COUNT(DISTINCT p.id) FILTER (
    WHERE tm.is_active AND COALESCE(tm.role, '') ~* 'leader|co.?leader'
  ) AS leaders,
  COUNT(*) FILTER (
    WHERE p.id IS NOT NULL
      AND tm.joined_at IS NOT NULL AND tm.joined_at >= now() - interval '90 days'
  ) AS joined_recent,
  COUNT(*) FILTER (
    WHERE p.id IS NOT NULL
      AND tm.left_at IS NOT NULL AND tm.left_at >= now() - interval '90 days'
  ) AS exited_recent,
  ROUND(EXTRACT(EPOCH FROM AVG(now() - tm.joined_at) FILTER (
    WHERE p.id IS NOT NULL AND tm.is_active AND tm.joined_at IS NOT NULL
  )) / 86400)::int AS avg_tenure_active_days,
  ROUND(EXTRACT(EPOCH FROM AVG(tm.left_at - tm.joined_at) FILTER (
    WHERE p.id IS NOT NULL
      AND NOT tm.is_active
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
LEFT JOIN people p
  ON p.id = tm.person_id
 AND p.is_calculated_active = true
WHERE t.is_active = true
GROUP BY t.church_id, t.id, t.name, t.service_type_id, st.name;

CREATE UNIQUE INDEX team_stats_v_pk
  ON team_stats_v (team_id);

CREATE INDEX team_stats_v_type
  ON team_stats_v (church_id, type_id);

GRANT SELECT ON team_stats_v TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- person_engagement_status — directly filter at the people scan.
-- ────────────────────────────────────────────────────────────
DROP MATERIALIZED VIEW IF EXISTS person_engagement_status CASCADE;

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
    AND p.is_calculated_active = true
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

GRANT SELECT ON person_engagement_status TO authenticated, service_role;

-- ────────────────────────────────────────────────────────────
-- refresh_analytics_views() — unchanged shape but the views it
-- refreshes were dropped and recreated above, so REFRESH must be
-- non-concurrent on the very first call (an empty mat-view can't
-- be refreshed concurrently). Subsequent runs from cron use the
-- existing CONCURRENTLY definition.
-- ────────────────────────────────────────────────────────────
REFRESH MATERIALIZED VIEW care_coverage_summary;
REFRESH MATERIALIZED VIEW context_summary;
REFRESH MATERIALIZED VIEW group_type_stats_v;
REFRESH MATERIALIZED VIEW team_type_stats_v;
REFRESH MATERIALIZED VIEW staff_per_type_v;
REFRESH MATERIALIZED VIEW team_stats_v;
REFRESH MATERIALIZED VIEW person_engagement_status;
