import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

type LayerLite = { id: string; name: string; rank: number; color: string | null }

// Build a personId → primary-layer-id map by walking the same placement
// sources that drive the Shepherd Tree. The "primary" layer is the
// lowest-rank (highest-in-tree) layer they appear on via PCO lists,
// manual inclusions, or group/team mappings. Mirrors the client's
// `highestLayerByPersonCtx` logic in ShepherdTreeV2, just flattened
// to one layer per person instead of one per (person, context).
async function computePrimaryLayerMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  churchId: string,
  personIds: string[],
  layers: LayerLite[],
): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map()
  const rankOf = new Map(layers.map(l => [l.id, l.rank]))
  const byPerson = new Map<string, Set<string>>()
  const add = (pid: string, lid: string) => {
    if (!byPerson.has(pid)) byPerson.set(pid, new Set())
    byPerson.get(pid)!.add(lid)
  }

  // PCO list → layer
  const { data: listLinks } = await supabase
    .from('pco_list_layer_links')
    .select('list_id, layer_id')
    .eq('church_id', churchId)
  if (listLinks && listLinks.length > 0) {
    const listIds = [...new Set(listLinks.map((l: { list_id: string }) => l.list_id))]
    const { data: listPeople } = await supabase
      .from('pco_list_people')
      .select('list_id, person_id')
      .eq('church_id', churchId)
      .in('list_id', listIds)
      .in('person_id', personIds)
    const layerByList = new Map<string, string[]>()
    for (const link of listLinks) {
      if (!layerByList.has(link.list_id)) layerByList.set(link.list_id, [])
      layerByList.get(link.list_id)!.push(link.layer_id)
    }
    for (const lp of listPeople || []) {
      for (const lid of layerByList.get(lp.list_id) || []) add(lp.person_id, lid)
    }
  }

  // Manual inclusions
  const { data: inclusions } = await supabase
    .from('tree_layer_inclusions')
    .select('person_id, layer_id')
    .eq('church_id', churchId)
    .in('person_id', personIds)
  for (const inc of inclusions || []) add(inc.person_id, inc.layer_id)

  // Group/team mappings (leader + member layers). Items store the group
  // or team id; memberships then reveal who's a leader vs member.
  const { data: mappings } = await supabase
    .from('group_team_layer_mappings')
    .select('id, kind, leader_layer_id, member_layer_id')
    .eq('church_id', churchId)
  if (mappings && mappings.length > 0) {
    const mappingIds = mappings.map((m: { id: string }) => m.id)
    const { data: items } = await supabase
      .from('group_team_layer_mapping_items')
      .select('mapping_id, item_id')
      .in('mapping_id', mappingIds)
    const itemsByMapping = new Map<string, string[]>()
    for (const it of items || []) {
      if (!itemsByMapping.has(it.mapping_id)) itemsByMapping.set(it.mapping_id, [])
      itemsByMapping.get(it.mapping_id)!.push(it.item_id)
    }
    for (const m of mappings) {
      const itemIds = itemsByMapping.get(m.id) || []
      if (itemIds.length === 0) continue
      const table = m.kind === 'groups' ? 'group_memberships' : 'team_memberships'
      const fkey = m.kind === 'groups' ? 'group_id' : 'team_id'
      const { data: memberships } = await supabase
        .from(table)
        .select(`person_id, role, ${fkey}`)
        .in(fkey, itemIds)
        .in('person_id', personIds)
      for (const row of memberships || []) {
        const role = (row.role || '').toLowerCase()
        const isLeader = /leader|co.?leader/.test(role)
        const lid = isLeader ? m.leader_layer_id : m.member_layer_id
        if (lid) add(row.person_id, lid)
      }
    }
  }

  // Pick the lowest-rank (highest-in-tree) layer for each person.
  const primary = new Map<string, string>()
  for (const [pid, lids] of byPerson) {
    let bestLid: string | null = null
    let bestRank = Infinity
    for (const lid of lids) {
      const r = rankOf.get(lid)
      if (r == null) continue
      if (r < bestRank) { bestRank = r; bestLid = lid }
    }
    if (bestLid) primary.set(pid, bestLid)
  }
  return primary
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role, name, church_id')
    .eq('user_id', user.id)
    .single()

  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const search = params.get('search') || ''
  const sort = params.get('sort') || 'name'
  const showAll = params.get('all') === 'true' && ['super_admin', 'staff'].includes(appUser.role)

  let query = supabase
    .from('people')
    .select(`
      *,
      analytics:person_analytics(engagement_score, attendance_count_90d, last_attended_at, total_groups, total_teams, group_attendance_rate),
      groups:group_memberships(group_id, role, groups(id, name)),
      teams:team_memberships(team_id, role, teams(id, name))
    `)
    .eq('church_id', appUser.church_id!)
    .eq('status', 'active')
    .not('name', 'like', '\\_%')
    .not('name', 'like', '-%')
    .neq('membership_type', 'SYSTEM USE - Do Not Delete')

  if (!showAll) {
    // Find current user's people record
    const { data: myPerson } = await supabase
      .from('people')
      .select('id')
      .eq('is_leader', true)
      .eq('church_id', appUser.church_id!)
      .ilike('name', appUser.name || '')
      .limit(1)
      .single()

    if (myPerson) {
      // Get person IDs this user shepherds
      const { data: relationships } = await supabase
        .from('shepherding_relationships')
        .select('person_id')
        .eq('shepherd_id', myPerson.id)
        .eq('is_active', true)

      const personIds = relationships?.map(r => r.person_id) || []
      if (personIds.length === 0) {
        return NextResponse.json({ people: [], myPersonId: myPerson.id })
      }
      query = query.in('id', personIds)
    } else {
      return NextResponse.json({ people: [], myPersonId: null })
    }
  }

  if (search) {
    query = query.ilike('name', `%${search}%`)
  }

  if (sort === 'engagement') {
    query = query.order('name') // sort client-side from analytics join
  } else if (sort === 'attendance') {
    query = query.order('name')
  } else {
    query = query.order('name')
  }

  const { data: people, error } = await query.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Client-side sort for analytics-based sorts
  let sorted = people || []
  if (sort === 'engagement') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sorted = sorted.sort((a: any, b: any) => {
      const aScore = a.analytics?.[0]?.engagement_score ?? -1
      const bScore = b.analytics?.[0]?.engagement_score ?? -1
      return bScore - aScore
    })
  } else if (sort === 'attendance') {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sorted = sorted.sort((a: any, b: any) => {
      const aDate = a.analytics?.[0]?.last_attended_at || ''
      const bDate = b.analytics?.[0]?.last_attended_at || ''
      return bDate.localeCompare(aDate)
    })
  }

  // Attach each person's primary (highest-in-tree) layer so the UI can
  // group the flock by layer. Layers are returned too so the client can
  // render section headers in rank order without a second fetch.
  const { data: layerRows } = await supabase
    .from('tree_layers')
    .select('id, name, rank, color')
    .eq('church_id', appUser.church_id!)
    .order('rank')
  const layers: LayerLite[] = (layerRows || []) as LayerLite[]
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const personIds = sorted.map((p: any) => p.id)
  const primaryLayerMap = await computePrimaryLayerMap(
    supabase, appUser.church_id!, personIds, layers,
  )
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const enriched = sorted.map((p: any) => ({
    ...p,
    layerId: primaryLayerMap.get(p.id) || null,
  }))

  return NextResponse.json({ people: enriched, layers })
}
