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
  const cutoffMs = now.getTime() - MEASUREMENT_DAYS * 86400000

  // Fetch everything we need in parallel. All tables scoped to church.
  const [
    { data: groupTypes },
    { data: serviceTypes },
    { data: groups },
    { data: teams },
    { data: groupMemberships },
    { data: teamMemberships },
    { count: peopleTotal },
    { data: peopleAnalytics },
  ] = await Promise.all([
    supabase.from('group_types').select('id, name, is_tracked').eq('church_id', churchId).eq('is_tracked', true),
    supabase.from('service_types').select('id, name, is_tracked').eq('church_id', churchId).eq('is_tracked', true),
    supabase.from('groups').select('id, group_type_id').eq('church_id', churchId),
    supabase.from('teams').select('id, service_type_id').eq('church_id', churchId),
    supabase.from('group_memberships').select('person_id, group_id, role, joined_at, left_at, is_active').eq('church_id', churchId),
    supabase.from('team_memberships').select('person_id, team_id, role, joined_at, left_at, is_active').eq('church_id', churchId),
    supabase.from('people').select('id', { count: 'exact', head: true }).eq('church_id', churchId).eq('status', 'active'),
    supabase.from('person_analytics').select('person_id, engagement_score, total_contexts, group_attendance_rate, last_attended_at').eq('church_id', churchId),
  ])

  const groupTypeMap = new Map<string, string>()
  for (const g of (groups || []) as GroupRow[]) {
    if (g.group_type_id) groupTypeMap.set(g.id, g.group_type_id)
  }
  const teamTypeMap = new Map<string, string>()
  for (const t of (teams || []) as TeamRow[]) {
    if (t.service_type_id) teamTypeMap.set(t.id, t.service_type_id)
  }

  const groupStats = aggregateByType(
    (groupMemberships || []) as Membership[],
    groupTypeMap,
    'group_id',
    (groupTypes || []) as TypeRow[],
    now,
  )
  const teamStats = aggregateByType(
    (teamMemberships || []) as Membership[],
    teamTypeMap,
    'team_id',
    (serviceTypes || []) as TypeRow[],
    now,
  )

  // Categories of People.
  // Shepherded = anyone with an active group OR team membership.
  const shepherdedIds = new Set<string>()
  for (const m of groupMemberships || []) if (m.is_active) shepherdedIds.add(m.person_id)
  for (const m of teamMemberships || []) if (m.is_active) shepherdedIds.add(m.person_id)

  // Active (non-shepherded) = has engagement signal in person_analytics.
  // engagement_score > 0 or last_attended_at within 12 months serves as
  // the current proxy — richer signals (events registered, donations,
  // emails opened) live outside this DB and would require their own
  // tables to include.
  const twelveMoAgoMs = now.getTime() - 365 * 86400000
  const activeIds = new Set<string>()
  for (const a of peopleAnalytics || []) {
    if (shepherdedIds.has(a.person_id)) continue
    const hasScore = (a.engagement_score ?? 0) > 0
    const recentAttend = a.last_attended_at && new Date(a.last_attended_at).getTime() >= twelveMoAgoMs
    if (hasScore || recentAttend) activeIds.add(a.person_id)
  }
  const presentCount = Math.max(0, (peopleTotal ?? 0) - shepherdedIds.size - activeIds.size)

  // Per-person averages from analytics.
  let sumContexts = 0, cContexts = 0
  let sumAttendRate = 0, cAttendRate = 0
  for (const a of peopleAnalytics || []) {
    if (a.total_contexts != null) { sumContexts += a.total_contexts; cContexts++ }
    if (a.group_attendance_rate != null) { sumAttendRate += a.group_attendance_rate; cAttendRate++ }
  }

  // Totals across all contexts.
  const totals = {
    groups: {
      contexts: groupStats.reduce((s, g) => s + g.contexts, 0),
      members: groupStats.reduce((s, g) => s + g.members, 0),
      leaders: groupStats.reduce((s, g) => s + g.leaders, 0),
      joinedRecent: groupStats.reduce((s, g) => s + g.joinedRecent, 0),
      exitedRecent: groupStats.reduce((s, g) => s + g.exitedRecent, 0),
    },
    teams: {
      contexts: teamStats.reduce((s, t) => s + t.contexts, 0),
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
      total: peopleTotal ?? 0,
      shepherded: shepherdedIds.size,
      active: activeIds.size,
      present: presentCount,
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
    },
  })
}
