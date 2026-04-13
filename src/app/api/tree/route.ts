import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

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
  ] = await Promise.all([
    admin.from('tree_layers').select('id, name, category, rank')
      .eq('church_id', churchId!).order('rank'),
    admin.from('tree_assignments').select('id, person_id, layer_id, supervisor_person_id, sort_order, church_id')
      .eq('church_id', churchId!).order('sort_order'),
    admin.from('tree_oversight').select('id, person_id, context_type, context_id')
      .eq('church_id', churchId!),
    admin.from('group_memberships').select('person_id, group_id, role, is_active')
      .eq('church_id', churchId!).eq('is_active', true).range(0, 49999),
    admin.from('groups').select('id, name, is_active, group_type_id, pco_group_type_id')
      .eq('church_id', churchId!).eq('is_active', true).range(0, 49999),
    admin.from('team_memberships').select('person_id, team_id, role, is_active')
      .eq('church_id', churchId!).eq('is_active', true).range(0, 49999),
    admin.from('teams').select('id, name, is_active, service_type_id, pco_service_type_id')
      .eq('church_id', churchId!).eq('is_active', true).range(0, 49999),
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
  ])

  // ── Phase 2: Collect needed person IDs ───────────────────────
  const neededPersonIds = new Set<string>()
  for (const a of assignments || []) {
    neededPersonIds.add(a.person_id)
    if (a.supervisor_person_id) neededPersonIds.add(a.supervisor_person_id)
  }
  for (const gm of groupMemberships || []) neededPersonIds.add(gm.person_id)
  for (const tm of teamMemberships || []) neededPersonIds.add(tm.person_id)
  if (currentUser?.person_id) neededPersonIds.add(currentUser.person_id)

  // Batch fetch people
  const personIds = [...neededPersonIds]
  const people: { id: string; name: string; pco_id: string | null; status: string; membership_type: string; is_staff: boolean; is_lead_pastor: boolean }[] = []
  for (let i = 0; i < personIds.length; i += 500) {
    const batch = personIds.slice(i, i + 500)
    const { data } = await admin.from('people')
      .select('id, name, pco_id, status, membership_type, is_staff, is_lead_pastor')
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

    // Auto-pool unconnected staff/volunteers below their parent layer
    if (!supervisorId && !person.is_lead_pastor && layer.category !== 'elder') {
      isUnconnected = true
      if (layer.category === 'staff') {
        // Staff without supervisor → pool under Lead Pastor (or elder placeholder)
        supervisorId = leadPastorNodeId || `placeholder-${sortedLayers.find(l => l.category === 'elder')?.id}`
      } else if (layer.category === 'volunteer') {
        // Volunteer without supervisor → pool under first staff (or staff placeholder)
        if (firstStaffAssignment) {
          supervisorId = `${firstStaffAssignment.person_id}::layer-${firstStaffAssignment.layer_id}`
        } else {
          supervisorId = firstStaffLayer ? `placeholder-${firstStaffLayer.id}` : null
        }
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
  // Rules:
  //  1. Layer-level placeholders: one per layer (to show empty layers)
  //     - Elder placeholder: root level
  //     - Staff placeholder: under Lead Pastor (or elder placeholder if no LP)
  //     - Volunteer placeholder: under first staff (or staff placeholder)
  //  2. Per-person placeholders: Lead Pastor and every Staff member
  //     ALWAYS get a "+" child node, even if they already have children.
  //     This lets admins add reports under any staff/LP.
  //  3. Non-LP elders do NOT get children in the manual hierarchy.
  //

  const mkPlaceholder = (id: string, label: string, layerId: string, layerCategory: string, supervisorId: string | null, supervisorPersonId?: string) => ({
    id,
    personId: undefined,
    name: `+ Add ${label}`,
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

  // Layer-level placeholders: only for layers with NO assigned people
  for (const layer of sortedLayers) {
    const hasAssignments = (assignmentsByLayer.get(layer.id) || []).length > 0
    if (hasAssignments) continue // people exist on this layer, no placeholder needed

    let layerPlaceholderSupervisor: string | null = null
    if (layer.category === 'staff') {
      layerPlaceholderSupervisor = leadPastorNodeId || `placeholder-${sortedLayers.find(l => l.category === 'elder')?.id}`
    } else if (layer.category === 'volunteer') {
      if (firstStaffAssignment) {
        layerPlaceholderSupervisor = `${firstStaffAssignment.person_id}::layer-${firstStaffAssignment.layer_id}`
      } else {
        layerPlaceholderSupervisor = firstStaffLayer ? `placeholder-${firstStaffLayer.id}` : null
      }
    }

    nodes.push(mkPlaceholder(
      `placeholder-${layer.id}`, layer.name, layer.id, layer.category,
      layerPlaceholderSupervisor,
    ))
  }

  // Per-person placeholders: Lead Pastor + all Staff get ONE "+" child
  // pointing to the next layer rank below their own layer
  for (const a of (assignments || []) as AssignmentRow[]) {
    const layer = layerMap.get(a.layer_id)
    if (!layer) continue
    const person = personMap.get(a.person_id)
    const isLP = !!person?.is_lead_pastor
    const isStaff = layer.category === 'staff'

    if (isLP || isStaff) {
      const parentNodeId = `${a.person_id}::layer-${a.layer_id}`
      // Find the next layer below this person's layer rank
      const childLayer = sortedLayers.find(l => l.rank > layer.rank)
      if (childLayer) {
        nodes.push(mkPlaceholder(
          `placeholder-under-${a.person_id}`,
          childLayer.name,
          childLayer.id,
          childLayer.category,
          parentNodeId,
          a.person_id,
        ))
      }
    }
  }

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
  const assignmentMap: Record<string, { layerId: string; layerName: string; layerCategory: string; supervisorPersonId: string | null; sortOrder: number }> = {}
  for (const a of assignments || []) {
    const layer = layerMap.get(a.layer_id)
    assignmentMap[a.person_id] = {
      layerId: a.layer_id,
      layerName: layer?.name || 'Unknown',
      layerCategory: layer?.category || 'volunteer',
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

  return NextResponse.json({
    nodes,
    coLeaderLinks,
    layers: layers || [],
    assignments: assignmentMap,
    oversightMap: oversightMapOut,
    currentUserRole: currentUser?.role,
    groupTypes: (groupTypes || []).map(gt => ({ id: gt.id, name: gt.name, is_tracked: gt.is_tracked })),
    serviceTypes: (serviceTypes || []).map(st => ({ id: st.id, name: st.name, is_tracked: (st as any).is_tracked })),
    pcoLists: (pcoLists || []).map(l => ({ id: l.id, name: l.name, totalPeople: l.total_people })),
    listLayerLinks: (pcoListLayerLinks || []).map(ll => ({ listId: ll.list_id, layerId: ll.layer_id })),
    departments: (departments || []).map(d => ({ id: d.id, name: d.name, color: d.color })),
    departmentMembers: departmentMembers || [],
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
