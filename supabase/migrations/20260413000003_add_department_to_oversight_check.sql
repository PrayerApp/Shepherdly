-- Allow 'department' as a valid context_type in tree_oversight
ALTER TABLE tree_oversight DROP CONSTRAINT IF EXISTS tree_oversight_context_type_check;
ALTER TABLE tree_oversight ADD CONSTRAINT tree_oversight_context_type_check
  CHECK (context_type IN ('group_type', 'service_type', 'department'));
