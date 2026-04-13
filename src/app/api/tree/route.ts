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

  // Parallel fetch all needed data (use range to bypass 1000-row default)
  const [
    { data: people },
    { data: groupMemberships },
    { data: groups },
    { data: teamMemberships },
    { data: teams },
    { data: manualRelationships },
    { data: recentReports },
    { data: groupTypes },
    { data: serviceTypes },
  ] = await Promise.all([
    admin.from('people').select('id, name, pco_id, status, membership_type')
      .eq('church_id', churchId!)
      .not('name', 'like', '\\_%').not('name', 'like', '-%')
      .neq('membership_type', 'SYSTEM USE - Do Not Delete')
      .range(0, 49999),
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
    admin.from('shepherding_relationships').select('shepherd_id, person_id, context_type')
      .eq('is_active', true),
    admin.from('check_in_reports').select('leader_id, created_at')
      .order('created_at', { ascending: false }),
    admin.from('group_types').select('id, pco_id, name, is_tracked')
      .eq('church_id', churchId!).order('name'),
    admin.from('service_types').select('id, pco_id, name, is_tracked')
      .eq('church_id', churchId!).order('name'),
  ])

  if (!people || people.length === 0) {
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
  // Structure: Leaders are roots (per group/team), members hang under them.
  // People can appear multiple times (once per group/team they belong to).
  // Each node gets a compound ID: personId::contextId
  const nodes: any[] = []

  const personNode = (
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

    const leaders = validMembers.filter(m => /leader|co.?leader/i.test(m.role))
    const nonLeaders = validMembers.filter(m => !/leader|co.?leader/i.test(m.role))

    if (leaders.length > 0) {
      // Leaders are root nodes for this group context
      for (const leader of leaders) {
        nodes.push(personNode(
          leader.personId, contextId, 'shepherd', null, contextLabel,
          Math.ceil(nonLeaders.length / leaders.length),
        ))
      }
      // Distribute members round-robin among leaders
      for (let i = 0; i < nonLeaders.length; i++) {
        const m = nonLeaders[i]
        const assignedLeader = leaders[i % leaders.length]
        const leaderNodeId = `${assignedLeader.personId}::${contextId}`
        nodes.push(personNode(m.personId, contextId, 'member', leaderNodeId, contextLabel, 0))
      }
    } else {
      // No leaders — all members appear as roots
      for (const m of validMembers) {
        nodes.push(personNode(m.personId, contextId, 'member', null, contextLabel, 0))
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

    const leaders = validMembers.filter(m => /leader|co.?leader/i.test(m.role))
    const nonLeaders = validMembers.filter(m => !/leader|co.?leader/i.test(m.role))

    if (leaders.length > 0) {
      for (const leader of leaders) {
        nodes.push(personNode(
          leader.personId, contextId, 'shepherd', null, contextLabel,
          Math.ceil(nonLeaders.length / leaders.length),
        ))
      }
      for (let i = 0; i < nonLeaders.length; i++) {
        const m = nonLeaders[i]
        const assignedLeader = leaders[i % leaders.length]
        const leaderNodeId = `${assignedLeader.personId}::${contextId}`
        nodes.push(personNode(m.personId, contextId, 'member', leaderNodeId, contextLabel, 0))
      }
    } else {
      for (const m of validMembers) {
        nodes.push(personNode(m.personId, contextId, 'member', null, contextLabel, 0))
      }
    }
  }

  // ── Manual shepherding relationships ──────────────────────
  const manualShepherdIds = new Set<string>()
  for (const r of manualRelationships || []) {
    if (!personMap.has(r.shepherd_id) || !personMap.has(r.person_id)) continue
    if (r.shepherd_id === r.person_id) continue

    // Add shepherd as root if not already added for manual context
    if (!manualShepherdIds.has(r.shepherd_id)) {
      manualShepherdIds.add(r.shepherd_id)
      const person = personMap.get(r.shepherd_id)!
      nodes.push({
        id: `${r.shepherd_id}::manual`,
        personId: r.shepherd_id,
        name: person.name || 'Unknown',
        role: 'shepherd',
        nodeType: 'person',
        supervisorId: null,
        flockCount: 0,
        lastCheckin: lastCheckin[r.shepherd_id] || null,
        isCurrentUser: false,
        contextLabel: 'Manual Assignment',
        warning: null,
      })
    }

    const shepherdTreeId = `${r.shepherd_id}::manual`
    const person = personMap.get(r.person_id)!
    nodes.push({
      id: `${r.person_id}::manual-${r.shepherd_id}`,
      personId: r.person_id,
      name: person.name || 'Unknown',
      role: 'member',
      nodeType: 'person',
      supervisorId: shepherdTreeId,
      flockCount: 0,
      lastCheckin: null,
      isCurrentUser: false,
      contextLabel: 'Manual Assignment',
      warning: null,
    })

    // Update shepherd flock count
    const shepherdNode = nodes.find(n => n.id === shepherdTreeId)
    if (shepherdNode) shepherdNode.flockCount++
  }

  // ── Also add manual root leaders that have no manual flock yet ──
  // (e.g. Joe Henseler added as root via "Add Person" but nobody assigned under him)
  // These people were marked is_leader=true when added via addPersonToTree
  // They show up in manualRelationships only if someone is under them.
  // Check for people who are leaders but don't appear in any tree node yet:
  const peopleInTree = new Set<string>()
  for (const n of nodes) {
    if (n.personId) peopleInTree.add(n.personId)
  }

  // People marked as is_leader who aren't in any tracked group/team/manual context
  // Check the is_leader flag
  const { data: leaderPeople } = await admin.from('people')
    .select('id, name')
    .eq('church_id', churchId!)
    .eq('is_leader', true)
    .not('name', 'like', '\\_%').not('name', 'like', '-%')
    .neq('membership_type', 'SYSTEM USE - Do Not Delete')

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
