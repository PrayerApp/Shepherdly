-- PCO Registrations sync
--
-- PCO's Registrations API calls these "Signups" (formerly "events").
-- 880 exist for Faith Church today; most are archived but we sync
-- everything because membership signals from old events still tell us
-- who's been active.

CREATE TABLE IF NOT EXISTS pco_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE NOT NULL,
  name text,
  description text,
  archived boolean DEFAULT false,
  open_at timestamptz,
  close_at timestamptz,
  new_registration_url text,
  pco_created_at timestamptz,
  pco_updated_at timestamptz,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE pco_signups ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pco_signups_church" ON pco_signups FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_pco_signups_church ON pco_signups(church_id);
CREATE INDEX IF NOT EXISTS idx_pco_signups_updated ON pco_signups(pco_updated_at);


CREATE TABLE IF NOT EXISTS pco_signup_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE NOT NULL,
  signup_id uuid REFERENCES pco_signups(id) ON DELETE CASCADE,
  pco_signup_id text,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id text,
  active boolean DEFAULT true,
  canceled boolean DEFAULT false,
  waitlisted boolean DEFAULT false,
  waitlisted_at timestamptz,
  registered_at timestamptz,
  pco_updated_at timestamptz,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE pco_signup_attendees ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pco_signup_attendees_church" ON pco_signup_attendees FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_pco_signup_attendees_signup ON pco_signup_attendees(signup_id);
CREATE INDEX IF NOT EXISTS idx_pco_signup_attendees_person ON pco_signup_attendees(person_id);
CREATE INDEX IF NOT EXISTS idx_pco_signup_attendees_church ON pco_signup_attendees(church_id);
CREATE INDEX IF NOT EXISTS idx_pco_signup_attendees_registered ON pco_signup_attendees(registered_at);


-- PCO Form submissions sync
--
-- One table covers any configured form. `answers` jsonb stores the
-- resolved { field_label: display_value } map so consumers don't need
-- to re-fetch form fields to decode values. For privacy-sensitive
-- forms (like Prayer Request 144568) we intentionally store null —
-- we only want to know someone submitted, not what they wrote.

CREATE TABLE IF NOT EXISTS pco_form_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pco_id text UNIQUE NOT NULL,
  form_pco_id text NOT NULL,
  form_name text,
  person_id uuid REFERENCES people(id) ON DELETE SET NULL,
  pco_person_id text,
  submitted_at timestamptz,
  verified boolean DEFAULT false,
  answers jsonb,
  pco_updated_at timestamptz,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
ALTER TABLE pco_form_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pco_form_submissions_church" ON pco_form_submissions FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_pco_form_submissions_form ON pco_form_submissions(form_pco_id);
CREATE INDEX IF NOT EXISTS idx_pco_form_submissions_person ON pco_form_submissions(person_id);
CREATE INDEX IF NOT EXISTS idx_pco_form_submissions_submitted ON pco_form_submissions(submitted_at);
CREATE INDEX IF NOT EXISTS idx_pco_form_submissions_church ON pco_form_submissions(church_id);


-- Configuration of which forms to sync. One row per form; add more
-- by inserting rows (the sync reads from here on each run). Extract
-- mode controls whether to pull and resolve form field values:
--   'none'      — only submission id + person + submitted_at (privacy)
--   'labels'    — resolve form_field labels and store { label: display_value }
COMMENT ON TABLE pco_form_submissions IS
  'One row per form submission from any configured form. answers jsonb holds resolved { field_label: display_value } for forms with extract_mode = labels, or null for privacy-first forms.';

CREATE TABLE IF NOT EXISTS pco_form_sync_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_pco_id text NOT NULL,
  label text NOT NULL,
  extract_mode text NOT NULL DEFAULT 'labels' CHECK (extract_mode IN ('none', 'labels')),
  church_id uuid REFERENCES churches(id),
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (church_id, form_pco_id)
);
ALTER TABLE pco_form_sync_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pco_form_sync_config_church" ON pco_form_sync_config FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);

-- Seed the two forms we care about today. Future forms can be added
-- via an admin UI without touching code.
INSERT INTO pco_form_sync_config (form_pco_id, label, extract_mode, church_id)
SELECT '144568', 'Network Prayer Request', 'none', id FROM churches
ON CONFLICT (church_id, form_pco_id) DO NOTHING;

INSERT INTO pco_form_sync_config (form_pco_id, label, extract_mode, church_id)
SELECT '308672', 'Serve Form', 'labels', id FROM churches
ON CONFLICT (church_id, form_pco_id) DO NOTHING;
