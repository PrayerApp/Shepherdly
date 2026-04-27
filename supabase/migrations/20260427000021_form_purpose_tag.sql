-- Add a `purpose` tag to pco_form_sync_config so the statistics route can
-- look up "the prayer form" (or whatever) by semantic meaning instead of
-- a hardcoded form_pco_id. This keeps the church-specific PCO form ID out
-- of application code — different churches can wire different forms to the
-- same dashboard signal.

ALTER TABLE pco_form_sync_config
  ADD COLUMN IF NOT EXISTS purpose text;

-- A church may have multiple forms tagged the same purpose (e.g. two
-- prayer-request forms). The statistics route aggregates over all of them.
CREATE INDEX IF NOT EXISTS idx_pco_form_sync_config_purpose
  ON pco_form_sync_config (church_id, purpose)
  WHERE purpose IS NOT NULL AND is_active = true;

-- Backfill: the only form referenced by code today is form_pco_id 144568,
-- the Network Prayer Request form, identified by name. Tag it 'prayer'.
UPDATE pco_form_sync_config
SET purpose = 'prayer'
WHERE form_pco_id = '144568'
  AND purpose IS NULL;
