-- View: shepherding_connections
--
-- Unified, always-live projection of "who is placed on which tree layer,
-- and why." Every placement source (PCO list link, manual inclusion,
-- group/team mapping, explicit tree_connection as parent OR child)
-- contributes rows. Consumers — /api/statistics, /api/people's flock
-- layer lookup, and future tree refactors — can query ONE object
-- instead of reconstructing placement logic client-side.
--
-- Not materialized: Postgres resolves each query against the live base
-- tables, so there's no cache to invalidate when an admin edits
-- connections or inclusions from the UI. Base-table RLS applies via
-- SECURITY INVOKER, so callers see only their own church.
--
-- Same person + layer may appear multiple times if they arrive through
-- multiple sources (e.g. a PCO list AND a mapping). Consumers dedupe
-- according to their needs — the "highest-layer" rule in the tree UI,
-- or simple DISTINCT (person_id, layer_id) for stats headcounts.

CREATE OR REPLACE VIEW shepherding_connections
  WITH (security_invoker = true)
AS
  -- 1) PCO list → layer link
  SELECT
    p.church_id,
    lp.person_id,
    ll.layer_id,
    'pco_list'::text          AS source_kind,
    ll.id::text               AS source_id,
    'primary'::text           AS context_kind,
    NULL::uuid                AS context_id,
    FALSE                     AS is_leader
  FROM pco_list_people lp
  JOIN pco_list_layer_links ll
    ON ll.list_id  = lp.list_id
   AND ll.church_id = lp.church_id
  JOIN people p
    ON p.id        = lp.person_id
   AND p.church_id = lp.church_id

  UNION ALL

  -- 2) Manual inclusions
  SELECT
    i.church_id,
    i.person_id,
    i.layer_id,
    'inclusion'::text,
    i.id::text,
    'primary'::text,
    NULL::uuid,
    FALSE
  FROM tree_layer_inclusions i

  UNION ALL

  -- 3a) Group mapping — leaders
  SELECT
    m.church_id,
    gm.person_id,
    m.leader_layer_id       AS layer_id,
    'group_mapping_leader'::text,
    m.id::text,
    'group'::text,
    gm.group_id             AS context_id,
    TRUE
  FROM group_memberships gm
  JOIN group_team_layer_mapping_items mi
    ON mi.item_id  = gm.group_id
   AND mi.church_id = gm.church_id
  JOIN group_team_layer_mappings m
    ON m.id        = mi.mapping_id
   AND m.church_id = gm.church_id
  WHERE m.kind = 'groups'
    AND m.leader_layer_id IS NOT NULL
    AND gm.is_active = TRUE
    AND gm.role ~* 'leader'

  UNION ALL

  -- 3b) Group mapping — members
  SELECT
    m.church_id,
    gm.person_id,
    m.member_layer_id,
    'group_mapping_member'::text,
    m.id::text,
    'group'::text,
    gm.group_id,
    FALSE
  FROM group_memberships gm
  JOIN group_team_layer_mapping_items mi
    ON mi.item_id  = gm.group_id
   AND mi.church_id = gm.church_id
  JOIN group_team_layer_mappings m
    ON m.id        = mi.mapping_id
   AND m.church_id = gm.church_id
  WHERE m.kind = 'groups'
    AND m.member_layer_id IS NOT NULL
    AND gm.is_active = TRUE
    AND (gm.role IS NULL OR gm.role !~* 'leader')

  UNION ALL

  -- 4a) Team mapping — leaders
  SELECT
    m.church_id,
    tm.person_id,
    m.leader_layer_id,
    'team_mapping_leader'::text,
    m.id::text,
    'team'::text,
    tm.team_id,
    TRUE
  FROM team_memberships tm
  JOIN group_team_layer_mapping_items mi
    ON mi.item_id  = tm.team_id
   AND mi.church_id = tm.church_id
  JOIN group_team_layer_mappings m
    ON m.id        = mi.mapping_id
   AND m.church_id = tm.church_id
  WHERE m.kind = 'teams'
    AND m.leader_layer_id IS NOT NULL
    AND tm.is_active = TRUE
    AND tm.role ~* 'leader'

  UNION ALL

  -- 4b) Team mapping — members
  SELECT
    m.church_id,
    tm.person_id,
    m.member_layer_id,
    'team_mapping_member'::text,
    m.id::text,
    'team'::text,
    tm.team_id,
    FALSE
  FROM team_memberships tm
  JOIN group_team_layer_mapping_items mi
    ON mi.item_id  = tm.team_id
   AND mi.church_id = tm.church_id
  JOIN group_team_layer_mappings m
    ON m.id        = mi.mapping_id
   AND m.church_id = tm.church_id
  WHERE m.kind = 'teams'
    AND m.member_layer_id IS NOT NULL
    AND tm.is_active = TRUE
    AND (tm.role IS NULL OR tm.role !~* 'leader')

  UNION ALL

  -- 5) Explicit tree_connection — parent appears on parent_layer.
  -- Captures shepherd-over rules and manually drawn edges; the parent
  -- isn't necessarily in any of the above sources (e.g. Dan overseeing
  -- Small Group leaders via a rule, without being on a PCO list).
  SELECT
    tc.church_id,
    tc.parent_person_id,
    tc.parent_layer_id,
    'connection_parent'::text,
    tc.id::text,
    'primary'::text,
    NULL::uuid,
    TRUE
  FROM tree_connections tc

  UNION ALL

  -- 6) Explicit tree_connection — child appears on child_layer.
  -- Connection-derived placements intentionally bypass the highest-
  -- layer dedup in the tree UI, so consumers that care about dedup
  -- need to handle these distinctly from sources 1-4.
  SELECT
    tc.church_id,
    tc.child_person_id,
    tc.child_layer_id,
    'connection_child'::text,
    tc.id::text,
    CASE
      WHEN tc.context_group_id IS NOT NULL THEN 'group'
      WHEN tc.context_team_id  IS NOT NULL THEN 'team'
      ELSE 'primary'
    END,
    COALESCE(tc.context_group_id, tc.context_team_id),
    FALSE
  FROM tree_connections tc;


COMMENT ON VIEW shepherding_connections IS
  'Always-live placement of (person, layer) with source kind & context. Every row represents one reason a person is on a layer. Consumers dedupe per their own rules.';
