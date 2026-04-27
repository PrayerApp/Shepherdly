-- Make refresh_person_analytics() incremental.
--
-- Today's RPC does `DELETE FROM person_analytics; INSERT ...` — for a 10k-
-- person church that holds row locks for the full table for 1-2 minutes
-- and forces every dashboard read during the window to wait or see an
-- empty result.
--
-- The replacement uses a single `INSERT ... ON CONFLICT DO UPDATE`. Rows
-- whose computed values haven't changed are still rewritten, but the
-- table is never empty mid-refresh — readers always see a consistent
-- snapshot. Person rows that should drop out (deleted in people via
-- ON DELETE CASCADE) are handled by the FK; no explicit DELETE needed.
--
-- The SELECT body matches the original verbatim aside from the wrapper.
-- Keeping it identical means existing engagement_score thresholds and
-- ranking continue to behave the same way.

CREATE OR REPLACE FUNCTION refresh_person_analytics()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO person_analytics (
    person_id, church_id,
    engagement_score, attendance_count_90d,
    first_attended_at, last_attended_at,
    total_groups, total_teams, total_contexts,
    group_attendance_rate, team_schedule_rate,
    computed_at
  )
  SELECT
    p.id,
    p.church_id,

    -- Engagement score: weighted composite (0-100). Scoring weights are
    -- intentionally unchanged from the original implementation.
    LEAST(100, ROUND(
      COALESCE(grp_stats.group_count, 0) * 10 +
      COALESCE(team_stats.team_count, 0) * 10 +
      COALESCE(att_90.att_count, 0) * 2 +
      CASE WHEN COALESCE(grp_att.rate, 0) > 0.5 THEN 10 ELSE 0 END +
      CASE WHEN COALESCE(team_sched.rate, 0) > 0.5 THEN 10 ELSE 0 END
    )) AS engagement_score,

    COALESCE(att_90.att_count, 0) AS attendance_count_90d,
    att_all.first_attended AS first_attended_at,
    att_all.last_attended AS last_attended_at,
    COALESCE(grp_stats.group_count, 0) AS total_groups,
    COALESCE(team_stats.team_count, 0) AS total_teams,
    COALESCE(grp_stats.group_count, 0) + COALESCE(team_stats.team_count, 0) AS total_contexts,
    COALESCE(grp_att.rate, 0) AS group_attendance_rate,
    COALESCE(team_sched.rate, 0) AS team_schedule_rate,
    now()

  FROM people p

  LEFT JOIN (
    SELECT person_id, COUNT(DISTINCT group_id) AS group_count
    FROM group_memberships WHERE is_active = true
    GROUP BY person_id
  ) grp_stats ON grp_stats.person_id = p.id

  LEFT JOIN (
    SELECT person_id, COUNT(DISTINCT team_id) AS team_count
    FROM team_memberships
    GROUP BY person_id
  ) team_stats ON team_stats.person_id = p.id

  LEFT JOIN (
    SELECT person_id, COUNT(*) AS att_count
    FROM group_event_attendances
    WHERE attended = true
      AND created_at >= now() - interval '90 days'
    GROUP BY person_id
  ) att_90 ON att_90.person_id = p.id

  LEFT JOIN (
    SELECT person_id,
      MIN(created_at) AS first_attended,
      MAX(created_at) AS last_attended
    FROM group_event_attendances
    WHERE attended = true
    GROUP BY person_id
  ) att_all ON att_all.person_id = p.id

  LEFT JOIN (
    SELECT
      gm.person_id,
      CASE WHEN COUNT(ge.id) > 0
        THEN ROUND(COUNT(gea.id)::numeric / COUNT(ge.id), 3)
        ELSE 0
      END AS rate
    FROM group_memberships gm
    JOIN group_events ge ON ge.group_id = gm.group_id
    LEFT JOIN group_event_attendances gea
      ON gea.event_id = ge.id AND gea.person_id = gm.person_id AND gea.attended = true
    WHERE gm.is_active = true
    GROUP BY gm.person_id
  ) grp_att ON grp_att.person_id = p.id

  LEFT JOIN (
    SELECT
      person_id,
      CASE WHEN COUNT(*) > 0
        THEN ROUND(COUNT(*) FILTER (WHERE status = 'C')::numeric / COUNT(*), 3)
        ELSE 0
      END AS rate
    FROM plan_team_members
    GROUP BY person_id
  ) team_sched ON team_sched.person_id = p.id

  ON CONFLICT (person_id) DO UPDATE SET
    church_id              = EXCLUDED.church_id,
    engagement_score       = EXCLUDED.engagement_score,
    attendance_count_90d   = EXCLUDED.attendance_count_90d,
    first_attended_at      = EXCLUDED.first_attended_at,
    last_attended_at       = EXCLUDED.last_attended_at,
    total_groups           = EXCLUDED.total_groups,
    total_teams            = EXCLUDED.total_teams,
    total_contexts         = EXCLUDED.total_contexts,
    group_attendance_rate  = EXCLUDED.group_attendance_rate,
    team_schedule_rate     = EXCLUDED.team_schedule_rate,
    computed_at            = EXCLUDED.computed_at
  WHERE
    -- Skip the UPDATE entirely if every value is unchanged. Saves WAL
    -- writes and replication bandwidth on the common case where most
    -- people's analytics drift slowly (or not at all) day to day.
    person_analytics.engagement_score      IS DISTINCT FROM EXCLUDED.engagement_score
    OR person_analytics.attendance_count_90d  IS DISTINCT FROM EXCLUDED.attendance_count_90d
    OR person_analytics.first_attended_at     IS DISTINCT FROM EXCLUDED.first_attended_at
    OR person_analytics.last_attended_at      IS DISTINCT FROM EXCLUDED.last_attended_at
    OR person_analytics.total_groups          IS DISTINCT FROM EXCLUDED.total_groups
    OR person_analytics.total_teams           IS DISTINCT FROM EXCLUDED.total_teams
    OR person_analytics.total_contexts        IS DISTINCT FROM EXCLUDED.total_contexts
    OR person_analytics.group_attendance_rate IS DISTINCT FROM EXCLUDED.group_attendance_rate
    OR person_analytics.team_schedule_rate    IS DISTINCT FROM EXCLUDED.team_schedule_rate
    OR person_analytics.church_id             IS DISTINCT FROM EXCLUDED.church_id;
END;
$$;
