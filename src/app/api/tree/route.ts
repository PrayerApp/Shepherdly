import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextResponse } from 'next/server'

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

  // Phase 1: Fetch memberships, config, and relationships (NOT people yet)
  const [
    { data: groupMemberships },
    { data: groups },
    { data: teamMemberships },
    { data: teams },
    { data: manualRelationships },
    { data: recentReports },
    { data: groupTypes },
    { data: serviceTypes },
    { data: leaderPeople },
  ] = await Promise.all([
    admin.from('group_memberships').select('person_id, group_id, role, is_active')
      .eq('church_id', churchId!).eq('is_active', true)
      .range(0, 49999),
    admin.from('groups').select('id, name, is_active, group_type_id, pco_group_type_id')
      .eq('church_id', churchId!).eq('is_active', true)
      .range(0, 49999),
    admin.from('team_memberships').select('person_id, team_id, role, is_active')
      .eq('church_id', churchId!).eq('is_active', true)
      .range(0, 49999),
    admin.from('teams').select('id, name, is_active, service_type_id, pco_service_type_id')
      .eq('church_id', churchId!).eq('is_active', true)
      .range(0, 49999),
    admin.from('shepherding_relationships').select('shepherd_id, person_id, context_type, context_id')
      .eq('is_active', true),
    admin.from('check_in_reports').select('leader_id, created_at')
      .order('created_at', { ascending: false }),
    admin.from('group_types').select('id, pco_id, name, is_tracked')
      .eq('church_id', churchId!).order('name'),
    admin.from('service_types').select('id, pco_id, name, is_tracked')
      .eq('church_id', churchId!).order('name'),
    admin.from('people').select('id, name')
      .eq('church_id', churchId!).eq('is_leader', true),
  ])

  // Phase 2: Collect all person IDs we actually need for the tree
  const neededPersonIds = new Set<string>()
  for (const gm of groupMemberships || []) { if (gm.person_id) neededPersonIds.add(gm.person_id) }
  for (const tm of teamMemberships || []) { if (tm.person_id) neededPersonIds.add(tm.person_id) }
  for (const r of manualRelationships || []) {
    if (r.shepherd_id) neededPersonIds.add(r.shepherd_id)
    if (r.person_id) neededPersonIds.add(r.person_id)
  }
  for (const lp of leaderPeople || []) { neededPersonIds.add(lp.id) }
  // Add the current user's person
  if (currentUser?.person_id) neededPersonIds.add(currentUser.person_id)

  // Fetch only needed people in batches (avoids 33K+ row limit issue)
  const personIds = [...neededPersonIds]
  const people: { id: string; name: string; pco_id: string | null; status: string; membership_type: string }[] = []
  for (let i = 0; i < personIds.length; i += 500) {
    const batch = personIds.slice(i, i + 500)
    const { data } = await admin.from('people')
      .select('id, name, pco_id, status, membership_type')
      .in('id', batch)
    if (data) people.push(...data)
  }

  if (people.length === 0) {
    return NextResponse.json({ nodes: [], currentUserRole: currentUser?.role, groupTypes: [], serviceTypes: [] })
  }

  const personMap = new Map(people.map(p => [p.id, p]))
  const groupMap = new Map((groups || []).map(g => [g.id, g]))
  const teamMap = new Map((teams || []).map(t => [t.id, t]))
  const groupTypeMap = new Map((groupTypes || []).map(gt => [gt.id, gt]))
  const groupTypePcoMap = new Map((groupTypes || []).map(gt => [gt.pco_id, gt]))

  // Build sets of tracked type IDs for filtering
  const trackedGroupTypeIds = new Set((groupTypes || []).filter(gt => gt.is_tracked).map(gt => gt.id))
  const trackedGroupTypePcoIds = new Set((groupTypes || []).filter(gt => gt.is_tracked).map(gt => gt.pco_id))
  const trackedServiceTypeIds = new Set((serviceTypes || []).filter(st => st.is_tracked).map(st => st.id))
  const trackedServiceTypePcoIds = new Set((serviceTypes || []).filter(st => st.is_tracked).map(st => st.pco_id))

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

  function getGroupTypeName(group: { group_type_id?: string | null; pco_group_type_id?: string | null }): string | null {
    if (group.group_type_id) {
      const gt = groupTypeMap.get(group.group_type_id)
      if (gt) return gt.name
    }
    if (group.pco_group_type_id) {
      const gt = groupTypePcoMap.get(group.pco_group_type_id)
      if (gt) return gt.name
    }
    return null
  }

  const serviceTypeMap = new Map((serviceTypes || []).map(st => [st.id, st]))
  const serviceTypePcoMap = new Map((serviceTypes || []).map(st => [st.pco_id, st]))
  function getServiceTypeName(team: { service_type_id?: string | null; pco_service_type_id?: string | null }): string | null {
    if (team.service_type_id) {
      const st = serviceTypeMap.get(team.service_type_id)
      if (st) return st.name
    }
    if (team.pco_service_type_id) {
      const st = serviceTypePcoMap.get(team.pco_service_type_id)
      if (st) return st.name
    }
    return null
  }

  // Last check-in per person
  const lastCheckin: Record<string, string> = {}
  recentReports?.forEach(r => {
    if (!lastCheckin[r.leader_id]) lastCheckin[r.leader_id] = r.created_at
  })

  // Index memberships by group/team
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

  // ── Build PERSON-BASED tree ──────────────────────────────────
  //
  // Hierarchy (top to bottom):
  //   1. Assigned shepherds (from shepherding_relationships with context_type
  //      'group_type' or 'service_type') — these are root-level overseers
  //   2. Group/team leaders (from group/team memberships with role=leader)
  //   3. Group/team members (non-leaders)
  //
  // People can appear multiple times (once per group/team they belong to).
  // Each node gets a compound ID: personId::contextId

  const nodes: any[] = []
  const coLeaderLinks: { from: string; to: string }[] = []  // horizontal links between co-leaders

  const mkNode = (
    personId: string, contextId: string, role: 'shepherd' | 'member',
    supervisorId: string | null, contextLabel: string, flockCount: number,
  ) => {
    const person = personMap.get(personId)!
    return {
      id: `${personId}::${contextId}`,
      personId,
      name: person.name || 'Unknown',
      role,
      nodeType: 'person' as const,
      supervisorId,
      flockCount,
      lastCheckin: lastCheckin[personId] || null,
      isCurrentUser: false,
      contextLabel,
      warning: null,
    }
  }

  // ── Index shepherding_relationships by context ───────────────
  // context_type = 'group_type' → shepherd oversees all groups of that type
  // context_type = 'service_type' → shepherd oversees all teams of that type
  // context_type = 'manual' → direct 1:1 shepherd→person
  type ShepherdRel = { shepherd_id: string; person_id: string; context_type: string; context_id: string | null }
  const typedRelationships = (manualRelationships || []) as ShepherdRel[]

  // Map: group_type_id → shepherd person IDs who oversee it
  const groupTypeShepherds = new Map<string, Set<string>>()
  // Map: service_type_id → shepherd person IDs who oversee it
  const serviceTypeShepherds = new Map<string, Set<string>>()
  // Manual 1:1 relationships
  const manualRels: ShepherdRel[] = []

  for (const r of typedRelationships) {
    if (!personMap.has(r.shepherd_id)) continue
    if (r.context_type === 'group_type' && r.context_id) {
      if (!groupTypeShepherds.has(r.context_id)) groupTypeShepherds.set(r.context_id, new Set())
      groupTypeShepherds.get(r.context_id)!.add(r.shepherd_id)
    } else if (r.context_type === 'service_type' && r.context_id) {
      if (!serviceTypeShepherds.has(r.context_id)) serviceTypeShepherds.set(r.context_id, new Set())
      serviceTypeShepherds.get(r.context_id)!.add(r.shepherd_id)
    } else if (r.context_type === 'manual') {
      if (personMap.has(r.person_id) && r.shepherd_id !== r.person_id) {
        manualRels.push(r)
      }
    }
  }

  // Resolve group → its group_type_id (use UUID first, fallback to pco_id lookup)
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

  // ── Process Groups (only tracked group types) ─────────────
  for (const [groupId, members] of groupMembers) {
    const group = groupMap.get(groupId)
    if (!group) continue
    if (!isGroupTracked(group)) continue

    const validMembers = members.filter(m => personMap.has(m.personId))
    if (validMembers.length === 0) continue

    const groupTypeName = getGroupTypeName(group)
    const contextLabel = groupTypeName ? `${groupTypeName}: ${group.name}` : group.name || 'Group'
    const contextId = `group-${groupId}`

    // Check if there's an assigned shepherd over this group's type
    const gtId = getGroupTypeId(group)
    const typeShepherdIds = gtId ? groupTypeShepherds.get(gtId) : null

    const leaders = validMembers.filter(m => /leader|co.?leader/i.test(m.role))
    const nonLeaders = validMembers.filter(m => !/leader|co.?leader/i.test(m.role))

    // Determine the supervisorId for leaders in this group
    let leaderSupervisorId: string | null = null
    if (typeShepherdIds && typeShepherdIds.size > 0) {
      // There are assigned shepherds over this group type — leaders report to first one
      const firstShepherd = [...typeShepherdIds][0]
      const shepherdContextId = `gt-shepherd-${gtId}`
      leaderSupervisorId = `${firstShepherd}::${shepherdContextId}`

      // Ensure the type-shepherd node exists
      if (!nodes.find(n => n.id === leaderSupervisorId)) {
        const gtName = groupTypeName || 'Groups'
        nodes.push(mkNode(firstShepherd, shepherdContextId, 'shepherd', null, `Over ${gtName}`, 0))
      }
    }

    // Co-leader logic: ALL members go under the FIRST leader.
    // Additional co-leaders are siblings at the same level, linked via coLeaderLinks.
    // All co-leaders show the full flock count (shared responsibility).
    const effectiveLeaders = leaders.filter(l => !typeShepherdIds?.has(l.personId))

    if (effectiveLeaders.length > 0) {
      const primaryLeader = effectiveLeaders[0]
      const primaryNodeId = `${primaryLeader.personId}::${contextId}`

      // Create leader nodes — all at same level
      for (const leader of effectiveLeaders) {
        nodes.push(mkNode(
          leader.personId, contextId, 'shepherd', leaderSupervisorId, contextLabel,
          nonLeaders.length,  // full count — co-leaders share the flock
        ))
      }

      // Link co-leaders with horizontal connectors
      for (let i = 1; i < effectiveLeaders.length; i++) {
        coLeaderLinks.push({
          from: primaryNodeId,
          to: `${effectiveLeaders[i].personId}::${contextId}`,
        })
      }

      // ALL members go under the first leader
      for (const m of nonLeaders) {
        nodes.push(mkNode(m.personId, contextId, 'member', primaryNodeId, contextLabel, 0))
      }
    } else if (leaderSupervisorId) {
      // All leaders were type-shepherds, put members directly under type-shepherd
      for (const m of nonLeaders) {
        nodes.push(mkNode(m.personId, contextId, 'member', leaderSupervisorId, contextLabel, 0))
      }
    } else {
      // No leaders at all — members appear as roots
      for (const m of validMembers) {
        nodes.push(mkNode(m.personId, contextId, 'member', null, contextLabel, 0))
      }
    }
  }

  // Update flock counts for group-type shepherds
  for (const [gtId, shepherdIds] of groupTypeShepherds) {
    for (const sid of shepherdIds) {
      const shepherdContextId = `gt-shepherd-${gtId}`
      const nodeId = `${sid}::${shepherdContextId}`
      const sNode = nodes.find(n => n.id === nodeId)
      if (sNode) {
        sNode.flockCount = nodes.filter(n => n.supervisorId === nodeId).length
      }
    }
  }

  // ── Process Teams (only tracked service types) ────────────
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
    const typeShepherdIds = stId ? serviceTypeShepherds.get(stId) : null

    const leaders = validMembers.filter(m => /leader|co.?leader/i.test(m.role))
    const nonLeaders = validMembers.filter(m => !/leader|co.?leader/i.test(m.role))

    let leaderSupervisorId: string | null = null
    if (typeShepherdIds && typeShepherdIds.size > 0) {
      const firstShepherd = [...typeShepherdIds][0]
      const shepherdContextId = `st-shepherd-${stId}`
      leaderSupervisorId = `${firstShepherd}::${shepherdContextId}`

      if (!nodes.find(n => n.id === leaderSupervisorId)) {
        const stName = serviceTypeName || 'Teams'
        nodes.push(mkNode(firstShepherd, shepherdContextId, 'shepherd', null, `Over ${stName}`, 0))
      }
    }

    const effectiveLeaders = leaders.filter(l => !typeShepherdIds?.has(l.personId))

    if (effectiveLeaders.length > 0) {
      const primaryLeader = effectiveLeaders[0]
      const primaryNodeId = `${primaryLeader.personId}::${contextId}`

      for (const leader of effectiveLeaders) {
        nodes.push(mkNode(
          leader.personId, contextId, 'shepherd', leaderSupervisorId, contextLabel,
          nonLeaders.length,
        ))
      }

      for (let i = 1; i < effectiveLeaders.length; i++) {
        coLeaderLinks.push({
          from: primaryNodeId,
          to: `${effectiveLeaders[i].personId}::${contextId}`,
        })
      }

      for (const m of nonLeaders) {
        nodes.push(mkNode(m.personId, contextId, 'member', primaryNodeId, contextLabel, 0))
      }
    } else if (leaderSupervisorId) {
      for (const m of nonLeaders) {
        nodes.push(mkNode(m.personId, contextId, 'member', leaderSupervisorId, contextLabel, 0))
      }
    } else {
      for (const m of validMembers) {
        nodes.push(mkNode(m.personId, contextId, 'member', null, contextLabel, 0))
      }
    }
  }

  // Update flock counts for service-type shepherds
  for (const [stId, shepherdIds] of serviceTypeShepherds) {
    for (const sid of shepherdIds) {
      const shepherdContextId = `st-shepherd-${stId}`
      const nodeId = `${sid}::${shepherdContextId}`
      const sNode = nodes.find(n => n.id === nodeId)
      if (sNode) {
        sNode.flockCount = nodes.filter(n => n.supervisorId === nodeId).length
      }
    }
  }

  // ── Manual 1:1 shepherding relationships ──────────────────
  const manualShepherdIds = new Set<string>()
  for (const r of manualRels) {
    if (!manualShepherdIds.has(r.shepherd_id)) {
      manualShepherdIds.add(r.shepherd_id)
      nodes.push(mkNode(r.shepherd_id, 'manual', 'shepherd', null, 'Manual Assignment', 0))
    }

    const shepherdTreeId = `${r.shepherd_id}::manual`
    nodes.push(mkNode(r.person_id, `manual-${r.shepherd_id}`, 'member', shepherdTreeId, 'Manual Assignment', 0))

    const shepherdNode = nodes.find(n => n.id === shepherdTreeId)
    if (shepherdNode) shepherdNode.flockCount++
  }

  // ── Root leaders without any group/team/manual context ────
  const peopleInTree = new Set<string>()
  for (const n of nodes) { if (n.personId) peopleInTree.add(n.personId) }

  for (const lp of leaderPeople || []) {
    if (!peopleInTree.has(lp.id)) {
      nodes.push({
        id: `${lp.id}::leader-root`,
        personId: lp.id,
        name: lp.name || 'Unknown',
        role: 'shepherd',
        nodeType: 'person',
        supervisorId: null,
        flockCount: 0,
        lastCheckin: lastCheckin[lp.id] || null,
        isCurrentUser: false,
        contextLabel: 'Leader',
        warning: null,
      })
    }
  }

  // ── Mark current user (all appearances) ──────────────────
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

  // Count stats
  const shepherdCount = new Set(nodes.filter(n => n.role === 'shepherd').map(n => n.personId)).size
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

  return NextResponse.json({
    nodes,
    coLeaderLinks,
    currentUserRole: currentUser?.role,
    groupTypes: (groupTypes || []).map(gt => ({ id: gt.id, name: gt.name, is_tracked: gt.is_tracked })),
    serviceTypes: (serviceTypes || []).map(st => ({ id: st.id, name: st.name, is_tracked: (st as any).is_tracked })),
    stats: { shepherdCount, groupCount, teamCount },
  })
}

// POST: Bulk assign shepherd to all members of a group_type or service_type
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
  const { action, shepherd_id, group_type_id, service_type_id } = body

  if (action !== 'bulk_assign' || !shepherd_id) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const admin = createAdminClient()
  const churchId = currentUser.church_id

  let memberPersonIds: string[] = []

  if (group_type_id) {
    const { data: groups } = await admin.from('groups')
      .select('id')
      .eq('church_id', churchId!)
      .eq('group_type_id', group_type_id)
      .eq('is_active', true)

    if (groups && groups.length > 0) {
      const groupIds = groups.map(g => g.id)
      const { data: memberships } = await admin.from('group_memberships')
        .select('person_id')
        .eq('church_id', churchId!)
        .eq('is_active', true)
        .in('group_id', groupIds)
        .range(0, 49999)

      memberPersonIds = [...new Set((memberships || []).map(m => m.person_id))]
    }
  } else if (service_type_id) {
    const { data: teams } = await admin.from('teams')
      .select('id')
      .eq('church_id', churchId!)
      .eq('service_type_id', service_type_id)
      .eq('is_active', true)

    if (teams && teams.length > 0) {
      const teamIds = teams.map(t => t.id)
      const { data: memberships } = await admin.from('team_memberships')
        .select('person_id')
        .eq('church_id', churchId!)
        .eq('is_active', true)
        .in('team_id', teamIds)
        .range(0, 49999)

      memberPersonIds = [...new Set((memberships || []).map(m => m.person_id))]
    }
  } else {
    return NextResponse.json({ error: 'Must provide group_type_id or service_type_id' }, { status: 400 })
  }

  memberPersonIds = memberPersonIds.filter(id => id !== shepherd_id)

  if (memberPersonIds.length === 0) {
    return NextResponse.json({ message: 'No members found', count: 0 })
  }

  const contextType = group_type_id ? 'group_type' : 'service_type'
  const contextId = group_type_id || service_type_id

  const rows = memberPersonIds.map(personId => ({
    shepherd_id,
    person_id: personId,
    context_type: contextType,
    context_id: contextId,
    is_active: true,
    church_id: churchId,
  }))

  let created = 0
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500)
    const { error } = await admin.from('shepherding_relationships')
      .upsert(batch, { onConflict: 'shepherd_id,person_id,context_type,context_id' })
    if (!error) created += batch.length
  }

  return NextResponse.json({ message: `Assigned ${created} members`, count: created })
}

// DELETE: Remove a person from the tree (manual assignments only — not PCO data)
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

  if (!person_id) {
    return NextResponse.json({ error: 'person_id required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Remove is_leader flag
  await admin.from('people')
    .update({ is_leader: false })
    .eq('id', person_id)
    .eq('church_id', currentUser.church_id!)

  // Remove all shepherding_relationships where this person is shepherd OR sheep
  await admin.from('shepherding_relationships')
    .delete()
    .eq('shepherd_id', person_id)

  await admin.from('shepherding_relationships')
    .delete()
    .eq('person_id', person_id)

  return NextResponse.json({ success: true })
}
