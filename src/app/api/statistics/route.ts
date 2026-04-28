import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

/*
 * Shepherding statistics — aggregates over the whole church.
 *
 * Reads from materialized views populated by the cron sync. The route's job
 * is purely shape: turn rows from group_type_stats_v / team_type_stats_v /
 * person_engagement_status / staff_per_type_v into the JSON the dashboard
 * consumes. Heavy lifting is in the views, not here.
 *
 * Refresh cadence: the views are refreshed by refresh_analytics_views()
 * after each cron run (daily). Snapshot points inside the trend views shift
 * forward by however long has passed since the last refresh; for a
 * 12-month chart that's well within noise.
 */

const MEASUREMENT_DAYS = 90
const SNAPSHOT_POINTS = 5

type TypeStatsRow = {
  type_id: string
  type_name: string
  contexts: number
  members: number
  leaders: number
  joined_recent: number
  exited_recent: number
  avg_tenure_active_days: number | null
  avg_tenure_exited_days: number | null
}

type TrendRow = {
  type_id: string
  offset_idx: number
  snapshot_at: string
  members: number
  leaders: number
}

type StaffRow = {
  kind: 'group' | 'team'
  type_id: string
  staff_count: number
  staff_person_ids: string[] | null
}

type EngagementCountRow = {
  status: 'excluded' | 'shepherded' | 'active' | 'present'
  count: number
}

type PersonAnalyticsRow = {
  total_contexts: number | null
  group_attendance_rate: number | null
}

type ResponseTypeStat = {
  typeId: string
  typeName: string
  contexts: number
  staff: number
  members: number
  leaders: number
  joinedRecent: number
  exitedRecent: number
  delta: number
  series: { at: string; members: number; leaders: number }[]
  avgTenureActiveDays: number | null
  avgTenureExitedDays: number | null
}

function buildTypeStats(
  stats: TypeStatsRow[],
  trend: TrendRow[],
  staff: StaffRow[],
): ResponseTypeStat[] {
  const trendByType = new Map<string, TrendRow[]>()
  for (const t of trend) {
    const list = trendByType.get(t.type_id) ?? []
    list.push(t)
    trendByType.set(t.type_id, list)
  }
  const staffByType = new Map<string, StaffRow>(staff.map(s => [s.type_id, s]))

  const out = stats.map<ResponseTypeStat>(s => {
    const series = (trendByType.get(s.type_id) ?? [])
      .sort((a, b) => a.offset_idx - b.offset_idx)
      .map(p => ({ at: p.snapshot_at, members: p.members, leaders: p.leaders }))
    const staffRow = staffByType.get(s.type_id)
    return {
      typeId: s.type_id,
      typeName: s.type_name,
      contexts: s.contexts,
      staff: staffRow?.staff_count ?? 0,
      members: s.members,
      leaders: s.leaders,
      joinedRecent: s.joined_recent,
      exitedRecent: s.exited_recent,
      delta: s.joined_recent - s.exited_recent,
      series,
      avgTenureActiveDays: s.avg_tenure_active_days,
      avgTenureExitedDays: s.avg_tenure_exited_days,
    }
  })

  out.sort((a, b) => b.members + b.leaders - (a.members + a.leaders))
  return out
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

  /*
   * 5 reads. Down from 14.
   *   - group_type_stats_v:    one row per tracked group_type
   *   - team_type_stats_v:     one row per tracked service_type
   *   - *_trend_v:             5 rows per type (one per snapshot)
   *   - staff_per_type_v:      one row per (kind, type)
   *   - person_engagement_status: one row per active person
   *   - person_analytics:      one row per person (for averages)
   */
  const [
    { data: groupStatsRows },
    { data: teamStatsRows },
    { data: groupTrendRows },
    { data: teamTrendRows },
    { data: staffRows },
    { data: engagementCounts },
    { data: peopleAnalytics },
    { data: perTeamStatsRows },
    { data: perTeamTrendRows },
  ] = await Promise.all([
    supabase.from('group_type_stats_v').select('*').eq('church_id', churchId),
    supabase.from('team_type_stats_v').select('*').eq('church_id', churchId),
    supabase.from('group_type_trend_v').select('type_id, offset_idx, snapshot_at, members, leaders').eq('church_id', churchId),
    supabase.from('team_type_trend_v').select('type_id, offset_idx, snapshot_at, members, leaders').eq('church_id', churchId),
    supabase.from('staff_per_type_v').select('kind, type_id, staff_count, staff_person_ids').eq('church_id', churchId),
    /*
     * Aggregate via RPC. The previous version selected raw rows, which
     * PostgREST silently capped at 1000 even for a church with ~16k people.
     * The RPC does the GROUP BY in SQL and returns 4 small rows.
     */
    supabase.rpc('get_person_engagement_counts', { p_church_id: churchId }),
    supabase.from('person_analytics').select('total_contexts, group_attendance_rate').eq('church_id', churchId),
    /* Per-team detail (one row per team, not per service_type) for the
     * /statistics teams-table expand-row drill-down. */
    supabase.from('team_stats_v')
      .select('team_id, team_name, type_id, type_name, contexts, members, leaders, joined_recent, exited_recent, avg_tenure_active_days, avg_tenure_exited_days')
      .eq('church_id', churchId),
    supabase.from('team_trend_v').select('team_id, offset_idx, snapshot_at, members, leaders').eq('church_id', churchId),
  ])

  const staffByKind = (kind: 'group' | 'team') =>
    (staffRows ?? []).filter((s: StaffRow) => s.kind === kind)

  const groupStats = buildTypeStats(
    (groupStatsRows ?? []) as TypeStatsRow[],
    (groupTrendRows ?? []) as TrendRow[],
    staffByKind('group'),
  )
  const teamStats = buildTypeStats(
    (teamStatsRows ?? []) as TypeStatsRow[],
    (teamTrendRows ?? []) as TrendRow[],
    staffByKind('team'),
  )

  // Categories: RPC returns one row per status with a count. Engagement
  // view excludes inactive people and SYSTEM rows already.
  const categories = { total: 0, shepherded: 0, active: 0, present: 0, excluded: 0 }
  for (const r of (engagementCounts ?? []) as EngagementCountRow[]) {
    const c = Number(r.count) || 0
    if (r.status === 'excluded') categories.excluded = c
    else if (r.status === 'shepherded') categories.shepherded = c
    else if (r.status === 'active') categories.active = c
    else if (r.status === 'present') categories.present = c
  }
  categories.total = categories.shepherded + categories.active + categories.present

  // Per-person averages
  let sumContexts = 0, cContexts = 0
  let sumAttendRate = 0, cAttendRate = 0
  for (const a of (peopleAnalytics ?? []) as PersonAnalyticsRow[]) {
    if (a.total_contexts != null) { sumContexts += a.total_contexts; cContexts++ }
    if (a.group_attendance_rate != null) { sumAttendRate += a.group_attendance_rate; cAttendRate++ }
  }

  // Totals across all contexts. Staff is deduped across types — a staff
  // person overseeing multiple group_types counts once. Read the deduped
  // person_id arrays from staff_per_type_v so we don't have to refetch
  // raw shepherding edges.
  const allStaffForGroups = new Set<string>()
  for (const s of staffByKind('group')) {
    for (const pid of s.staff_person_ids ?? []) allStaffForGroups.add(pid)
  }
  const allStaffForTeams = new Set<string>()
  for (const s of staffByKind('team')) {
    for (const pid of s.staff_person_ids ?? []) allStaffForTeams.add(pid)
  }

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

  /*
   * Per-team rows keyed by service_type so the UI can render
   * teamsByServiceType[type_id] inside an expanded row.
   */
  const trendByTeam = new Map<string, TrendRow[]>()
  for (const t of (perTeamTrendRows ?? []) as { team_id: string; offset_idx: number; snapshot_at: string; members: number; leaders: number }[]) {
    const key = t.team_id
    const list = trendByTeam.get(key) ?? []
    list.push({ type_id: key, offset_idx: t.offset_idx, snapshot_at: t.snapshot_at, members: t.members, leaders: t.leaders })
    trendByTeam.set(key, list)
  }
  type PerTeamRow = TypeStatsRow & { team_id: string; team_name: string }
  const teamsByServiceType: Record<string, ResponseTypeStat[]> = {}
  for (const r of (perTeamStatsRows ?? []) as PerTeamRow[] & { team_id: string; team_name: string; type_id: string }[]) {
    if (!Object.prototype.hasOwnProperty.call(teamsByServiceType, r.type_id)) {
      teamsByServiceType[r.type_id] = []
    }
    const series = (trendByTeam.get(r.team_id) ?? [])
      .sort((a, b) => a.offset_idx - b.offset_idx)
      .map(p => ({ at: p.snapshot_at, members: p.members, leaders: p.leaders }))
    teamsByServiceType[r.type_id].push({
      typeId: r.team_id,
      typeName: r.team_name,
      contexts: r.contexts,
      staff: 0, // staff is computed at type-level only
      members: r.members,
      leaders: r.leaders,
      joinedRecent: r.joined_recent,
      exitedRecent: r.exited_recent,
      delta: r.joined_recent - r.exited_recent,
      series,
      avgTenureActiveDays: r.avg_tenure_active_days,
      avgTenureExitedDays: r.avg_tenure_exited_days,
    })
  }
  /* Sort per-type lists by current membership descending. */
  for (const key of Object.keys(teamsByServiceType)) {
    teamsByServiceType[key].sort((a, b) => b.members + b.leaders - (a.members + a.leaders))
  }

  return NextResponse.json(
    {
      measurementDays: MEASUREMENT_DAYS,
      snapshotPoints: SNAPSHOT_POINTS,
      generatedAt: now.toISOString(),
      categories,
      groupsByType: groupStats,
      teamsByType: teamStats,
      teamsByServiceType,
      totals,
      ratios: {
        groupLeaderToMember: totals.groups.members > 0
          ? Math.round((totals.groups.leaders / totals.groups.members) * 1000) / 1000
          : null,
        teamLeaderToMember: totals.teams.members > 0
          ? Math.round((totals.teams.leaders / totals.teams.members) * 1000) / 1000
          : null,
      },
      perPerson: {
        avgContexts: cContexts > 0 ? Math.round((sumContexts / cContexts) * 100) / 100 : null,
        avgGroupAttendanceRate: cAttendRate > 0 ? Math.round((sumAttendRate / cAttendRate) * 1000) / 1000 : null,
      },
    },
    {
      headers: {
        // Cron-driven data — fine to serve a 60s-old response back to
        // anyone who refreshes. stale-while-revalidate keeps the dashboard
        // snappy while a background fetch warms the cache.
        'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
      },
    },
  )
}
