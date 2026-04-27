-- Hot-path indexes for the statistics + analytics surface.
--
-- Today /api/statistics scans group_memberships and team_memberships in full
-- because the only index on those tables is the unique pco_id. The route
-- always filters by church_id and almost always by is_active, so partial
-- indexes on (church_id, is_active) WHERE is_active are the load-bearing win.
--
-- Attendance trend scans attendance_records by (church_id, checked_in_at);
-- adding an index makes the time-window slice cheap.

-- group_memberships: hot for type-aggregation, leader counts, joined/exited windows
CREATE INDEX IF NOT EXISTS idx_group_memberships_active
  ON group_memberships (church_id, group_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_group_memberships_person
  ON group_memberships (church_id, person_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_group_memberships_joined
  ON group_memberships (church_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_group_memberships_left
  ON group_memberships (church_id, left_at DESC)
  WHERE left_at IS NOT NULL;

-- team_memberships: parallel set for the teams half of the stats page
CREATE INDEX IF NOT EXISTS idx_team_memberships_active
  ON team_memberships (church_id, team_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_team_memberships_person
  ON team_memberships (church_id, person_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS idx_team_memberships_joined
  ON team_memberships (church_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_team_memberships_left
  ON team_memberships (church_id, left_at DESC)
  WHERE left_at IS NOT NULL;

-- attendance_records: time-window queries for the 12-month trend chart
CREATE INDEX IF NOT EXISTS idx_attendance_records_recent
  ON attendance_records (church_id, checked_in_at DESC);

CREATE INDEX IF NOT EXISTS idx_attendance_records_person
  ON attendance_records (church_id, person_id, checked_in_at DESC);
