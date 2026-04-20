// Evaluate shepherd_over_rules for a church and (re)generate the
// tree_connections they produce.
//
// Called after:
//   - Saving/deleting a shepherd-over rule
//   - save_gt_mapping (mapping changes may expose new leaders)
//   - PCO sync finish
//
// Each rule-owned connection has source_rule_id set so we can cleanly
// wipe and rebuild without touching manual or mapping-owned edges.

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function regenerateShepherdOverEdges(
  admin: any,
  churchId: string,
  opts: { onlyRuleId?: string } = {},
): Promise<{ rules: number; edges: number }> {
  let q = admin
    .from('shepherd_over_rules')
    .select('*')
    .eq('church_id', churchId)
  if (opts.onlyRuleId) q = q.eq('id', opts.onlyRuleId)
  const { data: rules } = await q
  if (!rules || rules.length === 0) return { rules: 0, edges: 0 }

  // Fetch data we need to resolve targets.
  const [
    { data: mappings },
    { data: mappingItems },
    { data: layers },
    { data: groups },
    { data: teams },
  ] = await Promise.all([
    admin.from('group_team_layer_mappings').select('id, kind, leader_layer_id, member_layer_id').eq('church_id', churchId),
    admin.from('group_team_layer_mapping_items').select('mapping_id, item_id').eq('church_id', churchId),
    admin.from('tree_layers').select('id, rank').eq('church_id', churchId),
    admin.from('groups').select('id, group_type_id').eq('church_id', churchId),
    admin.from('teams').select('id, pco_service_type_id').eq('church_id', churchId),
  ])

  // Group type names (from group_types table)
  const { data: groupTypes } = await admin.from('group_types').select('id, name').eq('church_id', churchId)
  const groupTypeNameById = new Map<string, string>((groupTypes || []).map((gt: any) => [gt.id, gt.name]))
  // Service type names (from service_types table)
  const { data: serviceTypes } = await admin.from('service_types').select('id, name').eq('church_id', churchId)
  const serviceTypeNameById = new Map<string, string>((serviceTypes || []).map((st: any) => [st.id, st.name]))

  // Build: group id -> group type name, team id -> service type name
  const groupTypeByGroupId = new Map<string, string>()
  for (const g of (groups || []) as any[]) {
    const name = groupTypeNameById.get(g.group_type_id) || 'Other'
    groupTypeByGroupId.set(g.id, name)
  }
  const serviceTypeByTeamId = new Map<string, string>()
  for (const t of (teams || []) as any[]) {
    const name = serviceTypeNameById.get(t.pco_service_type_id) || 'Other'
    serviceTypeByTeamId.set(t.id, name)
  }

  // Build mapping item lookup: mapping_id -> [item_id]
  const itemsByMapping = new Map<string, string[]>()
  for (const it of (mappingItems || []) as any[]) {
    if (!itemsByMapping.has(it.mapping_id)) itemsByMapping.set(it.mapping_id, [])
    itemsByMapping.get(it.mapping_id)!.push(it.item_id)
  }

  const leaderRe = /leader|co.?leader/i

  // Paginated fetch helper — batches both the IN clause (to avoid URL
  // length limits) and the result rows (to handle large tables).
  const fetchAll = async (table: string, fk: string, itemIds: string[]) => {
    if (itemIds.length === 0) return []
    const rows: any[] = []
    const IN_BATCH = 100  // keep IN clause well under URL limit
    const PAGE = 1000
    for (let b = 0; b < itemIds.length; b += IN_BATCH) {
      const batch = itemIds.slice(b, b + IN_BATCH)
      for (let from = 0; ; from += PAGE) {
        const { data: page } = await admin.from(table)
          .select(`person_id, ${fk}, role, is_active`)
          .eq('church_id', churchId)
          .eq('is_active', true)
          .in(fk, batch)
          .order('id')
          .range(from, from + PAGE - 1)
        if (!page || page.length === 0) break
        rows.push(...page)
        if (page.length < PAGE) break
      }
    }
    return rows
  }

  // ── Fetch memberships for ALL groups and teams, not just mapped ones ──
  const allGroupIds = [...groupTypeByGroupId.keys()]
  const allTeamIds = [...serviceTypeByTeamId.keys()]

  const [groupMemberships, teamMemberships] = await Promise.all([
    fetchAll('group_memberships', 'group_id', allGroupIds),
    fetchAll('team_memberships', 'team_id', allTeamIds),
  ])

  // ── Build leader layer lookup ──────────────────────────────────
  // For each group/team, determine which layer its leaders belong on.
  // Priority: explicit mapping > any mapping covering the same type > rule's parent layer.

  // Step 1: Build group/team -> leader_layer_id from explicit mappings
  const mappedGroupLeaderLayer = new Map<string, string>()
  const mappedTeamLeaderLayer = new Map<string, string>()
  for (const m of (mappings || []) as any[]) {
    if (!m.leader_layer_id) continue
    const items = itemsByMapping.get(m.id) || []
    if (m.kind === 'groups') {
      for (const iid of items) mappedGroupLeaderLayer.set(iid, m.leader_layer_id)
    } else {
      for (const iid of items) mappedTeamLeaderLayer.set(iid, m.leader_layer_id)
    }
  }

  // Step 2: Build group_type_name -> leader_layer_id (from any mapping of that type)
  const groupTypeLeaderLayer = new Map<string, string>()
  const teamTypeLeaderLayer = new Map<string, string>()
  for (const m of (mappings || []) as any[]) {
    if (!m.leader_layer_id) continue
    const items = itemsByMapping.get(m.id) || []
    if (m.kind === 'groups') {
      for (const iid of items) {
        const typeName = groupTypeByGroupId.get(iid)
        if (typeName && !groupTypeLeaderLayer.has(typeName)) {
          groupTypeLeaderLayer.set(typeName, m.leader_layer_id)
        }
      }
    } else {
      for (const iid of items) {
        const typeName = serviceTypeByTeamId.get(iid)
        if (typeName && !teamTypeLeaderLayer.has(typeName)) {
          teamTypeLeaderLayer.set(typeName, m.leader_layer_id)
        }
      }
    }
  }

  // Resolve leader layer for a group
  const resolveGroupLeaderLayer = (groupId: string, fallbackLayerId: string): string => {
    // 1) Explicit mapping for this group
    const explicit = mappedGroupLeaderLayer.get(groupId)
    if (explicit) return explicit
    // 2) Any mapping for groups of the same type
    const typeName = groupTypeByGroupId.get(groupId)
    if (typeName) {
      const typeLayer = groupTypeLeaderLayer.get(typeName)
      if (typeLayer) return typeLayer
    }
    // 3) Fallback
    return fallbackLayerId
  }

  const resolveTeamLeaderLayer = (teamId: string, fallbackLayerId: string): string => {
    const explicit = mappedTeamLeaderLayer.get(teamId)
    if (explicit) return explicit
    const typeName = serviceTypeByTeamId.get(teamId)
    if (typeName) {
      const typeLayer = teamTypeLeaderLayer.get(typeName)
      if (typeLayer) return typeLayer
    }
    return fallbackLayerId
  }

  // ── Build leaders by group/team (ALL groups/teams) ─────────────
  type LeaderInfo = { personId: string; layerId: string }
  const buildLeaders = (
    memberships: any[],
    fk: string,
    itemIds: string[],
    resolveLayer: (itemId: string, fallback: string) => string,
    fallbackLayerId: string,
  ) => {
    const result = new Map<string, LeaderInfo[]>()
    for (const iid of itemIds) {
      const members = memberships.filter((mm: any) => mm[fk] === iid)
      const leaders = members
        .filter((mm: any) => leaderRe.test(mm.role || ''))
        .map((mm: any) => ({
          personId: mm.person_id as string,
          layerId: resolveLayer(iid, fallbackLayerId),
        }))
      if (leaders.length > 0) {
        result.set(iid, leaders)
      }
    }
    return result
  }

  // ── Evaluate each rule ─────────────────────────────────────────
  let totalEdges = 0
  for (const rule of rules as any[]) {
    // Wipe rule-owned edges first
    await admin.from('tree_connections').delete().eq('source_rule_id', rule.id)

    const targets: { personId: string; layerId: string }[] = []
    const seen = new Set<string>()
    const add = (personId: string, layerId: string) => {
      const k = `${personId}|${layerId}`
      if (seen.has(k)) return
      if (personId === rule.parent_person_id && layerId === rule.parent_layer_id) return
      seen.add(k)
      targets.push({ personId, layerId })
    }

    if (rule.rule_type === 'group') {
      // Leaders of a specific group
      const leadersByGroup = buildLeaders(
        groupMemberships, 'group_id', [rule.rule_value],
        resolveGroupLeaderLayer, rule.parent_layer_id,
      )
      for (const l of leadersByGroup.get(rule.rule_value) || []) add(l.personId, l.layerId)

    } else if (rule.rule_type === 'team') {
      // Leaders of a specific team
      const leadersByTeam = buildLeaders(
        teamMemberships, 'team_id', [rule.rule_value],
        resolveTeamLeaderLayer, rule.parent_layer_id,
      )
      for (const l of leadersByTeam.get(rule.rule_value) || []) add(l.personId, l.layerId)

    } else if (rule.rule_type === 'group_type') {
      // Leaders of ALL groups of this type
      const groupIdsOfType = allGroupIds.filter(gid => groupTypeByGroupId.get(gid) === rule.rule_value)
      const leadersByGroup = buildLeaders(
        groupMemberships, 'group_id', groupIdsOfType,
        resolveGroupLeaderLayer, rule.parent_layer_id,
      )
      for (const [, leaders] of leadersByGroup) {
        for (const l of leaders) add(l.personId, l.layerId)
      }

    } else if (rule.rule_type === 'team_type') {
      // Leaders of ALL teams of this type
      const teamIdsOfType = allTeamIds.filter(tid => serviceTypeByTeamId.get(tid) === rule.rule_value)
      const leadersByTeam = buildLeaders(
        teamMemberships, 'team_id', teamIdsOfType,
        resolveTeamLeaderLayer, rule.parent_layer_id,
      )
      for (const [, leaders] of leadersByTeam) {
        for (const l of leaders) add(l.personId, l.layerId)
      }

    } else if (rule.rule_type === 'layer') {
      // Connect to everyone on the target layer. Gather from:
      // 1) mapping-derived people on that layer
      for (const m of (mappings || []) as any[]) {
        const layerIds = [m.leader_layer_id, m.member_layer_id].filter(Boolean)
        if (!layerIds.includes(rule.rule_value)) continue
        const items = itemsByMapping.get(m.id) || []
        const memberships = m.kind === 'groups' ? groupMemberships : teamMemberships
        const fk = m.kind === 'groups' ? 'group_id' : 'team_id'
        const isLeaderLayer = rule.rule_value === m.leader_layer_id
        for (const iid of items) {
          const members = memberships.filter((mm: any) => mm[fk] === iid)
          for (const mm of members) {
            const isLeader = leaderRe.test(mm.role || '')
            if (isLeader && isLeaderLayer) add(mm.person_id, rule.rule_value)
            if (!isLeader && !isLeaderLayer) add(mm.person_id, rule.rule_value)
          }
        }
      }
      // 2) Manual inclusions on that layer
      const { data: inclusions } = await admin
        .from('tree_layer_inclusions')
        .select('person_id')
        .eq('church_id', churchId)
        .eq('layer_id', rule.rule_value)
      for (const inc of (inclusions || []) as any[]) {
        add(inc.person_id, rule.rule_value)
      }
    }

    if (targets.length > 0) {
      const edges = targets.map(t => ({
        parent_person_id: rule.parent_person_id,
        parent_layer_id: rule.parent_layer_id,
        child_person_id: t.personId,
        child_layer_id: t.layerId,
        church_id: churchId,
        source_rule_id: rule.id,
      }))
      for (let i = 0; i < edges.length; i += 500) {
        await admin.from('tree_connections').insert(edges.slice(i, i + 500))
      }
      totalEdges += edges.length
    }
  }

  return { rules: rules.length, edges: totalEdges }
}
