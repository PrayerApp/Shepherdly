-- Categories on /statistics were silently miscounting because the
-- route fetched person_engagement_status rows directly via PostgREST,
-- which caps responses at 1000 rows by default. With ~16k people in
-- the church, only the first 1000 made it back, all classified the
-- same, leaving 0 in the other categories.
--
-- This RPC does the GROUP BY in SQL and returns the four counts in a
-- single round-trip, no row-cap exposure.

CREATE OR REPLACE FUNCTION get_person_engagement_counts(p_church_id uuid)
RETURNS TABLE(status text, count bigint)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT status, COUNT(*)::bigint
  FROM person_engagement_status
  WHERE church_id = p_church_id
  GROUP BY status;
$$;

GRANT EXECUTE ON FUNCTION get_person_engagement_counts(uuid) TO authenticated, service_role;
