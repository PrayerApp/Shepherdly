-- Ministry Impact Reports table
CREATE TABLE IF NOT EXISTS ministry_impact_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id uuid REFERENCES churches(id),
  title text NOT NULL,
  reporting_period_start date,
  reporting_period_end date,
  metrics jsonb DEFAULT '{}',
  narrative text,
  outcomes text,
  created_by uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS
ALTER TABLE ministry_impact_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY ministry_impact_reports_church_policy ON ministry_impact_reports
  FOR ALL USING (
    church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
  );

-- Updated_at trigger
CREATE TRIGGER set_updated_at BEFORE UPDATE ON ministry_impact_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_mir_church_id ON ministry_impact_reports(church_id);
CREATE INDEX IF NOT EXISTS idx_mir_status ON ministry_impact_reports(status);
