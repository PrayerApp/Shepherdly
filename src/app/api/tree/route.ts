import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

// Supabase/PostgREST caps single responses at max-rows (usually 1000),
// regardless of .range(). Paginate explicitly for tables that can exceed
// that cap, so the tree gets every membership row.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPaged<T>(buildQuery: (from: number, to: number) => any): Promise<{ data: T[] }> {
  const out: T[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data } = await buildQuery(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    out.push(...(data as T[]))
    if (data.length < PAGE) break
  }
  return { data: out }
}

/**
 * Rebuild tree_assignments from PCO list→layer links.
 * - Fetches all list-layer links and their people
 * - Assigns each person to the HIGHEST-priority layer (lowest rank) they appear on
 * - Preserves supervisor_person_id and oversight for people who already had assignments
 * - People on a higher layer are excluded from lower layers (dedup)
 */
async function syncListAssignments(admin: any, churchId: string) {
  // 1. Get all list-layer links, ordered by layer rank (highest priority first)
  const { data: links } = await admin
    .from('pco_list_layer_links')
    .select('list_id, layer_id')
    .eq('church_id', churchId)

  if (!links || links.length === 0) return

  // 2. Get layer ranks for ordering
  const { data: layers } = await admin
    .from('tree_layers')
    .select('id, rank')
    .eq('church_id', churchId)
  const layerRank = new Map((layers || []).map((l: any) => [l.id, l.rank]))

  // Sort links by layer rank (lowest rank = highest priority)
  links.sort((a: any, b: any) => ((layerRank.get(a.layer_id) as number) ?? 999) - ((layerRank.get(b.layer_id) as number) ?? 999))

  // 3. Get all list people
  const { data: listPeople } = await admin
    .from('pco_list_people')
    .select('list_id, person_id')
    .eq('church_id', churchId)

  if (!listPeople || listPeople.length === 0) return

  // Index: list_id → person_ids
  const peopleByList = new Map<string, string[]>()
  for (const lp of listPeople) {
    if (!peopleByList.has(lp.list_id)) peopleByList.set(lp.list_id, [])
    peopleByList.get(lp.list_id)!.push(lp.person_id)
  }

  // 4. Get existing assignments to preserve supervisor/sort_order
  const { data: existingAssignments } = await admin
    .from('tree_assignments')
    .select('person_id, supervisor_person_id, sort_order')
    .eq('church_id', churchId)

  const existingMap = new Map<string, { supervisor: string | null; sortOrder: number }>(
    (existingAssignments || []).map((a: any) => [a.person_id, { supervisor: a.supervisor_person_id, sortOrder: a.sort_order }])
  )

  // 5. Build new assignments: each person goes to their highest-priority layer only
  const assigned = new Set<string>()
  const newAssignments: { person_id: string; layer_id: string; supervisor_person_id: string | null; sort_order: number; church_id: string }[] = []

  for (const link of links) {
    const people = peopleByList.get(link.list_id) || []
    for (const personId of people) {
      if (assigned.has(personId)) continue // already assigned to a higher-priority layer
      assigned.add(personId)
      const existing = existingMap.get(personId)
      newAssignments.push({
        person_id: personId,
        layer_id: link.layer_id,
        supervisor_person_id: existing?.supervisor || null,
        sort_order: existing?.sortOrder || 0,
        church_id: churchId,
      })
    }
  }

  // 6. Replace all assignments: delete old, insert new
  await admin.from('tree_assignments').delete().eq('church_id', churchId)
  if (newAssignments.length > 0) {
    // Batch insert in chunks
    for (let i = 0; i < newAssignments.length; i += 500) {
      const chunk = newAssignments.slice(i, i + 500)
      await admin.from('tree_assignments').upsert(chunk, { onConflict: 'person_id,church_id' })
    }
  }

  // 7. Mark people on elder/staff layers as is_leader + is_staff
  const { data: layersWithCat } = await admin
    .from('tree_layers')
    .select('id, category')
    .eq('church_id', churchId)
  const elderStaffLayerIds = new Set(
    (layersWithCat || []).filter((l: any) => ['elder', 'staff'].includes(l.category)).map((l: any) => l.id)
  )

  // Reset all people flags first, then set for assigned ones
  const allPersonIds = newAssignments.map(a => a.person_id)
  if (allPersonIds.length > 0) {
    for (let i = 0; i < allPersonIds.length; i += 500) {
      const chunk = allPersonIds.slice(i, i + 500)
      await admin.from('people').update({ is_leader: true }).in('id', chunk)
    }
    const staffIds = newAssignments.filter(a => elderStaffLayerIds.has(a.layer_id)).map(a => a.person_id)
    if (staffIds.length > 0) {
      for (let i = 0; i < staffIds.length; i += 500) {
        const chunk = staffIds.slice(i, i + 500)
        await admin.from('people').update({ is_staff: true }).in('id', chunk)
      }
    }
  }
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, name, role, church_id, person_id')
    .eq('user_id', user.id)
    .single()

  const admin = createAdminClient()
  const churchId = currentUser?.church_id

  // ── Phase 1: Parallel fetch all data ─────────────────────────
  const [
    { data: layers },
    { data: assignments },
    { data: oversight },
    { data: groupMemberships },
    { data: groups },
    { data: teamMemberships },
    { data: teams },
    { data: groupTypes },
    { data: serviceTypes },
    { data: recentReports },
    { data: pcoLists },
    { data: pcoListPeople },
    { data: pcoListLayerLinks },
    { data: departments },
    { data: departmentMembers },
    { data: shepherdingRelationships },
    { data: layerExclusions },
    { data: layerInclusions },
    { data: gtMappings },
    { data: gtMappingItems },
    { data: treeConnections },
    { data: metricBuckets },
    { data: metricBucketLayers },
  ] = await Promise.all([
    admin.from('tree_layers').select('id, name, category, rank, is_congregational')
      .eq('church_id', churchId!).order('rank'),
    admin.from('tree_assignments').select('id, person_id, layer_id, supervisor_person_id, sort_order, church_id')
      .eq('church_id', churchId!).order('sort_order'),
    admin.from('tree_oversight').select('id, person_id, context_type, context_id')
      .eq('church_id', churchId!),
    fetchAllPaged<{ person_id: string; group_id: string; role: string | null; is_active: boolean }>(
      (from, to) => admin.from('group_memberships').select('person_id, group_id, role, is_active')
        .eq('church_id', churchId!).eq('is_active', true).order('id').range(from, to)),
    fetchAllPaged<{ id: string; name: string; is_active: boolean; group_type_id: string | null; pco_group_type_id: string | null }>(
      (from, to) => admin.from('groups').select('id, name, is_active, group_type_id, pco_group_type_id')
        .eq('church_id', churchId!).eq('is_active', true).order('id').range(from, to)),
    fetchAllPaged<{ person_id: string; team_id: string; role: string | null; is_active: boolean }>(
      (from, to) => admin.from('team_memberships').select('person_id, team_id, role, is_active')
        .eq('church_id', churchId!).eq('is_active', true).order('id').range(from, to)),
    fetchAllPaged<{ id: string; name: string; is_active: boolean; service_type_id: string | null; pco_service_type_id: string | null }>(
      (from, to) => admin.from('teams').select('id, name, is_active, service_type_id, pco_service_type_id')
        .eq('church_id', churchId!).eq('is_active', true).order('id').range(from, to)),
    admin.from('group_types').select('id, pco_id, name, is_tracked')
      .eq('church_id', churchId!).order('name'),
    admin.from('service_types').select('id, pco_id, name, is_tracked')
      .eq('church_id', churchId!).order('name'),
    admin.from('check_in_reports').select('leader_id, created_at')
      .order('created_at', { ascending: false }),
    admin.from('pco_lists').select('id, pco_id, name, description, total_people')
      .eq('church_id', churchId!).order('name'),
    admin.from('pco_list_people').select('list_id, person_id')
      .eq('church_id', churchId!),
    admin.from('pco_list_layer_links').select('id, list_id, layer_id')
      .eq('church_id', churchId!),
    admin.from('departments').select('id, name, color')
      .eq('church_id', churchId!).order('name'),
    admin.from('department_members').select('department_id, person_id')
      .eq('church_id', churchId!),
    fetchAllPaged<{ shepherd_id: string; person_id: string; is_active: boolean }>(
      (from, to) => admin.from('shepherding_relationships').select('shepherd_id, person_id, is_active')
        .eq('church_id', churchId!).eq('is_active', true).order('id').range(from, to)),
    admin.from('tree_layer_exclusions').select('person_id, layer_id')
      .eq('church_id', churchId!),
    admin.from('tree_layer_inclusions').select('person_id, layer_id')
      .eq('church_id', churchId!),
    admin.from('group_team_layer_mappings')
      .select('id, name, kind, leader_layer_id, member_layer_id, auto_connect')
      .eq('church_id', churchId!),
    admin.from('group_team_layer_mapping_items')
      .select('mapping_id, item_id')
      .eq('church_id', churchId!),
    admin.from('tree_connections')
      .select('id, parent_person_id, parent_layer_id, child_person_id, child_layer_id, context_group_id, context_team_id')
      .eq('church_id', churchId!),
    admin.from('tree_metric_buckets')
      .select('id, label, full_name, color, sort_order')
      .eq('church_id', churchId!).order('sort_order'),
    admin.from('tree_metric_bucket_layers')
      .select('bucket_id, layer_id')
      .eq('church_id', churchId!),
  ])

  // ── Phase 2: Collect needed person IDs ───────────────────────
  const neededPersonIds = new Set<string>()
  for (const a of assignments || []) {
    neededPersonIds.add(a.person_id)
    if (a.supervisor_person_id) neededPersonIds.add(a.supervisor_person_id)
  }
  for (const gm of groupMemberships || []) neededPersonIds.add(gm.person_id)
  for (const tm of teamMemberships || []) neededPersonIds.add(tm.person_id)
  for (const lp of pcoListPeople || []) neededPersonIds.add(lp.person_id)
  for (const r of shepherdingRelationships || []) {
    if (r.shepherd_id) neededPersonIds.add(r.shepherd_id)
    if (r.person_id) neededPersonIds.add(r.person_id)
  }
  for (const inc of layerInclusions || []) {
    if (inc.person_id) neededPersonIds.add(inc.person_id)
  }
  if (currentUser?.person_id) neededPersonIds.add(currentUser.person_id)

  // Batch fetch people
  const personIds = [...neededPersonIds]
  const people: { id: string; name: string; pco_id: string | null; status: string; membership_type: string; is_staff: boolean; is_lead_pastor: boolean; is_leader: boolean }[] = []
  for (let i = 0; i < personIds.length; i += 500) {
    const batch = personIds.slice(i, i + 500)
    const { data } = await admin.from('people')
      .select('id, name, pco_id, status, membership_type, is_staff, is_lead_pastor, is_leader')
      .in('id', batch)
    if (data) people.push(...data)
  }

  if (people.length === 0) {
    return NextResponse.json({
      nodes: [], coLeaderLinks: [], layers: layers || [],
      assignments: {}, oversight: {},
      currentUserRole: currentUser?.role,
      groupTypes: (groupTypes || []).map(gt => ({ id: gt.id, name: gt.name, is_tracked: gt.is_tracked })),
      serviceTypes: (serviceTypes || []).map(st => ({ id: st.id, name: st.name, is_tracked: (st as any).is_tracked })),
      pcoLists: (pcoLists || []).map(l => ({ id: l.id, name: l.name, totalPeople: l.total_people })),
      pcoListPeople: [],
      listLayerLinks: (pcoListLayerLinks || []).map(ll => ({ listId: ll.list_id, layerId: ll.layer_id })),
      departments: (departments || []).map(d => ({ id: d.id, name: d.name, color: d.color })),
      departmentMembers: departmentMembers || [],
      stats: { shepherdCount: 0, groupCount: 0, teamCount: 0 },
    })
  }

  const personMap = new Map(people.map(p => [p.id, p]))
  const groupMap = new Map((groups || []).map(g => [g.id, g]))
  const teamMap = new Map((teams || []).map(t => [t.id, t]))
  const groupTypeMap = new Map((groupTypes || []).map(gt => [gt.id, gt]))
  const groupTypePcoMap = new Map((groupTypes || []).map(gt => [gt.pco_id, gt]))
  const serviceTypeMap = new Map((serviceTypes || []).map(st => [st.id, st]))
  const serviceTypePcoMap = new Map((serviceTypes || []).map(st => [st.pco_id, st]))
  const layerMap = new Map((layers || []).map(l => [l.id, l]))
  const departmentMap = new Map((departments || []).map((d: any) => [d.id, d]))

  // Build tracked-type sets for filtering
  const trackedGroupTypeIds = new Set((groupTypes || []).filter(gt => gt.is_tracked).map(gt => gt.id))
  const trackedGroupTypePcoIds = new Set((groupTypes || []).filter(gt => gt.is_tracked).map(gt => gt.pco_id))
  const trackedServiceTypeIds = new Set((serviceTypes || []).filter((st: any) => st.is_tracked).map(st => st.id))
  const trackedServiceTypePcoIds = new Set((serviceTypes || []).filter((st: any) => st.is_tracked).map(st => st.pco_id))

  function isGroupTracked(group: { group_type_id?: string | null; pco_group_type_id?: string | null }): boolean {
    if (group.group_type_id && trackedGroupTypeIds.has(group.group_type_id)) return true
    if (group.pco_group_type_id && trackedGroupTypePcoIds.has(group.pco_group_type_id)) return true
    if (!group.group_type_id && !group.pco_group_type_id) return true
    return false
  }
  function isTeamTracked(team: { service_type_id?: string | null; pco_service_type_id?: string | null }): boolean {
    if (team.service_type_id && trackedServiceTypeIds.has(team.service_type_id)) return true
    if (team.pco_service_type_id && trackedServiceTypePcoIds.has(team.pco_service_type_id)) return true
    if (!team.service_type_id && !team.pco_service_type_id) return true
    return false
  }

  function getGroupTypeId(group: { group_type_id?: string | null; pco_group_type_id?: string | null }): string | null {
    if (group.group_type_id) return group.group_type_id
    if (group.pco_group_type_id) {
      const gt = groupTypePcoMap.get(group.pco_group_type_id)
      if (gt) return gt.id
    }
    return null
  }
  function getTeamServiceTypeId(team: { service_type_id?: string | null; pco_service_type_id?: string | null }): string | null {
    if (team.service_type_id) return team.service_type_id
    if (team.pco_service_type_id) {
      const st = serviceTypePcoMap.get(team.pco_service_type_id)
      if (st) return st.id
    }
    return null
  }
  function getGroupTypeName(group: { group_type_id?: string | null; pco_group_type_id?: string | null }): string | null {
    if (group.group_type_id) { const gt = groupTypeMap.get(group.group_type_id); if (gt) return gt.name }
    if (group.pco_group_type_id) { const gt = groupTypePcoMap.get(group.pco_group_type_id); if (gt) return gt.name }
    return null
  }
  function getServiceTypeName(team: { service_type_id?: string | null; pco_service_type_id?: string | null }): string | null {
    if (team.service_type_id) { const st = serviceTypeMap.get(team.service_type_id); if (st) return st.name }
    if (team.pco_service_type_id) { const st = serviceTypePcoMap.get(team.pco_service_type_id); if (st) return st.name }
    return null
  }

  // Last check-in per person
  const lastCheckin: Record<string, string> = {}
  recentReports?.forEach(r => {
    if (!lastCheckin[r.leader_id]) lastCheckin[r.leader_id] = r.created_at
  })

  // ── Build tree nodes ─────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: any[] = []
  const coLeaderLinks: { from: string; to: string }[] = []

  // Index assignments by person
  type AssignmentRow = { id: string; person_id: string; layer_id: string; supervisor_person_id: string | null; sort_order: number; church_id: string }
  const assignmentByPerson = new Map<string, AssignmentRow>()
  for (const a of (assignments || []) as AssignmentRow[]) assignmentByPerson.set(a.person_id, a)

  // Index oversight by person
  const oversightByPerson = new Map<string, { context_type: string; context_id: string }[]>()
  for (const o of oversight || []) {
    if (!oversightByPerson.has(o.person_id)) oversightByPerson.set(o.person_id, [])
    oversightByPerson.get(o.person_id)!.push({ context_type: o.context_type, context_id: o.context_id })
  }

  // Set of person IDs with manual assignments (they won't get ANY separate PCO nodes)
  const assignedPersonIds = new Set((assignments || []).map(a => a.person_id))

  // Set of person IDs on staff or elder layers (for isStaff badge — NOT all assigned people)
  const staffPersonIds = new Set(
    (assignments || []).filter(a => {
      const layer = layerMap.get(a.layer_id)
      return layer && ['elder', 'staff'].includes(layer.category)
    }).map(a => a.person_id)
  )

  // ── Step 1: Build manual hierarchy nodes ─────────────────────
  // These are Elders, Staff, and optionally Volunteer coaches

  // Index assignments by layer for placeholder logic
  const assignmentsByLayer = new Map<string, AssignmentRow[]>()
  for (const a of (assignments || []) as AssignmentRow[]) {
    if (!assignmentsByLayer.has(a.layer_id)) assignmentsByLayer.set(a.layer_id, [])
    assignmentsByLayer.get(a.layer_id)!.push(a)
  }

  // Pre-compute Lead Pastor + first staff for supervisor fallback
  const sortedLayers = [...(layers || [])].sort((a, b) => a.rank - b.rank)
  const leadPastorAssignment = ((assignments || []) as AssignmentRow[]).find(a => {
    const p = personMap.get(a.person_id)
    return p?.is_lead_pastor
  })
  const leadPastorNodeId = leadPastorAssignment
    ? `${leadPastorAssignment.person_id}::layer-${leadPastorAssignment.layer_id}`
    : null
  const firstStaffLayer = sortedLayers.find(l => l.category === 'staff')
  const firstStaffAssignment = firstStaffLayer
    ? (assignmentsByLayer.get(firstStaffLayer.id) || [])[0]
    : null

  for (const a of (assignments || []) as AssignmentRow[]) {
    const person = personMap.get(a.person_id)
    if (!person) continue
    const layer = layerMap.get(a.layer_id)
    if (!layer) continue

    const isStaffOrElder = ['elder', 'staff'].includes(layer.category)

    // Build context label from oversight
    const personOversight = oversightByPerson.get(a.person_id) || []
    const oversightNames = personOversight.map(o => {
      if (o.context_type === 'group_type') {
        const gt = groupTypeMap.get(o.context_id)
        return gt?.name || null
      } else if (o.context_type === 'department') {
        const dept = departmentMap.get(o.context_id)
        return dept?.name || null
      } else {
        const st = serviceTypeMap.get(o.context_id)
        return st?.name || null
      }
    }).filter(Boolean)

    let contextLabel = layer.name
    if (person.is_lead_pastor) contextLabel += ' · Lead Pastor'
    if (oversightNames.length > 0) contextLabel += ' · ' + oversightNames.join(', ')

    // Find supervisor's node ID
    let supervisorId: string | null = null
    let isUnconnected = false
    if (a.supervisor_person_id) {
      const supAssignment = ((assignments || []) as AssignmentRow[]).find(x => x.person_id === a.supervisor_person_id)
      if (supAssignment) {
        supervisorId = `${a.supervisor_person_id}::layer-${supAssignment.layer_id}`
      }
    }

    // Auto-assign: only the TOP staff layer → under Lead Pastor
    // All other unconnected staff/volunteers: excluded from tree (bottom panel only)
    if (!supervisorId && !person.is_lead_pastor && layer.category !== 'elder') {
      if (layer.category === 'staff' && firstStaffLayer && layer.id === firstStaffLayer.id && leadPastorNodeId) {
        // Top staff layer → auto under Lead Pastor
        supervisorId = leadPastorNodeId
      } else {
        // Any other staff or volunteer without a supervisor → not in tree
        continue
      }
    }

    nodes.push({
      id: `${a.person_id}::layer-${a.layer_id}`,
      personId: a.person_id,
      name: person.name || 'Unknown',
      role: 'shepherd' as const,
      supervisorId,
      flockCount: 0,
      lastCheckin: lastCheckin[a.person_id] || null,
      isCurrentUser: false,
      isStaff: isStaffOrElder,
      isLeadPastor: !!person.is_lead_pastor,
      contextLabel,
      warning: isUnconnected ? 'Unconnected' : null,
      layerId: a.layer_id,
      layerCategory: layer.category,
      sortOrder: a.sort_order || 0,
      groupTypeId: null,
      serviceTypeId: null,
      isPlaceholder: false,
    })
  }

  // ── Add placeholder nodes ─────────────────────────────────────
  //
  // Design (from user diagrams):
  //  - Lead Pastor → ONE placeholder for top staff layer
  //  - Each staff member → ONE placeholder for the next layer below
  //  - Each volunteer (on layers with more layers below) → ONE placeholder
  //  - Non-LP elders → NO placeholder
  //  - If a layer is completely empty AND is elder or top staff → layer-level placeholder
  //

  const mkPlaceholder = (id: string, label: string, layerId: string, layerCategory: string, supervisorId: string | null, supervisorPersonId?: string) => ({
    id,
    personId: undefined,
    name: `+ ${label}`,
    role: 'shepherd' as const,
    supervisorId,
    flockCount: 0,
    lastCheckin: null,
    isCurrentUser: false,
    isStaff: ['elder', 'staff'].includes(layerCategory),
    isLeadPastor: false,
    contextLabel: label,
    warning: null,
    layerId,
    layerCategory,
    sortOrder: 99999,
    groupTypeId: null,
    serviceTypeId: null,
    isPlaceholder: true,
    placeholderSupervisorPersonId: supervisorPersonId || null,
  })

  // Layer-level placeholders: only for empty elder or empty top-staff layer
  for (const layer of sortedLayers) {
    const hasAssignments = (assignmentsByLayer.get(layer.id) || []).length > 0
    if (hasAssignments) continue

    if (layer.category === 'elder') {
      nodes.push(mkPlaceholder(
        `placeholder-${layer.id}`, layer.name, layer.id, layer.category, null,
      ))
    } else if (layer.category === 'staff' && layer.id === firstStaffLayer?.id && leadPastorNodeId) {
      nodes.push(mkPlaceholder(
        `placeholder-${layer.id}`, layer.name, layer.id, layer.category,
        leadPastorNodeId,
      ))
    }
  }

  // Per-person placeholders: everyone with layers below gets ONE "+" child
  for (const a of (assignments || []) as AssignmentRow[]) {
    const layer = layerMap.get(a.layer_id)
    if (!layer) continue
    const person = personMap.get(a.person_id)
    if (!person) continue

    const isLP = !!person.is_lead_pastor
    const isNonLPElder = layer.category === 'elder' && !isLP

    // Non-LP elders don't get placeholders
    if (isNonLPElder) continue

    // Find the next layer below this person's layer rank
    let targetLayer: typeof sortedLayers[0] | undefined
    if (isLP) {
      // Lead Pastor → top staff layer
      targetLayer = sortedLayers.find(l => l.category === 'staff')
    } else {
      // Staff or volunteer → next layer by rank
      targetLayer = sortedLayers.find(l => l.rank > layer.rank)
    }

    if (!targetLayer) continue

    const parentNodeId = `${a.person_id}::layer-${a.layer_id}`
    nodes.push(mkPlaceholder(
      `placeholder-under-${a.person_id}`,
      targetLayer.name,
      targetLayer.id,
      targetLayer.category,
      parentNodeId,
      a.person_id,
    ))
  }

  // ── Bridge nodes: align same-layer people to same visual depth ──
  // When a person's supervisor is >1 layer step above, insert invisible
  // bridge nodes at intermediate layers so all same-rank people align.
  const layerRankList = sortedLayers.map(l => l.rank)
  const layerRankMap = new Map((layers || []).map(l => [l.id, l.rank]))
  const nodeLayerRank = new Map<string, number>() // nodeId → rank
  for (const n of nodes) {
    if (n.layerId) {
      const lr = layerRankMap.get(n.layerId)
      if (lr !== undefined) nodeLayerRank.set(n.id, lr as number)
    }
  }

  const bridgeNodes: typeof nodes = []
  for (const n of nodes) {
    if (n.isPlaceholder || !n.supervisorId || !n.layerId) continue
    const myRank = nodeLayerRank.get(n.id)
    const supRank = nodeLayerRank.get(n.supervisorId)
    if (myRank === undefined || supRank === undefined) continue

    // Find intermediate layer ranks between supervisor and this node
    const intermediateRanks = layerRankList.filter(r => r > supRank && r < myRank)
    if (intermediateRanks.length === 0) continue

    // Insert chain of bridge nodes: supervisor → bridge1 → bridge2 → ... → this node
    let prevNodeId = n.supervisorId
    for (const rank of intermediateRanks) {
      const bridgeLayer = sortedLayers.find(l => l.rank === rank)
      if (!bridgeLayer) continue
      const bridgeId = `bridge-${n.personId}-${bridgeLayer.id}`
      bridgeNodes.push({
        id: bridgeId,
        personId: undefined,
        name: '',
        role: 'shepherd' as const,
        supervisorId: prevNodeId,
        flockCount: 0,
        lastCheckin: null,
        isCurrentUser: false,
        isStaff: false,
        isLeadPastor: false,
        contextLabel: null,
        warning: null,
        layerId: bridgeLayer.id,
        layerCategory: bridgeLayer.category,
        sortOrder: 0,
        groupTypeId: null,
        serviceTypeId: null,
        isPlaceholder: false,
        isBridge: true,
      })
      prevNodeId = bridgeId
    }
    // Re-parent the actual node to the last bridge
    n.supervisorId = prevNodeId
  }
  nodes.push(...bridgeNodes)

  // ── Step 2: Index PCO memberships ────────────────────────────
  const groupMembers = new Map<string, { personId: string; role: string }[]>()
  for (const gm of groupMemberships || []) {
    if (!groupMembers.has(gm.group_id)) groupMembers.set(gm.group_id, [])
    groupMembers.get(gm.group_id)!.push({ personId: gm.person_id, role: gm.role || 'member' })
  }
  const teamMembers = new Map<string, { personId: string; role: string }[]>()
  for (const tm of teamMemberships || []) {
    if (!teamMembers.has(tm.team_id)) teamMembers.set(tm.team_id, [])
    teamMembers.get(tm.team_id)!.push({ personId: tm.person_id, role: tm.role || 'member' })
  }

  // Build map: group_type_id → person who oversees it (from tree_oversight)
  // If multiple people oversee same type, pick the one on the lowest (most specific) layer
  const groupTypeOverseers = new Map<string, string>() // gtId → personId
  const serviceTypeOverseers = new Map<string, string>() // stId → personId
  for (const [personId, entries] of oversightByPerson) {
    for (const e of entries) {
      if (e.context_type === 'group_type') {
        groupTypeOverseers.set(e.context_id, personId)
      } else if (e.context_type === 'service_type') {
        serviceTypeOverseers.set(e.context_id, personId)
      }
    }
  }

  // ── Step 3: Build PCO group nodes ────────────────────────────
  // People with manual assignments (Elder/Staff/Volunteer) appear ONLY at their
  // assigned layer — they never get duplicate PCO nodes.
  for (const [groupId, members] of groupMembers) {
    const group = groupMap.get(groupId)
    if (!group) continue
    if (!isGroupTracked(group)) continue

    const validMembers = members.filter(m => personMap.has(m.personId))
    if (validMembers.length === 0) continue

    const groupTypeName = getGroupTypeName(group)
    const contextLabel = groupTypeName ? `${groupTypeName}: ${group.name}` : group.name || 'Group'
    const contextId = `group-${groupId}`
    const gtId = getGroupTypeId(group)
    const gMeta = { groupTypeId: gtId || undefined }

    const overseerId = gtId ? groupTypeOverseers.get(gtId) : null
    const overseerAssignment = overseerId ? assignmentByPerson.get(overseerId) : null
    const overseerNodeId = overseerAssignment ? `${overseerId}::layer-${overseerAssignment.layer_id}` : null

    // Filter out manually-assigned people — they already have their layer node
    const pcoLeaders = validMembers.filter(m => /leader|co.?leader/i.test(m.role) && !assignedPersonIds.has(m.personId))
    const pcoMembers = validMembers.filter(m => !/leader|co.?leader/i.test(m.role) && !assignedPersonIds.has(m.personId))

    if (pcoLeaders.length > 0) {
      const primaryLeader = pcoLeaders[0]
      const primaryNodeId = `${primaryLeader.personId}::${contextId}`
      nodes.push(mkPcoNode(primaryLeader.personId, contextId, 'shepherd', overseerNodeId, contextLabel, pcoMembers.length, gMeta))

      for (let i = 1; i < pcoLeaders.length; i++) {
        nodes.push(mkPcoNode(pcoLeaders[i].personId, contextId, 'shepherd', overseerNodeId, contextLabel, pcoMembers.length, gMeta))
        coLeaderLinks.push({ from: primaryNodeId, to: `${pcoLeaders[i].personId}::${contextId}` })
      }

      for (const m of pcoMembers) {
        nodes.push(mkPcoNode(m.personId, contextId, 'member', primaryNodeId, contextLabel, 0, gMeta))
      }
    } else if (overseerNodeId) {
      for (const m of pcoMembers) {
        nodes.push(mkPcoNode(m.personId, contextId, 'member', overseerNodeId, contextLabel, 0, gMeta))
      }
    } else {
      // No PCO leaders, no overseer — orphan members
      const allPco = validMembers.filter(m => !assignedPersonIds.has(m.personId))
      for (const m of allPco) {
        nodes.push(mkPcoNode(m.personId, contextId, 'member', null, contextLabel, 0, gMeta))
      }
    }
  }

  // ── Step 4: Build PCO team nodes ─────────────────────────────
  for (const [teamId, members] of teamMembers) {
    const team = teamMap.get(teamId)
    if (!team) continue
    if (!isTeamTracked(team)) continue

    const validMembers = members.filter(m => personMap.has(m.personId))
    if (validMembers.length === 0) continue

    const serviceTypeName = getServiceTypeName(team)
    const contextLabel = serviceTypeName ? `${serviceTypeName}: ${team.name}` : team.name || 'Team'
    const contextId = `team-${teamId}`
    const stId = getTeamServiceTypeId(team)
    const sMeta = { serviceTypeId: stId || undefined }

    const overseerId = stId ? serviceTypeOverseers.get(stId) : null
    const overseerAssignment = overseerId ? assignmentByPerson.get(overseerId) : null
    const overseerNodeId = overseerAssignment ? `${overseerId}::layer-${overseerAssignment.layer_id}` : null

    // Filter out manually-assigned people — they already have their layer node
    const pcoLeaders = validMembers.filter(m => /leader|co.?leader/i.test(m.role) && !assignedPersonIds.has(m.personId))
    const pcoMembers = validMembers.filter(m => !/leader|co.?leader/i.test(m.role) && !assignedPersonIds.has(m.personId))

    if (pcoLeaders.length > 0) {
      const primaryLeader = pcoLeaders[0]
      const primaryNodeId = `${primaryLeader.personId}::${contextId}`
      nodes.push(mkPcoNode(primaryLeader.personId, contextId, 'shepherd', overseerNodeId, contextLabel, pcoMembers.length, sMeta))

      for (let i = 1; i < pcoLeaders.length; i++) {
        nodes.push(mkPcoNode(pcoLeaders[i].personId, contextId, 'shepherd', overseerNodeId, contextLabel, pcoMembers.length, sMeta))
        coLeaderLinks.push({ from: primaryNodeId, to: `${pcoLeaders[i].personId}::${contextId}` })
      }

      for (const m of pcoMembers) {
        nodes.push(mkPcoNode(m.personId, contextId, 'member', primaryNodeId, contextLabel, 0, sMeta))
      }
    } else if (overseerNodeId) {
      for (const m of pcoMembers) {
        nodes.push(mkPcoNode(m.personId, contextId, 'member', overseerNodeId, contextLabel, 0, sMeta))
      }
    } else {
      const allPco = validMembers.filter(m => !assignedPersonIds.has(m.personId))
      for (const m of allPco) {
        nodes.push(mkPcoNode(m.personId, contextId, 'member', null, contextLabel, 0, sMeta))
      }
    }
  }

  // ── Step 5: Update flock counts for manual nodes ─────────────
  for (const n of nodes) {
    if (n.layerId) {
      n.flockCount = nodes.filter((c: any) => c.supervisorId === n.id).length
    }
  }

  // ── Mark current user ────────────────────────────────────────
  let currentUserPersonId: string | null = null
  if (currentUser?.person_id && personMap.has(currentUser.person_id)) {
    currentUserPersonId = currentUser.person_id
  } else if (currentUser?.name) {
    const match = people.find(p => p.name?.toLowerCase() === currentUser.name?.toLowerCase())
    if (match) currentUserPersonId = match.id
  }
  if (currentUserPersonId) {
    for (const node of nodes) {
      if (node.personId === currentUserPersonId) node.isCurrentUser = true
    }
  }

  // ── Stats ────────────────────────────────────────────────────
  const shepherdCount = new Set(nodes.filter((n: any) => n.role === 'shepherd').map((n: any) => n.personId)).size
  const groupCount = new Set(
    Array.from(groupMembers.keys()).filter(gid => {
      const g = groupMap.get(gid)
      return g && isGroupTracked(g) && (groupMembers.get(gid) || []).some(m => personMap.has(m.personId))
    })
  ).size
  const teamCount = new Set(
    Array.from(teamMembers.keys()).filter(tid => {
      const t = teamMap.get(tid)
      return t && isTeamTracked(t) && (teamMembers.get(tid) || []).some(m => personMap.has(m.personId))
    })
  ).size

  // ── Build assignment + oversight maps for frontend ───────────
  const assignmentMap: Record<string, { layerId: string; layerName: string; layerCategory: string; layerRank: number; supervisorPersonId: string | null; sortOrder: number }> = {}
  for (const a of assignments || []) {
    const layer = layerMap.get(a.layer_id)
    assignmentMap[a.person_id] = {
      layerId: a.layer_id,
      layerName: layer?.name || 'Unknown',
      layerCategory: layer?.category || 'volunteer',
      layerRank: layer?.rank ?? 999,
      supervisorPersonId: a.supervisor_person_id,
      sortOrder: a.sort_order || 0,
    }
  }

  const oversightMapOut: Record<string, { contextType: string; contextId: string; typeName: string }[]> = {}
  for (const o of oversight || []) {
    if (!oversightMapOut[o.person_id]) oversightMapOut[o.person_id] = []
    let typeName = 'Unknown'
    if (o.context_type === 'group_type') {
      const gt = groupTypeMap.get(o.context_id)
      if (gt) typeName = gt.name
    } else if (o.context_type === 'department') {
      const dept = departmentMap.get(o.context_id)
      if (dept) typeName = dept.name
    } else {
      const st = serviceTypeMap.get(o.context_id)
      if (st) typeName = st.name
    }
    oversightMapOut[o.person_id].push({ contextType: o.context_type, contextId: o.context_id, typeName })
  }

  // ── Unassigned data for bottom panel ─────────────────────────
  // Staff for bottom panel: people from REF lists linked to staff layers
  // who are NOT already on the tree, PLUS any is_staff people not on a layer
  const staffLayerIds = new Set(sortedLayers.filter(l => l.category === 'staff').map(l => l.id))
  const staffListIds = new Set(
    (pcoListLayerLinks || []).filter(ll => staffLayerIds.has(ll.layer_id)).map(ll => ll.list_id)
  )
  // People on staff-linked REF lists
  const staffListPeopleIds = new Set<string>()
  for (const lp of pcoListPeople || []) {
    if (staffListIds.has(lp.list_id)) staffListPeopleIds.add(lp.person_id)
  }
  const unconnectedStaff: { id: string; name: string; layerName: string }[] = []
  const seenStaffIds = new Set<string>()
  // From REF lists linked to staff layers
  for (const pid of staffListPeopleIds) {
    if (assignedPersonIds.has(pid)) continue
    const person = personMap.get(pid)
    if (!person || person.is_lead_pastor) continue
    if (seenStaffIds.has(pid)) continue
    seenStaffIds.add(pid)
    unconnectedStaff.push({ id: pid, name: person.name || 'Unknown', layerName: 'Staff' })
  }
  // Also include is_staff people not on any layer (catch-all)
  for (const p of people) {
    if (!p.is_staff) continue
    if (p.is_lead_pastor) continue
    if (assignedPersonIds.has(p.id)) continue
    if (seenStaffIds.has(p.id)) continue
    seenStaffIds.add(p.id)
    unconnectedStaff.push({ id: p.id, name: p.name || 'Unknown', layerName: 'Staff' })
  }
  // Group types with no overseer
  const unlinkedGroupTypes = (groupTypes || [])
    .filter(gt => gt.is_tracked && !groupTypeOverseers.has(gt.id))
    .map(gt => ({ id: gt.id, name: gt.name }))
  // Service types with no overseer
  const unlinkedServiceTypes = (serviceTypes || [])
    .filter((st: any) => st.is_tracked !== false && !serviceTypeOverseers.has(st.id))
    .map(st => ({ id: st.id, name: st.name }))

  // Volunteer-layer people with no supervisor (unconnected) + their group/team context
  // We derive this from nodes that have warning=Unconnected and volunteer layer
  // But we also need volunteers who are PCO leaders with no overseer — those are root nodes
  // For the bottom panel we need: personId, name, groupTypeId/serviceTypeId for filtering
  const unconnectedVolunteers: { id: string; name: string; groupTypeId: string | null; serviceTypeId: string | null }[] = []
  const seenVolIds = new Set<string>()
  for (const n of nodes) {
    if (n.isBridge || n.isPlaceholder || !n.personId) continue
    // Manual volunteer-layer people with no supervisor
    if (n.layerId && n.warning === 'Unconnected') {
      const layer = layerMap.get(n.layerId)
      if (layer && layer.category === 'volunteer' && !seenVolIds.has(n.personId)) {
        seenVolIds.add(n.personId)
        unconnectedVolunteers.push({ id: n.personId, name: n.name, groupTypeId: n.groupTypeId || null, serviceTypeId: n.serviceTypeId || null })
      }
    }
    // PCO leaders (shepherds) that are root nodes (no supervisor) and not on a manual layer
    if (!n.layerId && n.role === 'shepherd' && !n.supervisorId && !n.isStaff && !seenVolIds.has(n.personId)) {
      seenVolIds.add(n.personId)
      unconnectedVolunteers.push({ id: n.personId, name: n.name, groupTypeId: n.groupTypeId || null, serviceTypeId: n.serviceTypeId || null })
    }
  }

  // ── Per-person shepherding stats (for V2 person cards) ───────
  // For each person who might be a shepherd, bucket the unique people
  // they shepherd into: S (staff), L (non-staff leaders),
  // P (congregation reached via a group/team they lead),
  // F (floaters — direct shepherding_relationships only, not via a group/team they lead).
  // Priority when a shepherdee qualifies for multiple buckets: S > L > P > F.
  const personStats: Record<string, { s: number; l: number; p: number; f: number; total: number }> = {}

  // Build: shepherd_person_id -> Set of shepherded person_ids (from each source)
  const supervisees = new Map<string, Set<string>>()
  for (const a of (assignments || []) as { person_id: string; supervisor_person_id: string | null }[]) {
    if (!a.supervisor_person_id) continue
    if (!supervisees.has(a.supervisor_person_id)) supervisees.set(a.supervisor_person_id, new Set())
    supervisees.get(a.supervisor_person_id)!.add(a.person_id)
  }

  const shepherdees = new Map<string, Set<string>>()
  for (const r of (shepherdingRelationships || []) as { shepherd_id: string; person_id: string }[]) {
    if (!r.shepherd_id || !r.person_id) continue
    if (!shepherdees.has(r.shepherd_id)) shepherdees.set(r.shepherd_id, new Set())
    shepherdees.get(r.shepherd_id)!.add(r.person_id)
  }

  // Leaders of each group/team → members of those groups/teams
  // leaderFlockViaGroupsTeams: personId -> Set<member person_id>
  const leaderFlockViaGroupsTeams = new Map<string, Set<string>>()
  const addToFlock = (leaderId: string, memberId: string) => {
    if (leaderId === memberId) return
    if (!leaderFlockViaGroupsTeams.has(leaderId)) leaderFlockViaGroupsTeams.set(leaderId, new Set())
    leaderFlockViaGroupsTeams.get(leaderId)!.add(memberId)
  }

  // Index group memberships by group
  const groupMembersAll = new Map<string, { personId: string; role: string }[]>()
  for (const gm of groupMemberships || []) {
    if (!gm.person_id) continue
    if (!groupMembersAll.has(gm.group_id)) groupMembersAll.set(gm.group_id, [])
    groupMembersAll.get(gm.group_id)!.push({ personId: gm.person_id, role: gm.role || 'member' })
  }
  for (const [groupId, members] of groupMembersAll) {
    const leaders = members.filter(m => /leader|co.?leader/i.test(m.role)).map(m => m.personId)
    if (leaders.length === 0) continue
    for (const leaderId of leaders) {
      for (const m of members) {
        if (leaders.includes(m.personId)) continue // don't count co-leaders as flock
        addToFlock(leaderId, m.personId)
      }
    }
  }

  const teamMembersAll = new Map<string, { personId: string; role: string }[]>()
  for (const tm of teamMemberships || []) {
    if (!tm.person_id) continue
    if (!teamMembersAll.has(tm.team_id)) teamMembersAll.set(tm.team_id, [])
    teamMembersAll.get(tm.team_id)!.push({ personId: tm.person_id, role: tm.role || 'member' })
  }
  for (const [teamId, members] of teamMembersAll) {
    const leaders = members.filter(m => /leader|co.?leader/i.test(m.role)).map(m => m.personId)
    if (leaders.length === 0) continue
    for (const leaderId of leaders) {
      for (const m of members) {
        if (leaders.includes(m.personId)) continue
        addToFlock(leaderId, m.personId)
      }
    }
  }

  // Gather all candidate shepherd person_ids (anyone who might have stats)
  const candidateShepherds = new Set<string>([
    ...supervisees.keys(),
    ...shepherdees.keys(),
    ...leaderFlockViaGroupsTeams.keys(),
  ])

  for (const shepherdId of candidateShepherds) {
    const viaGroupsTeams = leaderFlockViaGroupsTeams.get(shepherdId) || new Set<string>()
    const viaDirect = shepherdees.get(shepherdId) || new Set<string>()
    const viaSupervisor = supervisees.get(shepherdId) || new Set<string>()

    const all = new Set<string>([...viaGroupsTeams, ...viaDirect, ...viaSupervisor])
    all.delete(shepherdId)

    let s = 0, l = 0, p = 0, f = 0
    for (const pid of all) {
      const person = personMap.get(pid)
      const isStaff = !!person?.is_staff
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const isLeader = !!(person as any)?.is_leader
      if (isStaff) s++
      else if (isLeader) l++
      else if (viaGroupsTeams.has(pid)) p++
      else f++
    }
    personStats[shepherdId] = { s, l, p, f, total: s + l + p + f }
  }

  return NextResponse.json({
    nodes,
    coLeaderLinks,
    layers: layers || [],
    assignments: assignmentMap,
    oversightMap: oversightMapOut,
    personStats,
    layerExclusions: (layerExclusions || []).map((e: { person_id: string; layer_id: string }) => ({
      personId: e.person_id, layerId: e.layer_id,
    })),
    layerInclusions: (layerInclusions || []).map((e: { person_id: string; layer_id: string }) => ({
      personId: e.person_id,
      layerId: e.layer_id,
      personName: personMap.get(e.person_id)?.name || 'Unknown',
    })),
    metricBuckets: (metricBuckets || []).map((b: { id: string; label: string; full_name: string; color: string | null; sort_order: number }) => ({
      id: b.id,
      label: b.label,
      fullName: b.full_name,
      color: b.color,
      sortOrder: b.sort_order,
      layerIds: (metricBucketLayers || [])
        .filter((bl: { bucket_id: string; layer_id: string }) => bl.bucket_id === b.id)
        .map((bl: { bucket_id: string; layer_id: string }) => bl.layer_id),
    })),
    connections: (treeConnections || []).map((c: { id: string; parent_person_id: string; parent_layer_id: string; child_person_id: string; child_layer_id: string; context_group_id: string | null; context_team_id: string | null }) => ({
      id: c.id,
      parentPersonId: c.parent_person_id,
      parentLayerId: c.parent_layer_id,
      childPersonId: c.child_person_id,
      childLayerId: c.child_layer_id,
      contextGroupId: c.context_group_id,
      contextTeamId: c.context_team_id,
    })),
    groupsList: (groups || []).map((g: { id: string; name: string; group_type_id?: string | null; pco_group_type_id?: string | null }) => ({
      id: g.id,
      name: g.name || 'Untitled group',
      groupTypeName: getGroupTypeName(g),
    })),
    teamsList: (teams || []).map((t: { id: string; name: string; service_type_id?: string | null; pco_service_type_id?: string | null }) => ({
      id: t.id,
      name: t.name || 'Untitled team',
      serviceTypeName: getServiceTypeName(t),
    })),
    gtMappings: (gtMappings || []).map((m: { id: string; name: string; kind: string; leader_layer_id: string | null; member_layer_id: string | null; auto_connect: boolean }) => ({
      id: m.id,
      name: m.name,
      kind: m.kind,
      leaderLayerId: m.leader_layer_id,
      memberLayerId: m.member_layer_id,
      autoConnect: !!m.auto_connect,
      itemIds: (gtMappingItems || [])
        .filter((it: { mapping_id: string; item_id: string }) => it.mapping_id === m.id)
        .map((it: { mapping_id: string; item_id: string }) => it.item_id),
    })),
    // Pre-computed per-layer people derived from Groups/Teams mappings.
    // Now carries the context (group/team id) of each appearance so the
    // frontend can render one card per membership on congregational layers.
    mappingLayerPeople: (() => {
      type Row = {
        layerId: string
        personId: string
        personName: string
        role: 'leader' | 'member'
        contextKind: 'group' | 'team'
        contextId: string
      }
      const rows: Row[] = []
      const seen = new Set<string>() // layerId::personId::role::contextKind::contextId
      const leaderRe = /leader|co.?leader/i
      for (const m of (gtMappings || []) as { id: string; kind: string; leader_layer_id: string | null; member_layer_id: string | null }[]) {
        const items = (gtMappingItems || []).filter((it: { mapping_id: string }) => it.mapping_id === m.id).map((it: { item_id: string }) => it.item_id)
        if (items.length === 0) continue
        const pool: { personId: string; role: string; contextKind: 'group' | 'team'; contextId: string }[] = []
        if (m.kind === 'groups') {
          for (const gid of items) {
            const members = groupMembers.get(gid) || []
            // Skip MEMBER entries for groups with no leader — those members
            // would render as cards with no incoming edges, which is noise.
            // Leaders themselves always pass through.
            const hasLeader = members.some(x => leaderRe.test(x.role || ''))
            for (const mm of members) {
              const isLeader = leaderRe.test(mm.role || '')
              if (!isLeader && !hasLeader) continue
              pool.push({ personId: mm.personId, role: mm.role, contextKind: 'group', contextId: gid })
            }
          }
        } else if (m.kind === 'teams') {
          for (const tid of items) {
            const members = teamMembers.get(tid) || []
            const hasLeader = members.some(x => leaderRe.test(x.role || ''))
            for (const mm of members) {
              const isLeader = leaderRe.test(mm.role || '')
              if (!isLeader && !hasLeader) continue
              pool.push({ personId: mm.personId, role: mm.role, contextKind: 'team', contextId: tid })
            }
          }
        }
        for (const mm of pool) {
          const isLeader = leaderRe.test(mm.role || '')
          const layerId = isLeader ? m.leader_layer_id : m.member_layer_id
          if (!layerId) continue
          const role: 'leader' | 'member' = isLeader ? 'leader' : 'member'
          const key = `${layerId}::${mm.personId}::${role}::${mm.contextKind}-${mm.contextId}`
          if (seen.has(key)) continue
          seen.add(key)
          const p = personMap.get(mm.personId)
          if (!p) continue
          rows.push({
            layerId,
            personId: mm.personId,
            personName: p.name || 'Unknown',
            role,
            contextKind: mm.contextKind,
            contextId: mm.contextId,
          })
        }
      }
      return rows
    })(),
    currentUserRole: currentUser?.role,
    groupTypes: (groupTypes || []).map(gt => ({ id: gt.id, name: gt.name, is_tracked: gt.is_tracked })),
    serviceTypes: (serviceTypes || []).map(st => ({ id: st.id, name: st.name, is_tracked: (st as any).is_tracked })),
    pcoLists: (pcoLists || []).map(l => ({ id: l.id, name: l.name, totalPeople: l.total_people })),
    pcoListPeople: (pcoListPeople || []).map(lp => ({
      listId: lp.list_id,
      personId: lp.person_id,
      personName: personMap.get(lp.person_id)?.name || 'Unknown',
    })),
    listLayerLinks: (pcoListLayerLinks || []).map(ll => ({ listId: ll.list_id, layerId: ll.layer_id })),
    departments: (departments || []).map(d => ({ id: d.id, name: d.name, color: d.color })),
    departmentMembers: departmentMembers || [],
    unconnectedStaff,
    unlinkedGroupTypes,
    unlinkedServiceTypes,
    unconnectedVolunteers,
    stats: { shepherdCount, groupCount, teamCount },
  })

  // Helper to create PCO-sourced node
  function mkPcoNode(
    personId: string, contextId: string, role: 'shepherd' | 'member',
    supervisorId: string | null, contextLabel: string, flockCount: number,
    filterMeta?: { groupTypeId?: string; serviceTypeId?: string },
  ) {
    const person = personMap.get(personId)!
    return {
      id: `${personId}::${contextId}`,
      personId,
      name: person?.name || 'Unknown',
      role,
      supervisorId,
      flockCount,
      lastCheckin: lastCheckin[personId] || null,
      isCurrentUser: false,
      isStaff: !!person?.is_staff || staffPersonIds.has(personId),
      isLeadPastor: !!person?.is_lead_pastor,
      contextLabel,
      warning: null,
      layerId: null,
      layerCategory: null,
      groupTypeId: filterMeta?.groupTypeId || null,
      serviceTypeId: filterMeta?.serviceTypeId || null,
    }
  }
}

// ════════════════════════════════════════════════════════════════
// POST: Manage tree assignments, oversight, layers
// ════════════════════════════════════════════════════════════════
export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, name, role, church_id')
    .eq('user_id', user.id)
    .single()

  if (!currentUser || !['super_admin', 'staff'].includes(currentUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const admin = createAdminClient()
  const churchId = currentUser.church_id

  // ── Save assignment (upsert person into manual hierarchy) ────
  if (body.action === 'save_assignment') {
    const { person_id, layer_id, supervisor_person_id, oversight: oversightEntries, is_lead_pastor } = body
    if (!person_id || !layer_id) {
      return NextResponse.json({ error: 'person_id and layer_id required' }, { status: 400 })
    }

    // Upsert assignment
    const { error: aErr } = await admin.from('tree_assignments')
      .upsert({
        person_id,
        layer_id,
        supervisor_person_id: supervisor_person_id || null,
        church_id: churchId,
      }, { onConflict: 'person_id,church_id' })
    if (aErr) return NextResponse.json({ error: aErr.message }, { status: 500 })

    // Update lead pastor flag
    if (is_lead_pastor !== undefined) {
      // Clear other lead pastors first if setting this one
      if (is_lead_pastor) {
        await admin.from('people').update({ is_lead_pastor: false }).eq('church_id', churchId!)
      }
      await admin.from('people').update({ is_lead_pastor }).eq('id', person_id)
    }

    // Update oversight entries (replace all for this person)
    if (oversightEntries !== undefined) {
      await admin.from('tree_oversight').delete().eq('person_id', person_id)
      if (Array.isArray(oversightEntries) && oversightEntries.length > 0) {
        const rows = oversightEntries.map((e: { context_type: string; context_id: string }) => ({
          person_id,
          context_type: e.context_type,
          context_id: e.context_id,
          church_id: churchId,
        }))
        const { error: oErr } = await admin.from('tree_oversight').insert(rows)
        if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 })
      }
    }

    // Mark as leader + staff if on elder/staff layer
    const { data: layer } = await admin.from('tree_layers').select('category').eq('id', layer_id).single()
    if (layer && ['elder', 'staff'].includes(layer.category)) {
      await admin.from('people').update({ is_leader: true, is_staff: true }).eq('id', person_id)
    } else {
      await admin.from('people').update({ is_leader: true }).eq('id', person_id)
    }

    return NextResponse.json({ success: true })
  }

  // ── Remove assignment ────────────────────────────────────────
  if (body.action === 'remove_assignment') {
    const { person_id } = body
    if (!person_id) return NextResponse.json({ error: 'person_id required' }, { status: 400 })

    await admin.from('tree_assignments').delete().eq('person_id', person_id).eq('church_id', churchId!)
    await admin.from('tree_oversight').delete().eq('person_id', person_id)
    // Also clear supervisor references pointing to this person
    await admin.from('tree_assignments')
      .update({ supervisor_person_id: null })
      .eq('supervisor_person_id', person_id)
      .eq('church_id', churchId!)

    return NextResponse.json({ success: true })
  }

  // ── Toggle lead pastor ───────────────────────────────────────
  if (body.action === 'toggle_lead_pastor') {
    const { person_id, enabled } = body
    if (!person_id) return NextResponse.json({ error: 'person_id required' }, { status: 400 })
    if (enabled) {
      await admin.from('people').update({ is_lead_pastor: false }).eq('church_id', churchId!)
    }
    await admin.from('people').update({ is_lead_pastor: enabled }).eq('id', person_id)
    return NextResponse.json({ success: true })
  }

  // ── Add sub-layer ────────────────────────────────────────────
  if (body.action === 'add_layer') {
    const { category, name } = body
    if (!category || !name) return NextResponse.json({ error: 'category and name required' }, { status: 400 })
    if (!['staff', 'volunteer'].includes(category)) {
      return NextResponse.json({ error: 'Can only add sub-layers to staff or volunteer' }, { status: 400 })
    }

    // Find max rank within this category to insert after
    const { data: existingLayers } = await admin.from('tree_layers')
      .select('rank').eq('church_id', churchId!).eq('category', category)
      .order('rank', { ascending: false }).limit(1)

    const baseRank = category === 'staff' ? 100 : 200
    const maxRank = existingLayers?.[0]?.rank || baseRank
    const newRank = maxRank + 10

    const { data: newLayer, error } = await admin.from('tree_layers')
      .insert({ church_id: churchId, name, category, rank: newRank })
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ layer: newLayer })
  }

  // ── Remove sub-layer ─────────────────────────────────────────
  if (body.action === 'remove_layer') {
    const { layer_id } = body
    if (!layer_id) return NextResponse.json({ error: 'layer_id required' }, { status: 400 })

    // Don't allow removing if it's the only layer of its category
    const { data: layer } = await admin.from('tree_layers').select('category').eq('id', layer_id).single()
    if (!layer) return NextResponse.json({ error: 'Layer not found' }, { status: 404 })

    const { count } = await admin.from('tree_layers')
      .select('id', { count: 'exact', head: true })
      .eq('church_id', churchId!).eq('category', layer.category)

    if ((count || 0) <= 1) {
      return NextResponse.json({ error: 'Cannot remove the last layer of this category' }, { status: 400 })
    }

    // Move assignments to the next layer in same category
    const { data: otherLayers } = await admin.from('tree_layers')
      .select('id').eq('church_id', churchId!).eq('category', layer.category)
      .neq('id', layer_id).order('rank').limit(1)

    if (otherLayers?.[0]) {
      await admin.from('tree_assignments')
        .update({ layer_id: otherLayers[0].id })
        .eq('layer_id', layer_id)
    }

    await admin.from('tree_layers').delete().eq('id', layer_id)
    return NextResponse.json({ success: true })
  }

  // ── Rename layer ─────────────────────────────────────────────
  if (body.action === 'rename_layer') {
    const { layer_id, name } = body
    if (!layer_id || !name) return NextResponse.json({ error: 'layer_id and name required' }, { status: 400 })
    await admin.from('tree_layers').update({ name }).eq('id', layer_id)
    return NextResponse.json({ success: true })
  }

  // ── Reorder people within a layer ────────────────────────────
  if (body.action === 'reorder') {
    const { order } = body // array of { person_id, sort_order }
    if (!Array.isArray(order)) return NextResponse.json({ error: 'order array required' }, { status: 400 })
    for (const item of order) {
      await admin.from('tree_assignments')
        .update({ sort_order: item.sort_order })
        .eq('person_id', item.person_id)
        .eq('church_id', churchId!)
    }
    return NextResponse.json({ success: true })
  }

  // ── Reorder layers within a category ─────────────────────────
  if (body.action === 'reorder_layers') {
    const { order } = body // array of { layer_id, rank }
    if (!Array.isArray(order)) return NextResponse.json({ error: 'order array required' }, { status: 400 })
    for (const item of order) {
      await admin.from('tree_layers')
        .update({ rank: item.rank })
        .eq('id', item.layer_id)
        .eq('church_id', churchId!)
    }
    return NextResponse.json({ success: true })
  }

  // ── Link a PCO list to a layer ──────────────────────────────
  if (body.action === 'link_list') {
    const { list_id, layer_id } = body
    if (!list_id || !layer_id) return NextResponse.json({ error: 'list_id and layer_id required' }, { status: 400 })
    const { error } = await admin.from('pco_list_layer_links')
      .upsert({ list_id, layer_id, church_id: churchId }, { onConflict: 'list_id,church_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Auto-rebuild assignments from lists
    await syncListAssignments(admin, churchId!)
    return NextResponse.json({ success: true })
  }

  // ── Save (replace) all metric buckets atomically ─────────────
  if (body.action === 'save_buckets') {
    const incoming = (body.buckets || []) as {
      label: string; fullName: string; color?: string | null; sortOrder?: number; layerIds?: string[]
    }[]
    // Validate: each layer can appear in at most one bucket
    const seenLayers = new Set<string>()
    for (const b of incoming) {
      for (const lid of b.layerIds || []) {
        if (seenLayers.has(lid)) return NextResponse.json({ error: 'A layer can only belong to one bucket' }, { status: 400 })
        seenLayers.add(lid)
      }
    }
    await admin.from('tree_metric_buckets').delete().eq('church_id', churchId!)
    for (let i = 0; i < incoming.length; i++) {
      const b = incoming[i]
      const { data: ins, error } = await admin.from('tree_metric_buckets').insert({
        label: b.label,
        full_name: b.fullName,
        color: b.color || null,
        sort_order: b.sortOrder ?? i,
        church_id: churchId,
      }).select().single()
      if (error || !ins) return NextResponse.json({ error: error?.message || 'insert failed' }, { status: 500 })
      if (b.layerIds && b.layerIds.length > 0) {
        const rows = b.layerIds.map(lid => ({ bucket_id: ins.id, layer_id: lid, church_id: churchId }))
        const { error: le } = await admin.from('tree_metric_bucket_layers').insert(rows)
        if (le) return NextResponse.json({ error: le.message }, { status: 500 })
      }
    }
    return NextResponse.json({ success: true })
  }

  // ── Add a connection between two person/layer appearances ──
  if (body.action === 'add_connection') {
    const { parent_person_id, parent_layer_id, child_person_id, child_layer_id } = body
    if (!parent_person_id || !parent_layer_id || !child_person_id || !child_layer_id) {
      return NextResponse.json({ error: 'parent and child person+layer required' }, { status: 400 })
    }
    if (parent_person_id === child_person_id && parent_layer_id === child_layer_id) {
      return NextResponse.json({ error: 'cannot connect a card to itself' }, { status: 400 })
    }
    // Rank check: parent must be strictly above (lower rank) than child
    const { data: layerRows } = await admin.from('tree_layers')
      .select('id, rank').eq('church_id', churchId!).in('id', [parent_layer_id, child_layer_id])
    const ranks = new Map((layerRows || []).map(l => [l.id, l.rank]))
    const pRank = ranks.get(parent_layer_id)
    const cRank = ranks.get(child_layer_id)
    if (pRank === undefined || cRank === undefined) {
      return NextResponse.json({ error: 'Unknown layer' }, { status: 400 })
    }
    if (pRank >= cRank) {
      return NextResponse.json({ error: 'Parent must be on a higher layer than child' }, { status: 400 })
    }
    const { error } = await admin.from('tree_connections').upsert({
      parent_person_id, parent_layer_id, child_person_id, child_layer_id, church_id: churchId,
    }, { onConflict: 'parent_person_id,parent_layer_id,child_person_id,child_layer_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // ── Remove a connection ─────────────────────────────────────
  if (body.action === 'remove_connection') {
    const { parent_person_id, parent_layer_id, child_person_id, child_layer_id } = body
    if (!parent_person_id || !parent_layer_id || !child_person_id || !child_layer_id) {
      return NextResponse.json({ error: 'parent and child person+layer required' }, { status: 400 })
    }
    await admin.from('tree_connections').delete()
      .eq('parent_person_id', parent_person_id)
      .eq('parent_layer_id', parent_layer_id)
      .eq('child_person_id', child_person_id)
      .eq('child_layer_id', child_layer_id)
      .eq('church_id', churchId!)
    return NextResponse.json({ success: true })
  }

  // ── Add a person to a layer directly (manual inclusion) ─────
  if (body.action === 'add_person_to_layer') {
    const { person_id, layer_id } = body
    if (!person_id || !layer_id) return NextResponse.json({ error: 'person_id and layer_id required' }, { status: 400 })
    // Clear any existing exclusion so they actually show up
    await admin.from('tree_layer_exclusions')
      .delete().eq('person_id', person_id).eq('layer_id', layer_id).eq('church_id', churchId!)
    const { error } = await admin.from('tree_layer_inclusions')
      .upsert({ person_id, layer_id, church_id: churchId }, { onConflict: 'person_id,layer_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // ── Create or update a Group/Team → (leader, member) layer mapping ──
  if (body.action === 'save_gt_mapping') {
    const { id, name, kind, leader_layer_id, member_layer_id, item_ids, auto_connect } = body
    if (!name || !kind || !['groups', 'teams'].includes(kind)) {
      return NextResponse.json({ error: 'name and kind (groups|teams) required' }, { status: 400 })
    }
    if (!leader_layer_id && !member_layer_id) {
      return NextResponse.json({ error: 'at least one of leader_layer_id or member_layer_id required' }, { status: 400 })
    }

    let mappingId = id as string | undefined
    if (mappingId) {
      const { error: uErr } = await admin.from('group_team_layer_mappings')
        .update({
          name, kind,
          leader_layer_id: leader_layer_id || null,
          member_layer_id: member_layer_id || null,
          auto_connect: !!auto_connect,
          updated_at: new Date().toISOString(),
        })
        .eq('id', mappingId).eq('church_id', churchId!)
      if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
    } else {
      const { data: ins, error: iErr } = await admin.from('group_team_layer_mappings')
        .insert({
          name, kind,
          leader_layer_id: leader_layer_id || null,
          member_layer_id: member_layer_id || null,
          auto_connect: !!auto_connect,
          church_id: churchId,
        })
        .select().single()
      if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
      mappingId = ins.id
    }

    // Replace item_ids
    await admin.from('group_team_layer_mapping_items').delete().eq('mapping_id', mappingId!)
    if (Array.isArray(item_ids) && item_ids.length > 0) {
      const rows = item_ids.map((iid: string) => ({ mapping_id: mappingId, item_id: iid, church_id: churchId }))
      const { error: itErr } = await admin.from('group_team_layer_mapping_items').insert(rows)
      if (itErr) return NextResponse.json({ error: itErr.message }, { status: 500 })
    }

    // Always wipe mapping-owned edges up-front so toggling auto_connect
    // off (or changing items) fully cleans up stale edges; the helper
    // will only re-create them if auto_connect is still true.
    await admin.from('tree_connections').delete().eq('source_mapping_id', mappingId!)
    try {
      const { regenerateAutoConnectEdgesForChurch } = await import('@/lib/tree-auto-connect')
      await regenerateAutoConnectEdgesForChurch(admin, churchId!, { onlyMappingId: mappingId! })
    } catch (e) {
      console.error('Auto-connect regeneration failed after save:', e)
    }

    return NextResponse.json({ success: true, id: mappingId })
  }

  // ── Delete a Group/Team mapping ─────────────────────────────
  if (body.action === 'delete_gt_mapping') {
    const { id } = body
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
    await admin.from('group_team_layer_mappings').delete().eq('id', id).eq('church_id', churchId!)
    return NextResponse.json({ success: true })
  }

  // ── Remove a person from a layer, smart:
  //   - if they were manually added (tree_layer_inclusions), delete that row
  //     (they disappear entirely; there's nothing to "restore")
  //   - otherwise soft-hide via tree_layer_exclusions
  if (body.action === 'remove_person_from_layer') {
    const { person_id, layer_id } = body
    if (!person_id || !layer_id) return NextResponse.json({ error: 'person_id and layer_id required' }, { status: 400 })
    const { data: inc } = await admin.from('tree_layer_inclusions')
      .select('id').eq('person_id', person_id).eq('layer_id', layer_id).eq('church_id', churchId!).maybeSingle()
    if (inc?.id) {
      await admin.from('tree_layer_inclusions').delete().eq('id', inc.id)
    } else {
      const { error } = await admin.from('tree_layer_exclusions')
        .upsert({ person_id, layer_id, church_id: churchId }, { onConflict: 'person_id,layer_id' })
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true, wasInclusion: !!inc?.id })
  }

  // ── Exclude a person from a layer (V2 soft-remove) ──────────
  if (body.action === 'exclude_person') {
    const { person_id, layer_id } = body
    if (!person_id || !layer_id) return NextResponse.json({ error: 'person_id and layer_id required' }, { status: 400 })
    const { error } = await admin.from('tree_layer_exclusions')
      .upsert({ person_id, layer_id, church_id: churchId }, { onConflict: 'person_id,layer_id' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ success: true })
  }

  // ── Re-include a person into a layer ────────────────────────
  if (body.action === 'include_person') {
    const { person_id, layer_id } = body
    if (!person_id || !layer_id) return NextResponse.json({ error: 'person_id and layer_id required' }, { status: 400 })
    await admin.from('tree_layer_exclusions')
      .delete().eq('person_id', person_id).eq('layer_id', layer_id).eq('church_id', churchId!)
    return NextResponse.json({ success: true })
  }

  // ── Unlink a PCO list from its layer ────────────────────────
  if (body.action === 'unlink_list') {
    const { list_id } = body
    if (!list_id) return NextResponse.json({ error: 'list_id required' }, { status: 400 })
    await admin.from('pco_list_layer_links').delete().eq('list_id', list_id).eq('church_id', churchId!)
    // Auto-rebuild assignments from lists
    await syncListAssignments(admin, churchId!)
    return NextResponse.json({ success: true })
  }

  // ── Add department ───────────────────────────────────────────
  if (body.action === 'add_department') {
    const { name } = body
    if (!name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })
    const { data: dept, error } = await admin.from('departments')
      .insert({ name: name.trim(), church_id: churchId })
      .select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ department: dept })
  }

  // ── Remove department ──────────────────────────────────────
  if (body.action === 'remove_department') {
    const { department_id } = body
    if (!department_id) return NextResponse.json({ error: 'department_id required' }, { status: 400 })
    // Also remove oversight entries referencing this department
    await admin.from('tree_oversight').delete()
      .eq('context_type', 'department').eq('context_id', department_id)
    await admin.from('departments').delete().eq('id', department_id).eq('church_id', churchId!)
    return NextResponse.json({ success: true })
  }

  // ── Rename department ──────────────────────────────────────
  if (body.action === 'rename_department') {
    const { department_id, name } = body
    if (!department_id || !name?.trim()) return NextResponse.json({ error: 'department_id and name required' }, { status: 400 })
    await admin.from('departments').update({ name: name.trim() }).eq('id', department_id).eq('church_id', churchId!)
    return NextResponse.json({ success: true })
  }

  // ── Set department members (replace all for a department) ───
  if (body.action === 'set_department_members') {
    const { department_id, person_ids } = body
    if (!department_id) return NextResponse.json({ error: 'department_id required' }, { status: 400 })
    // Delete existing members
    await admin.from('department_members').delete().eq('department_id', department_id)
    // Insert new members
    if (Array.isArray(person_ids) && person_ids.length > 0) {
      const rows = person_ids.map((pid: string) => ({
        department_id, person_id: pid, church_id: churchId,
      }))
      const { error } = await admin.from('department_members').insert(rows)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  // ── Rebuild assignments from PCO lists ──────────────────────
  if (body.action === 'sync_list_assignments') {
    await syncListAssignments(admin, churchId!)
    return NextResponse.json({ success: true })
  }

  // ── Bulk save layers (v2 layer management) ──────────────────
  if (body.action === 'save_layers_v2') {
    const { layers: layerList } = body
    if (!Array.isArray(layerList)) return NextResponse.json({ error: 'layers array required' }, { status: 400 })

    // Get existing layers
    const { data: existing } = await admin.from('tree_layers')
      .select('id').eq('church_id', churchId!)
    const existingIds = new Set((existing || []).map((l: any) => l.id))

    // Determine which to keep, add, remove
    const incomingIds = new Set(layerList.filter((l: any) => l.id).map((l: any) => l.id))
    const toRemove = [...existingIds].filter(id => !incomingIds.has(id))

    // Remove deleted layers (move their assignments to the first remaining layer)
    if (toRemove.length > 0) {
      const firstKeepId = layerList.find((l: any) => l.id)?.id
      if (firstKeepId) {
        for (const removeId of toRemove) {
          await admin.from('tree_assignments')
            .update({ layer_id: firstKeepId })
            .eq('layer_id', removeId).eq('church_id', churchId!)
        }
      }
      for (const removeId of toRemove) {
        await admin.from('pco_list_layer_links').delete().eq('layer_id', removeId).eq('church_id', churchId!)
      }
      await admin.from('tree_layers').delete().in('id', toRemove)
    }

    // Upsert layers with rank = index * 10
    const categoryMap: Record<string, string> = {
      'Elder': 'elder', 'Staff': 'staff', 'Volunteer': 'volunteer', 'Congregation': 'people',
    }
    const resultLayers: { id: string; name: string; rank: number; is_congregational: boolean }[] = []
    for (let i = 0; i < layerList.length; i++) {
      const l = layerList[i]
      const rank = i * 10
      const category = categoryMap[l.name] || l.category || 'custom'
      const isCong = !!l.is_congregational
      if (l.id && existingIds.has(l.id)) {
        await admin.from('tree_layers')
          .update({ name: l.name, rank, category, is_congregational: isCong })
          .eq('id', l.id)
        resultLayers.push({ id: l.id, name: l.name, rank, is_congregational: isCong })
      } else {
        const { data: newLayer } = await admin.from('tree_layers')
          .insert({ name: l.name, rank, category, is_congregational: isCong, church_id: churchId })
          .select('id, name, rank, is_congregational')
          .single()
        if (newLayer) resultLayers.push(newLayer)
      }
    }

    await syncListAssignments(admin, churchId!)
    return NextResponse.json({ success: true, layers: resultLayers })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

// ════════════════════════════════════════════════════════════════
// DELETE: Remove person from tree
// ════════════════════════════════════════════════════════════════
export async function DELETE(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, name, role, church_id')
    .eq('user_id', user.id)
    .single()

  if (!currentUser || !['super_admin', 'staff'].includes(currentUser.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await request.json()
  const { person_id } = body
  if (!person_id) return NextResponse.json({ error: 'person_id required' }, { status: 400 })

  const admin = createAdminClient()

  // Remove assignment + oversight
  await admin.from('tree_assignments').delete().eq('person_id', person_id).eq('church_id', currentUser.church_id!)
  await admin.from('tree_oversight').delete().eq('person_id', person_id)

  // Clear supervisor references
  await admin.from('tree_assignments')
    .update({ supervisor_person_id: null })
    .eq('supervisor_person_id', person_id)
    .eq('church_id', currentUser.church_id!)

  return NextResponse.json({ success: true })
}
