-- One-time backfill: sweep memberships with the 6-month threshold.
--
-- Migration 27 introduced refresh_membership_activity() and
-- mark_inactive_by_activity(p_inactive_days, p_grace_days) with a
-- 365-day default. Product call has shifted to "6 months without
-- activity = off the team / out of the group." The cron is updated
-- separately (src/app/api/cron/pco-sync/route.ts) to pass 180; this
-- migration runs the sweep once now so existing rows reflect the new
-- threshold without waiting for the next nightly cron.
--
-- Both functions are idempotent — re-running yields no further change
-- once last_activity_at is up to date and stale rows are closed out.

SELECT refresh_membership_activity();
SELECT mark_inactive_by_activity(180, 90);
