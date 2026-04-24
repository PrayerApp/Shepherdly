import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

// Shepherding statistics — aggregates over the whole church.
//
// Measurement threshold: 3 months. Time-series snapshots are computed
// at 5 points (now, -3mo, -6mo, -9mo, -12mo) by filtering membership
// rows on joined_at / left_at, which PCO sync maintains. No stored
// snapshot table needed — the history is reconstructible from those
// timestamps.

const MEASUREMENT_DAYS = 90
const SNAPSHOT_POINTS = 5

type Membership = {
  person_id: string
  joined_at: string | null
  left_at: string | null
  is_active: boolean
  role: string | null
}
type GroupRow = { id: string; group_type_id: string | null }
type TeamRow = { id: string; service_type_id: string | null }
type TypeRow = { id: string; name: string; is_tracked: boolean }

const LEADER_ROLE = /leader|co.?leader/i

function countMembersAt(rows: (Membership & { _key: string })[], tMs: number): number {
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.joined_at) continue
    const joined = new Date(r.joined_at).getTime()
    if (joined > tMs) continue
    const left = r.left_at ? new Date(r.left_at).getTime() : null
    if (left !== null && left <= tMs) continue
    seen.add(r._key)
  }
  return seen.size
}

function buildSnapshotTimes(now: Date): Date[] {
  return Array.from({ length: SNAPSHOT_POINTS }, (_, i) => {
    const t = new Date(now.getTime())
    t.setDate(t.getDate() - i * MEASUREMENT_DAYS)
    return t
  })
}

type TypeStat = {
  typeId: string
  typeName: string
  contexts: number           // distinct group/team count under this type (tracked)
  staff: number              // people on staff-category layer shepherding members of this type
  members: number
  leaders: number
  joinedRecent: number       // joined in last MEASUREMENT_DAYS
  exitedRecent: number       // exited in last MEASUREMENT_DAYS
  delta: number              // joinedRecent - exitedRecent
  series: { at: string; members: number; leaders: number }[]
  avgTenureActiveDays: number | null  // for still-active memberships
  avgTenureExitedDays: number | null  // for memberships with left_at
}

function aggregateByType(
  memberships: Membership[],
  // entityId -> type_id lookup (group_id -> group_type_id or team_id -> service_type_id)
  entityTypeMap: Map<string, string>,
  // entityId field name on the membership rows ("group_id" or "team_id")
  entityField: 'group_id' | 'team_id',
  types: TypeRow[],
  now: Date,
  // Staff-layer people who shepherd members of each type. Keyed by
  // typeId → set of person_ids on a tree_layer with category='staff'
  // whose tree_connections reach any current member of this type.
  staffByType: Map<string, Set<string>>,
): TypeStat[] {
  const nowMs = now.getTime()
  const cutoffMs = nowMs - MEASUREMENT_DAYS * 86400000
  const snapshotTimes = buildSnapshotTimes(now)
  const rawMembersByType = new Map<string, (Membership & { _key: string; _entityId: string })[]>()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const m of memberships as any[]) {
    const entityId = m[entityField] as string
    const typeId = entityTypeMap.get(entityId)
    if (!typeId) continue
    const list = rawMembersByType.get(typeId) || []
    list.push({ ...m, _key: m.person_id, _entityId: entityId })
    rawMembersByType.set(typeId, list)
  }

  const results: TypeStat[] = []
  for (const t of types) {
    const rows = rawMembersByType.get(t.id) || []
    // Distinct contexts (groups/teams of this type that have any memberships)
    const contexts = new Set(rows.map(r => r._entityId)).size
    // Separate by role for current snapshot
    const leaderRows = rows.filter(r => r.is_active && LEADER_ROLE.test(r.role || ''))
    const memberRows = rows.filter(r => r.is_active && !LEADER_ROLE.test(r.role || ''))
    const members = new Set(memberRows.map(r => r._key)).size
    const leaders = new Set(leaderRows.map(r => r._key)).size

    let joinedRecent = 0
    let exitedRecent = 0
    for (const r of rows) {
      if (r.joined_at && new Date(r.joined_at).getTime() >= cutoffMs) joinedRecent++
      if (r.left_at && new Date(r.left_at).getTime() >= cutoffMs) exitedRecent++
    }

    const series = snapshotTimes.map(at => ({
      at: at.toISOString(),
      members: countMembersAt(rows.filter(r => !LEADER_ROLE.test(r.role || '')), at.getTime()),
      leaders: countMembersAt(rows.filter(r => LEADER_ROLE.test(r.role || '')), at.getTime()),
    }))

    // Tenure averages. Active: now - joined_at. Exited: left_at - joined_at.
    let activeTenureSum = 0, activeTenureN = 0
    let exitedTenureSum = 0, exitedTenureN = 0
    for (const r of rows) {
      if (!r.joined_at) continue
      const joined = new Date(r.joined_at).getTime()
      if (r.is_active) {
        activeTenureSum += (nowMs - joined)
        activeTenureN++
      } else if (r.left_at) {
        const left = new Date(r.left_at).getTime()
        exitedTenureSum += (left - joined)
        exitedTenureN++
      }
    }

    results.push({
      typeId: t.id,
      typeName: t.name,
      contexts,
      staff: (staffByType.get(t.id) || new Set()).size,
      members,
      leaders,
      joinedRecent,
      exitedRecent,
      delta: joinedRecent - exitedRecent,
      series,
      avgTenureActiveDays: activeTenureN > 0 ? Math.round(activeTenureSum / activeTenureN / 86400000) : null,
      avgTenureExitedDays: exitedTenureN > 0 ? Math.round(exitedTenureSum / exitedTenureN / 86400000) : null,
    })
  }

  // Sort by current total membership descending — most-populated first.
  results.sort((a, b) => (b.members + b.leaders) - (a.members + a.leaders))
  return results
}

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role, church_id')
    .eq('user_id', user.id)
    .single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })
  const churchId = appUser.church_id as string

  const now = new Date()
  const twelveMoAgoIso = new Date(now.getTime() - 365 * 86400000).toISOString()

  // Membership-type rules (see user spec):
  //   - Excluded outright (not counted as either Active or Shepherded).
  //     Status='inactive' already gets filtered separately; these are
  //     system/legacy rows that clutter totals.
  //   - Outreach Partner counts as Shepherded even without a group/
  //     team membership — it's a formal pastoral relationship.
  //   - The four "limited engagement" types count as Active: they're
  //     not in any shepherding context but represent a real touchpoint
  //     with the church.
  const EXCLUDED_MTYPES = new Set(['SYSTEM USE - Do Not Delete', 'Former Member'])
  const SHEPHERDED_MTYPES = new Set(['Outreach Partner'])
  const ACTIVE_MTYPES = new Set([
    'Benevolence Only', 'Activity Only', 'Parent Only', 'Online Submission Only',
  ])

  // Paginate people — PostgREST caps at 1000 rows per response.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function fetchAllPeopleLite(): Promise<{ id: string; membership_type: string | null }[]> {
    const out: { id: string; membership_type: string | null }[] = []
    const PAGE = 1000
    for (let from = 0; ; from += PAGE) {
      const { data } = await supabase
        .from('people')
        .select('id, membership_type')
        .eq('church_id', churchId)
        .eq('status', 'active')
        .range(from, from + PAGE - 1)
      if (!data || data.length === 0) break
      out.push(...data)
      if (data.length < PAGE) break
    }
    return out
  }

  // Fetch everything we need in parallel. All tables scoped to church.
  const [
    { data: groupTypes },
    { data: serviceTypes },
    { data: groups },
    { data: teams },
    { data: groupMemberships },
    { data: teamMemberships },
    peopleLite,
    { data: peopleAnalytics },
    { data: registrationAttendees },
    { data: prayerSubmissions },
    { data: recentCheckins },
    { data: treeLayers },
    { data: allPlacements },
    { data: treeConnections },
  ] = await Promise.all([
    supabase.from('group_types').select('id, name, is_tracked').eq('church_id', churchId).eq('is_tracked', true),
    supabase.from('service_types').select('id, name, is_tracked').eq('church_id', churchId).eq('is_tracked', true),
    supabase.from('groups').select('id, group_type_id').eq('church_id', churchId),
    supabase.from('teams').select('id, service_type_id').eq('church_id', churchId),
    supabase.from('group_memberships').select('person_id, group_id, role, joined_at, left_at, is_active').eq('church_id', churchId),
    supabase.from('team_memberships').select('person_id, team_id, role, joined_at, left_at, is_active').eq('church_id', churchId),
    fetchAllPeopleLite(),
    supabase.from('person_analytics').select('person_id, engagement_score, total_contexts, group_attendance_rate, last_attended_at').eq('church_id', churchId),
    // Active signals — all time-windowed to the last 12 months so
    // long-dormant touches don't keep someone "Active" forever.
    supabase.from('pco_signup_attendees')
      .select('person_id, registered_at, active, waitlisted, canceled')
      .eq('church_id', churchId)
      .gte('registered_at', twelveMoAgoIso),
    supabase.from('pco_form_submissions')
      .select('person_id, submitted_at')
      .eq('church_id', churchId)
      .eq('form_pco_id', '144568')
      .gte('submitted_at', twelveMoAgoIso),
    supabase.from('attendance_records')
      .select('person_id, checked_in_at')
      .eq('church_id', churchId)
      .gte('checked_in_at', twelveMoAgoIso),
    supabase.from('tree_layers')
      .select('id, category')
      .eq('church_id', churchId),
    supabase.from('shepherding_connections')
      .select('person_id, layer_id')
      .eq('church_id', churchId),
    supabase.from('tree_connections')
      .select('parent_person_id, child_person_id')
      .eq('church_id', churchId),
  ])

  const groupTypeMap = new Map<string, string>()
  for (const g of (groups || []) as GroupRow[]) {
    if (g.group_type_id) groupTypeMap.set(g.id, g.group_type_id)
  }
  const teamTypeMap = new Map<string, string>()
  for (const t of (teams || []) as TeamRow[]) {
    if (t.service_type_id) teamTypeMap.set(t.id, t.service_type_id)
  }

  // Build staff-by-type maps. For each group_type (and team_type),
  // find the set of staff-layer people who shepherd any active
  // member of that type via tree_connections. This captures both
  // auto-connect edges and shepherd-over rule-generated edges —
  // both land in tree_connections regardless of origin.
  const staffLayerIds = new Set<string>(
    ((treeLayers || []) as { id: string; category: string }[])
      .filter(l => l.category === 'staff')
      .map(l => l.id),
  )
  const staffPersonIds = new Set<string>()
  for (const p of (allPlacements || []) as { person_id: string; layer_id: string }[]) {
    if (staffLayerIds.has(p.layer_id)) staffPersonIds.add(p.person_id)
  }
  // childPersonId → set of parent_person_ids
  const parentsByChild = new Map<string, Set<string>>()
  for (const c of (treeConnections || []) as { parent_person_id: string; child_person_id: string }[]) {
    if (!parentsByChild.has(c.child_person_id)) parentsByChild.set(c.child_person_id, new Set())
    parentsByChild.get(c.child_person_id)!.add(c.parent_person_id)
  }
  // Active member person_ids grouped by group_type / service_type.
  const memberPersonIdsByGroupType = new Map<string, Set<string>>()
  for (const m of (groupMemberships || []) as Membership[] & { group_id?: string }[]) {
    if (!m.is_active) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const gid = (m as any).group_id as string | undefined
    if (!gid) continue
    const tid = groupTypeMap.get(gid)
    if (!tid) continue
    if (!memberPersonIdsByGroupType.has(tid)) memberPersonIdsByGroupType.set(tid, new Set())
    memberPersonIdsByGroupType.get(tid)!.add(m.person_id)
  }
  const memberPersonIdsByTeamType = new Map<string, Set<string>>()
  for (const m of (teamMemberships || []) as Membership[] & { team_id?: string }[]) {
    if (!m.is_active) continue
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tidRaw = (m as any).team_id as string | undefined
    if (!tidRaw) continue
    const stid = teamTypeMap.get(tidRaw)
    if (!stid) continue
    if (!memberPersonIdsByTeamType.has(stid)) memberPersonIdsByTeamType.set(stid, new Set())
    memberPersonIdsByTeamType.get(stid)!.add(m.person_id)
  }
  const buildStaffByType = (memberSetByType: Map<string, Set<string>>): Map<string, Set<string>> => {
    const out = new Map<string, Set<string>>()
    for (const [typeId, memberSet] of memberSetByType) {
      const staff = new Set<string>()
      for (const memberId of memberSet) {
        const parents = parentsByChild.get(memberId)
        if (!parents) continue
        for (const pid of parents) {
          if (staffPersonIds.has(pid)) staff.add(pid)
        }
      }
      out.set(typeId, staff)
    }
    return out
  }
  const staffByGroupType = buildStaffByType(memberPersonIdsByGroupType)
  const staffByTeamType = buildStaffByType(memberPersonIdsByTeamType)

  const groupStats = aggregateByType(
    (groupMemberships || []) as Membership[],
    groupTypeMap,
    'group_id',
    (groupTypes || []) as TypeRow[],
    now,
    staffByGroupType,
  )
  const teamStats = aggregateByType(
    (teamMemberships || []) as Membership[],
    teamTypeMap,
    'team_id',
    (serviceTypes || []) as TypeRow[],
    now,
    staffByTeamType,
  )

  // Categories of People.
  // Walk every active person exactly once and bucket them:
  //   • Excluded  — SYSTEM / Former Member rows, treated as inactive
  //   • Shepherded — in any group/team, an Outreach Partner, OR has
  //                  recent check-in records. The check-in signal is
  //                  almost entirely children's ministry sign-ins:
  //                  kids who are being actively cared for in a
  //                  ministry context count as shepherded even if
  //                  they don't have a group/team membership yet.
  //   • Active    — non-shepherded but had a real touchpoint in the
  //                 last 12 months (registration, prayer form) or
  //                 carries a "limited engagement" membership type
  //   • Present   — everyone else with an active PCO record
  const shepherdedFromMemberships = new Set<string>()
  for (const m of groupMemberships || []) if (m.is_active) shepherdedFromMemberships.add(m.person_id)
  for (const m of teamMemberships || []) if (m.is_active) shepherdedFromMemberships.add(m.person_id)

  const recentRegistration = new Set<string>()
  for (const r of (registrationAttendees || []) as { person_id: string | null; active?: boolean; waitlisted?: boolean; canceled?: boolean }[]) {
    if (!r.person_id) continue
    if (r.canceled) continue // canceled attendees aren't a live signal
    if (r.active || r.waitlisted) recentRegistration.add(r.person_id)
  }
  const recentPrayer = new Set<string>()
  for (const r of (prayerSubmissions || []) as { person_id: string | null }[]) {
    if (r.person_id) recentPrayer.add(r.person_id)
  }
  const recentCheckin = new Set<string>()
  for (const r of (recentCheckins || []) as { person_id: string | null }[]) {
    if (r.person_id) recentCheckin.add(r.person_id)
  }

  let excludedCount = 0
  const shepherdedIds = new Set<string>()
  const activeIds = new Set<string>()
  let presentCount = 0
  for (const p of peopleLite) {
    const mt = p.membership_type || ''
    if (EXCLUDED_MTYPES.has(mt)) { excludedCount++; continue }

    const inShepherdingCtx = shepherdedFromMemberships.has(p.id)
    const isOutreachPartner = SHEPHERDED_MTYPES.has(mt)
    const isCheckedIn = recentCheckin.has(p.id)
    if (inShepherdingCtx || isOutreachPartner || isCheckedIn) {
      shepherdedIds.add(p.id)
      continue
    }

    const hasActiveSignal =
      recentRegistration.has(p.id) ||
      recentPrayer.has(p.id) ||
      ACTIVE_MTYPES.has(mt)
    if (hasActiveSignal) {
      activeIds.add(p.id)
      continue
    }

    presentCount++
  }
  const peopleTotal = shepherdedIds.size + activeIds.size + presentCount

  // Per-person averages from analytics.
  let sumContexts = 0, cContexts = 0
  let sumAttendRate = 0, cAttendRate = 0
  for (const a of peopleAnalytics || []) {
    if (a.total_contexts != null) { sumContexts += a.total_contexts; cContexts++ }
    if (a.group_attendance_rate != null) { sumAttendRate += a.group_attendance_rate; cAttendRate++ }
  }

  // Totals across all contexts. Staff is deduped across types — a
  // staff person overseeing multiple group_types counts once.
  const allStaffForGroups = new Set<string>()
  for (const set of staffByGroupType.values()) for (const pid of set) allStaffForGroups.add(pid)
  const allStaffForTeams = new Set<string>()
  for (const set of staffByTeamType.values()) for (const pid of set) allStaffForTeams.add(pid)

  const totals = {
    groups: {
      contexts: groupStats.reduce((s, g) => s + g.contexts, 0),
      staff: allStaffForGroups.size,
      members: groupStats.reduce((s, g) => s + g.members, 0),
      leaders: groupStats.reduce((s, g) => s + g.leaders, 0),
      joinedRecent: groupStats.reduce((s, g) => s + g.joinedRecent, 0),
      exitedRecent: groupStats.reduce((s, g) => s + g.exitedRecent, 0),
    },
    teams: {
      contexts: teamStats.reduce((s, t) => s + t.contexts, 0),
      staff: allStaffForTeams.size,
      members: teamStats.reduce((s, t) => s + t.members, 0),
      leaders: teamStats.reduce((s, t) => s + t.leaders, 0),
      joinedRecent: teamStats.reduce((s, t) => s + t.joinedRecent, 0),
      exitedRecent: teamStats.reduce((s, t) => s + t.exitedRecent, 0),
    },
  }

  return NextResponse.json({
    measurementDays: MEASUREMENT_DAYS,
    snapshotPoints: SNAPSHOT_POINTS,
    generatedAt: now.toISOString(),
    categories: {
      total: peopleTotal,
      shepherded: shepherdedIds.size,
      active: activeIds.size,
      present: presentCount,
      excluded: excludedCount,
    },
    groupsByType: groupStats,
    teamsByType: teamStats,
    totals,
    ratios: {
      groupLeaderToMember: totals.groups.members > 0
        ? Math.round((totals.groups.leaders / totals.groups.members) * 1000) / 1000 : null,
      teamLeaderToMember: totals.teams.members > 0
        ? Math.round((totals.teams.leaders / totals.teams.members) * 1000) / 1000 : null,
    },
    perPerson: {
      avgContexts: cContexts > 0 ? Math.round((sumContexts / cContexts) * 100) / 100 : null,
      avgGroupAttendanceRate: cAttendRate > 0 ? Math.round((sumAttendRate / cAttendRate) * 1000) / 1000 : null,
    },
    // Silently truncated if any of the source queries hit the 1000-row
    // default limit — these tables are typically small but we log a
    // hint so the client can warn if it looks suspicious.
    debug: {
      groupMembershipRows: (groupMemberships || []).length,
      teamMembershipRows: (teamMemberships || []).length,
      analyticsRows: (peopleAnalytics || []).length,
      peopleRows: peopleLite.length,
      registrationSignalRows: (registrationAttendees || []).length,
      prayerSignalRows: (prayerSubmissions || []).length,
      checkinSignalRows: (recentCheckins || []).length,
    },
  })
}
