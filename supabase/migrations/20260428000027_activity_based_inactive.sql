-- Activity-based inactive detection.
--
-- PCO doesn't expose left_at on group/team memberships, so a person who
-- has not attended a group meeting or accepted a serving slot in over a
-- year still appears "active" in our mirror. This migration introduces
-- a recency-based inactive flag.
--
-- Rules:
--   * group_memberships.is_active=false if no group_event_attendance
--     for that (person, group) within the last INACTIVE_DAYS days
--     AND the membership is at least GRACE_DAYS old.
--   * team_memberships.is_active=false if no plan_team_member with
--     status='C' (confirmed served) for that (person, team) within the
--     last INACTIVE_DAYS days AND the membership is at least
--     GRACE_DAYS old.
--   * left_at is set to last_activity_at when known, otherwise
--     joined_at + INACTIVE_DAYS as a deterministic fallback.
--
-- last_activity_at is also stored on the row so the dashboard can
-- surface 6-month "fading" warnings without recomputing.

ALTER TABLE group_memberships
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;
ALTER TABLE team_memberships
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_group_memberships_last_activity
  ON group_memberships (church_id, last_activity_at DESC NULLS LAST)
  WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_team_memberships_last_activity
  ON team_memberships (church_id, last_activity_at DESC NULLS LAST)
  WHERE is_active = true;

-- Refresh last_activity_at from raw attendance / serving data. Idempotent;
-- safe to call after every sync.
CREATE OR REPLACE FUNCTION refresh_membership_activity()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Group memberships: most recent attended group_event_attendance.
  WITH last_att AS (
    SELECT
      gm.id AS membership_id,
      MAX(ge.starts_at) AS last_at
    FROM group_memberships gm
    LEFT JOIN group_event_attendances gea
      ON gea.person_id = gm.person_id
     AND gea.attended = true
    LEFT JOIN group_events ge
      ON ge.id = gea.event_id
     AND ge.group_id = gm.group_id
    GROUP BY gm.id
  )
  UPDATE group_memberships gm
  SET last_activity_at = la.last_at
  FROM last_att la
  WHERE gm.id = la.membership_id
    AND gm.last_activity_at IS DISTINCT FROM la.last_at;

  -- Team memberships: most recent confirmed plan_team_members slot.
  WITH last_serve AS (
    SELECT
      tm.id AS membership_id,
      MAX(sp.sort_date) AS last_at
    FROM team_memberships tm
    LEFT JOIN plan_team_members ptm
      ON ptm.person_id = tm.person_id
     AND ptm.team_id = tm.team_id
     AND ptm.status = 'C'
    LEFT JOIN service_plans sp
      ON sp.id = ptm.plan_id
    GROUP BY tm.id
  )
  UPDATE team_memberships tm
  SET last_activity_at = ls.last_at
  FROM last_serve ls
  WHERE tm.id = ls.membership_id
    AND tm.last_activity_at IS DISTINCT FROM ls.last_at;
END;
$$;

-- Mark memberships inactive when last_activity_at is too old. Default
-- threshold matches the user-stated rule: 12 months means "definitely
-- off." 6-month "fading" status stays implicit (consumers compute it
-- from last_activity_at directly when they want the softer signal).
CREATE OR REPLACE FUNCTION mark_inactive_by_activity(
  p_inactive_days int DEFAULT 365,
  p_grace_days int DEFAULT 90
)
RETURNS TABLE(table_name text, deactivated bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_groups bigint;
  v_teams bigint;
BEGIN
  WITH cutoff AS (
    SELECT
      now() - make_interval(days => p_inactive_days) AS inactive_before,
      now() - make_interval(days => p_grace_days) AS grace_before
  ),
  affected AS (
    UPDATE group_memberships gm
    SET
      is_active = false,
      left_at = COALESCE(gm.last_activity_at, gm.joined_at + make_interval(days => p_inactive_days))
    FROM cutoff c
    WHERE gm.is_active = true
      AND gm.joined_at IS NOT NULL
      AND gm.joined_at < c.grace_before
      AND (gm.last_activity_at IS NULL OR gm.last_activity_at < c.inactive_before)
    RETURNING 1
  )
  SELECT count(*) INTO v_groups FROM affected;

  WITH cutoff AS (
    SELECT
      now() - make_interval(days => p_inactive_days) AS inactive_before,
      now() - make_interval(days => p_grace_days) AS grace_before
  ),
  affected AS (
    UPDATE team_memberships tm
    SET
      is_active = false,
      left_at = COALESCE(tm.last_activity_at, tm.joined_at + make_interval(days => p_inactive_days))
    FROM cutoff c
    WHERE tm.is_active = true
      AND tm.joined_at IS NOT NULL
      AND tm.joined_at < c.grace_before
      AND (tm.last_activity_at IS NULL OR tm.last_activity_at < c.inactive_before)
    RETURNING 1
  )
  SELECT count(*) INTO v_teams FROM affected;

  RETURN QUERY VALUES ('group_memberships', v_groups), ('team_memberships', v_teams);
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_membership_activity() TO service_role;
GRANT EXECUTE ON FUNCTION mark_inactive_by_activity(int, int) TO service_role;

-- Backfill last_activity_at on existing data so the next cron run has a
-- baseline to compare against. Mark-inactive is intentionally NOT run
-- here; it's a behavior change that should land via the cron (so the
-- pco_sync_log entry records what changed).
SELECT refresh_membership_activity();
