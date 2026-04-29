-- Calculated active/inactive person flag.
--
-- Distinct from people.status (PCO membership type) and the
-- membership-level is_active. This is a derived person-level flag.
--
-- A person is "calculated active" if any of:
--   1. last_pco_activity_at >= now() - threshold_months
--   2. pco_created_at >= now() - threshold_months   (recently added)
--   3. is_child = false adult in same household has rule 1 or 2
--      (rule 3 only checks rules 1-2 on other adults — not their own
--      rule 3 — so no recursion. A household where every adult is
--      under the line falls inactive together; one active adult keeps
--      everyone in the household active, kids included.)
--
-- "PCO activity" = MAX timestamp across:
--   - group_event_attendances.attended (event date)
--   - plan_team_members status='C' (plan sort_date)
--   - pco_form_submissions.submitted_at
--   - pco_signup_attendees.registered_at (active or waitlisted, not canceled)
--   - attendance_records.checked_in_at as the person
--   - attendance_records.checked_in_at as the guardian (checked_in_by)
--
-- Threshold lives in app_settings.calculated_inactive_threshold_months,
-- default 18. Refreshed by the cron after every sync.

ALTER TABLE people
  ADD COLUMN IF NOT EXISTS is_child boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS household_pco_id text,
  ADD COLUMN IF NOT EXISTS pco_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_pco_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_calculated_active boolean DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_people_calc_active
  ON people (church_id, is_calculated_active);
CREATE INDEX IF NOT EXISTS idx_people_household_pco_id
  ON people (church_id, household_pco_id) WHERE household_pco_id IS NOT NULL;

-- Add attendance_records.checked_in_by_person_id so guardian check-ins
-- count as activity for the parent.
ALTER TABLE attendance_records
  ADD COLUMN IF NOT EXISTS checked_in_by_person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS pco_checked_in_by_person_id text;

CREATE INDEX IF NOT EXISTS idx_attendance_checked_in_by
  ON attendance_records (church_id, checked_in_by_person_id, checked_in_at DESC)
  WHERE checked_in_by_person_id IS NOT NULL;

-- Default app_setting (insert if missing). app_settings is a (key, value)
-- table — the cron reads pco_sync_enabled the same way.
INSERT INTO app_settings (key, value)
VALUES ('calculated_inactive_threshold_months', '18')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION refresh_calculated_active(
  p_threshold_months int DEFAULT NULL
)
RETURNS TABLE(active_count bigint, inactive_count bigint)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_threshold int;
  v_cutoff timestamptz;
BEGIN
  -- Resolve threshold. Caller wins; otherwise app_settings; otherwise 18.
  IF p_threshold_months IS NULL THEN
    SELECT NULLIF(value, '')::int
      INTO v_threshold
      FROM app_settings
     WHERE key = 'calculated_inactive_threshold_months'
     LIMIT 1;
  ELSE
    v_threshold := p_threshold_months;
  END IF;
  IF v_threshold IS NULL OR v_threshold <= 0 THEN v_threshold := 18; END IF;
  v_cutoff := now() - make_interval(months => v_threshold);

  -- Step 1: Refresh last_pco_activity_at as the MAX timestamp across
  -- every signal. Rebuilt from scratch each call so removed signals
  -- correctly reset the column.
  WITH activity AS (
    SELECT person_id, max_at FROM (
      SELECT gea.person_id, MAX(ge.starts_at) AS max_at
        FROM group_event_attendances gea
        JOIN group_events ge ON ge.id = gea.event_id
       WHERE gea.attended = true AND ge.starts_at IS NOT NULL
       GROUP BY gea.person_id
      UNION ALL
      SELECT ptm.person_id, MAX(sp.sort_date) AS max_at
        FROM plan_team_members ptm
        JOIN service_plans sp ON sp.id = ptm.plan_id
       WHERE ptm.status = 'C' AND sp.sort_date IS NOT NULL
       GROUP BY ptm.person_id
      UNION ALL
      SELECT pfs.person_id, MAX(pfs.submitted_at) AS max_at
        FROM pco_form_submissions pfs
       WHERE pfs.person_id IS NOT NULL AND pfs.submitted_at IS NOT NULL
       GROUP BY pfs.person_id
      UNION ALL
      SELECT psa.person_id, MAX(psa.registered_at) AS max_at
        FROM pco_signup_attendees psa
       WHERE psa.person_id IS NOT NULL
         AND COALESCE(psa.canceled, false) = false
         AND (psa.active IS true OR psa.waitlisted IS true)
         AND psa.registered_at IS NOT NULL
       GROUP BY psa.person_id
      UNION ALL
      SELECT ar.person_id, MAX(ar.checked_in_at) AS max_at
        FROM attendance_records ar
       WHERE ar.person_id IS NOT NULL AND ar.checked_in_at IS NOT NULL
       GROUP BY ar.person_id
      UNION ALL
      SELECT ar.checked_in_by_person_id AS person_id, MAX(ar.checked_in_at) AS max_at
        FROM attendance_records ar
       WHERE ar.checked_in_by_person_id IS NOT NULL AND ar.checked_in_at IS NOT NULL
       GROUP BY ar.checked_in_by_person_id
    ) signals
    WHERE person_id IS NOT NULL
  ),
  per_person AS (
    SELECT person_id, MAX(max_at) AS last_at
      FROM activity
     GROUP BY person_id
  )
  UPDATE people p
     SET last_pco_activity_at = pp.last_at
    FROM per_person pp
   WHERE pp.person_id = p.id
     AND p.last_pco_activity_at IS DISTINCT FROM pp.last_at;

  -- People who used to have a signal and don't anymore: reset to NULL.
  UPDATE people p
     SET last_pco_activity_at = NULL
   WHERE p.last_pco_activity_at IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM (
         SELECT gea.person_id FROM group_event_attendances gea
          WHERE gea.attended = true
         UNION
         SELECT ptm.person_id FROM plan_team_members ptm
          WHERE ptm.status = 'C'
         UNION
         SELECT pfs.person_id FROM pco_form_submissions pfs
          WHERE pfs.person_id IS NOT NULL
         UNION
         SELECT psa.person_id FROM pco_signup_attendees psa
          WHERE psa.person_id IS NOT NULL
            AND COALESCE(psa.canceled, false) = false
            AND (psa.active IS true OR psa.waitlisted IS true)
         UNION
         SELECT ar.person_id FROM attendance_records ar
          WHERE ar.person_id IS NOT NULL
         UNION
         SELECT ar.checked_in_by_person_id FROM attendance_records ar
          WHERE ar.checked_in_by_person_id IS NOT NULL
       ) all_pids
       WHERE all_pids.person_id = p.id
     );

  -- Step 2: Compute is_calculated_active.
  -- active_self = own activity recent OR own PCO record recent
  -- household_active = any adult in same household has active_self
  WITH active_self AS (
    SELECT
      p.id,
      p.church_id,
      p.household_pco_id,
      p.is_child,
      (
        COALESCE(p.last_pco_activity_at, '-infinity'::timestamptz) >= v_cutoff
        OR COALESCE(p.pco_created_at,    '-infinity'::timestamptz) >= v_cutoff
      ) AS is_active_self
    FROM people p
  ),
  household_active AS (
    SELECT
      a.church_id,
      a.household_pco_id,
      bool_or(a.is_active_self) AS has_active_adult
    FROM active_self a
    WHERE a.is_child = false
      AND a.household_pco_id IS NOT NULL
    GROUP BY a.church_id, a.household_pco_id
  )
  UPDATE people p
     SET is_calculated_active = (
       COALESCE(asf.is_active_self, false)
       OR COALESCE(ha.has_active_adult, false)
     )
    FROM active_self asf
    LEFT JOIN household_active ha
      ON ha.church_id = asf.church_id
     AND ha.household_pco_id = asf.household_pco_id
   WHERE p.id = asf.id
     AND p.is_calculated_active IS DISTINCT FROM (
       COALESCE(asf.is_active_self, false)
       OR COALESCE(ha.has_active_adult, false)
     );

  RETURN QUERY
  SELECT
    (SELECT count(*) FROM people WHERE is_calculated_active = true),
    (SELECT count(*) FROM people WHERE is_calculated_active = false);
END;
$$;

GRANT EXECUTE ON FUNCTION refresh_calculated_active(int) TO service_role;

-- Initial backfill. is_child / household_pco_id / pco_created_at are
-- still null until the next PCO sync mapper runs, so on first apply
-- this will mostly mark people active by their last_pco_activity_at.
-- The cron will recompute correctly after the next nightly sync.
SELECT refresh_calculated_active();
