import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

type LayerLite = { id: string; name: string; rank: number; color: string | null }

// Build a personId → primary-layer-id map from `shepherding_connections`,
// the always-live unified placement view. "Primary" = the lowest-rank
// (highest-in-tree) layer the person appears on via an explicit
// placement source (PCO list, manual inclusion, group/team mapping).
// Connection-derived rows are excluded so we match the tree UI's
// highest-layer dedup — a shepherd-over rule placing someone on a
// lower layer shouldn't override their "home" layer when we group
// the flock list.
async function computePrimaryLayerMap(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  churchId: string,
  personIds: string[],
  layers: LayerLite[],
): Promise<Map<string, string>> {
  if (personIds.length === 0) return new Map()
  const rankOf = new Map(layers.map(l => [l.id, l.rank]))

  const { data: placements } = await supabase
    .from('shepherding_connections')
    .select('person_id, layer_id')
    .eq('church_id', churchId)
    .in('person_id', personIds)
    .not('source_kind', 'in', '(connection_parent,connection_child)')

  const primary = new Map<string, string>()
  const bestRank = new Map<string, number>()
  for (const p of (placements || []) as { person_id: string; layer_id: string }[]) {
    const r = rankOf.get(p.layer_id)
    if (r == null) continue
    const cur = bestRank.get(p.person_id)
    if (cur == null || r < cur) {
      bestRank.set(p.person_id, r)
      primary.set(p.person_id, p.layer_id)
    }
  }
  return primary
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role, name, church_id, person_id')
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
    // Resolve the user's person record. `users.person_id` is the
    // authoritative link (set during invite/onboarding). Fall back to
    // a case-insensitive name match only if that FK isn't set — name
    // matching breaks the moment the user changes their display name
    // (e.g. sets it to "Admin" like our seed data does).
    let myPersonId: string | null = appUser.person_id || null
    if (!myPersonId) {
      const { data: myPerson } = await supabase
        .from('people')
        .select('id')
        .eq('is_leader', true)
        .eq('church_id', appUser.church_id!)
        .ilike('name', appUser.name || '')
        .limit(1)
        .maybeSingle()
      myPersonId = myPerson?.id || null
    }

    if (myPersonId) {
      // People this user shepherds via direct 1:1 assignments.
      const { data: relationships } = await supabase
        .from('shepherding_relationships')
        .select('person_id')
        .eq('shepherd_id', myPersonId)
        .eq('is_active', true)
      const directFlock = new Set((relationships || []).map(r => r.person_id))

      // People this user shepherds via tree_connections (shepherd-over
      // rules, auto-connect from group/team mappings, and manual edges).
      // Without this union, flock members who are only linked through
      // the tree don't show up here even though the tree clearly says
      // they're under this person's care.
      const { data: childConns } = await supabase
        .from('tree_connections')
        .select('child_person_id')
        .eq('church_id', appUser.church_id!)
        .eq('parent_person_id', myPersonId)
      for (const c of childConns || []) directFlock.add(c.child_person_id)
      directFlock.delete(myPersonId)

      const personIds = [...directFlock]
      if (personIds.length === 0) {
        return NextResponse.json({ people: [], myPersonId, layers: [] })
      }
      query = query.in('id', personIds)
    } else {
      return NextResponse.json({ people: [], myPersonId: null, layers: [] })
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
