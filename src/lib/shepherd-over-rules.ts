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

  // Build: for each group/team, find the leader layer from its mapping
  // and the leaders (from membership data).
  const leaderRe = /leader|co.?leader/i

  // Fetch all group + team memberships (paginated)
  const fetchAll = async (table: string, fk: string, itemIds: string[]) => {
    if (itemIds.length === 0) return []
    const rows: any[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data: page } = await admin.from(table)
        .select(`person_id, ${fk}, role, is_active`)
        .eq('church_id', churchId)
        .eq('is_active', true)
        .in(fk, itemIds)
        .order('id')
        .range(from, from + PAGE - 1)
      if (!page || page.length === 0) break
      rows.push(...page)
      if (page.length < PAGE) break
    }
    return rows
  }

  // Collect all group/team IDs that are in any mapping
  const allGroupIds = new Set<string>()
  const allTeamIds = new Set<string>()
  for (const m of (mappings || []) as any[]) {
    const items = itemsByMapping.get(m.id) || []
    if (m.kind === 'groups') items.forEach((id: string) => allGroupIds.add(id))
    else items.forEach((id: string) => allTeamIds.add(id))
  }

  const [groupMemberships, teamMemberships] = await Promise.all([
    fetchAll('group_memberships', 'group_id', [...allGroupIds]),
    fetchAll('team_memberships', 'team_id', [...allTeamIds]),
  ])

  // Build: group/team id -> { leaders: [{personId, layerId}] }
  type LeaderInfo = { personId: string; layerId: string }
  const leadersByGroupId = new Map<string, LeaderInfo[]>()
  const leadersByTeamId = new Map<string, LeaderInfo[]>()

  for (const m of (mappings || []) as any[]) {
    if (!m.leader_layer_id) continue
    const items = itemsByMapping.get(m.id) || []
    const memberships = m.kind === 'groups' ? groupMemberships : teamMemberships
    const fk = m.kind === 'groups' ? 'group_id' : 'team_id'
    const targetMap = m.kind === 'groups' ? leadersByGroupId : leadersByTeamId

    for (const iid of items) {
      const members = memberships.filter((mm: any) => mm[fk] === iid)
      const leaders = members
        .filter((mm: any) => leaderRe.test(mm.role || ''))
        .map((mm: any) => ({ personId: mm.person_id as string, layerId: m.leader_layer_id as string }))
      if (leaders.length > 0) {
        if (!targetMap.has(iid)) targetMap.set(iid, [])
        targetMap.get(iid)!.push(...leaders)
      }
    }
  }

  // People by layer (for 'layer' rule type) — fetch from tree_layer_inclusions
  // plus mapping-derived + list-derived. Simplified: just get all card keys from
  // the connections + inclusions. Actually, the simplest: use the same peopleByLayer
  // that the tree GET endpoint builds. But we don't have that here. Instead, let's
  // gather people per layer from the available data sources.
  // For the 'layer' rule type, we'll collect all people who would appear on that layer.

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
      const leaders = leadersByGroupId.get(rule.rule_value) || []
      for (const l of leaders) add(l.personId, l.layerId)
    } else if (rule.rule_type === 'team') {
      const leaders = leadersByTeamId.get(rule.rule_value) || []
      for (const l of leaders) add(l.personId, l.layerId)
    } else if (rule.rule_type === 'group_type') {
      // Find all groups of this type, then their leaders
      for (const [gid, typeName] of groupTypeByGroupId) {
        if (typeName === rule.rule_value) {
          const leaders = leadersByGroupId.get(gid) || []
          for (const l of leaders) add(l.personId, l.layerId)
        }
      }
    } else if (rule.rule_type === 'team_type') {
      for (const [tid, typeName] of serviceTypeByTeamId) {
        if (typeName === rule.rule_value) {
          const leaders = leadersByTeamId.get(tid) || []
          for (const l of leaders) add(l.personId, l.layerId)
        }
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
