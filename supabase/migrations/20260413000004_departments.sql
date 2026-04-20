-- Departments: admin-created tags for organizing staff
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text DEFAULT '#6b7280',
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now()
);
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "departments_church" ON departments FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);

-- Department members: which people are in which department
CREATE TABLE IF NOT EXISTS department_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid REFERENCES departments(id) ON DELETE CASCADE,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  church_id uuid REFERENCES churches(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(department_id, person_id)
);
ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "department_members_church" ON department_members FOR ALL USING (
  church_id IN (SELECT church_id FROM users WHERE user_id = auth.uid())
);
CREATE INDEX IF NOT EXISTS idx_dept_members_dept ON department_members(department_id);
CREATE INDEX IF NOT EXISTS idx_dept_members_person ON department_members(person_id);
