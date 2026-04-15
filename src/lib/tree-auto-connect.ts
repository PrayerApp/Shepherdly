// Regenerate mapping-owned tree_connections for a church.
//
// For every group_team_layer_mappings row with auto_connect = true in the
// given church, wipes its previously-owned tree_connections
// (source_mapping_id = mapping.id) and re-creates one edge per
// (leader, member) pair found in that mapping's selected groups/teams.
//
// Safe to call from any post-sync hook or from save_gt_mapping. Manual
// connections (source_mapping_id IS NULL) are never touched.

/* eslint-disable @typescript-eslint/no-explicit-any */

export async function regenerateAutoConnectEdgesForChurch(
  admin: any,
  churchId: string,
  opts: { onlyMappingId?: string } = {},
): Promise<{ mappings: number; edges: number }> {
  let q = admin
    .from('group_team_layer_mappings')
    .select('id, kind, leader_layer_id, member_layer_id, auto_connect')
    .eq('church_id', churchId)
    .eq('auto_connect', true)
  if (opts.onlyMappingId) q = q.eq('id', opts.onlyMappingId)
  const { data: mappings } = await q

  if (!mappings || mappings.length === 0) return { mappings: 0, edges: 0 }

  // Layer rank lookup (to guard against inverted pairs)
  const { data: layers } = await admin
    .from('tree_layers').select('id, rank').eq('church_id', churchId)
  const rankMap = new Map<string, number>((layers || []).map((l: any) => [l.id as string, l.rank as number]))

  let totalEdges = 0
  for (const m of mappings) {
    // Always wipe mapping-owned edges first so toggles/item changes
    // picked up elsewhere stay in sync.
    await admin.from('tree_connections').delete().eq('source_mapping_id', m.id)

    if (!m.leader_layer_id || !m.member_layer_id) continue
    const lRank = rankMap.get(m.leader_layer_id)
    const mRank = rankMap.get(m.member_layer_id)
    if (lRank === undefined || mRank === undefined || lRank >= mRank) continue

    const { data: items } = await admin
      .from('group_team_layer_mapping_items')
      .select('item_id').eq('mapping_id', m.id).eq('church_id', churchId)
    const itemIds: string[] = (items || []).map((i: any) => i.item_id as string)
    if (itemIds.length === 0) continue

    const table = m.kind === 'groups' ? 'group_memberships' : 'team_memberships'
    const fk = m.kind === 'groups' ? 'group_id' : 'team_id'
    // Paginate — PostgREST caps single responses well below our needs for
    // large groups/teams, and .range() alone doesn't raise that ceiling.
    const memberships: any[] = []
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
      memberships.push(...page)
      if (page.length < PAGE) break
    }

    const byItem = new Map<string, { person_id: string; role: string | null }[]>()
    for (const row of (memberships || []) as any[]) {
      const iid = row[fk] as string
      if (!byItem.has(iid)) byItem.set(iid, [])
      byItem.get(iid)!.push({ person_id: row.person_id, role: row.role })
    }

    const leaderRe = /leader|co.?leader/i
    const edges: any[] = []
    // Dedupe per (leader, member, context) so the same membership doesn't
    // create duplicate edges, but DIFFERENT memberships (e.g. same pair in
    // two groups) now do create separate edges — one per group/team.
    const seen = new Set<string>()
    for (const [itemId, rows] of byItem) {
      const leaders = rows.filter(r => leaderRe.test(r.role || '')).map(r => r.person_id)
      const members = rows.filter(r => !leaderRe.test(r.role || '')).map(r => r.person_id)
      if (leaders.length === 0 || members.length === 0) continue
      for (const lid of leaders) {
        for (const mid of members) {
          if (lid === mid) continue
          const k = `${lid}|${mid}|${m.kind}|${itemId}`
          if (seen.has(k)) continue
          seen.add(k)
          edges.push({
            parent_person_id: lid,
            parent_layer_id: m.leader_layer_id,
            child_person_id: mid,
            child_layer_id: m.member_layer_id,
            church_id: churchId,
            source_mapping_id: m.id,
            context_group_id: m.kind === 'groups' ? itemId : null,
            context_team_id: m.kind === 'teams' ? itemId : null,
          })
        }
      }
    }

    // The 4-tuple uniqueness was dropped in the 20260416 migration so
    // multiple edges per pair (one per context) can coexist. Plain insert
    // works since we wiped mapping-owned edges up-front; any remaining
    // manual-edge conflicts are extremely rare (different context values).
    for (let i = 0; i < edges.length; i += 500) {
      const chunk = edges.slice(i, i + 500)
      await admin.from('tree_connections').insert(chunk)
    }
    totalEdges += edges.length
  }

  return { mappings: mappings.length, edges: totalEdges }
}
