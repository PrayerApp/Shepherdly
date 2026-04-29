import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

const CACHE_HEADERS = {
  // Materialized views refresh on cron, fine to serve a 60s-old response.
  'Cache-Control': 'private, max-age=60, stale-while-revalidate=300',
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const detail = params.get('detail') // 'group' or 'team'
  const contextId = params.get('context_id')

  // Detail view for a specific group or team
  if (detail && contextId) {
    if (detail === 'group') {
      const [groupRes, membersRes, eventsRes] = await Promise.all([
        supabase.from('groups').select('id, name, group_type, description').eq('id', contextId).single(),
        // !inner + filter on people.is_calculated_active drops memberships
        // whose person is calc-inactive — keeps the group detail view's
        // member count consistent with the rest of the site.
        supabase.from('group_memberships')
          .select('person_id, role, joined_at, is_active, people!inner(id, name)')
          .eq('group_id', contextId)
          .eq('people.is_calculated_active', true)
          .order('joined_at', { ascending: false }),
        supabase.from('group_events')
          .select('id, name, starts_at')
          .eq('group_id', contextId)
          .order('starts_at', { ascending: false })
          .limit(20),
      ])

      // Single SQL aggregation instead of fetching every attendance row.
      const eventIds = (eventsRes.data || []).map(e => e.id)
      const eventAttendance: Record<string, number> = {}
      if (eventIds.length > 0) {
        const { data: counts } = await supabase
          .rpc('get_event_attendance_counts', { p_event_ids: eventIds })
        for (const c of (counts ?? []) as { event_id: string; attendee_count: number }[]) {
          eventAttendance[c.event_id] = Number(c.attendee_count)
        }
      }

      const activeMembers = (membersRes.data || []).filter((m: { is_active?: boolean }) => m.is_active !== false)
      return NextResponse.json(
        {
          group: groupRes.data,
          members: membersRes.data || [],
          activeMemberCount: activeMembers.length,
          recentEvents: (eventsRes.data || []).map(e => ({
            ...e,
            attendeeCount: eventAttendance[e.id] || 0,
          })),
        },
        { headers: CACHE_HEADERS },
      )
    }

    if (detail === 'team') {
      const [teamRes, membersRes, plansRes] = await Promise.all([
        supabase.from('teams').select('id, name, team_type').eq('id', contextId).single(),
        supabase.from('team_memberships')
          .select('person_id, role, people!inner(id, name)')
          .eq('team_id', contextId)
          .eq('people.is_calculated_active', true),
        supabase.from('plan_team_members')
          .select('person_id, status, plan_id, position_name, service_plans(sort_date, title)')
          .eq('team_id', contextId)
          .order('created_at', { ascending: false })
          .limit(50),
      ])

      const confirmed = (plansRes.data || []).filter((p: { status?: string }) => p.status === 'C').length
      const total = (plansRes.data || []).length

      return NextResponse.json(
        {
          team: teamRes.data,
          members: membersRes.data || [],
          recentSchedules: plansRes.data || [],
          confirmationRate: total > 0 ? confirmed / total : null,
        },
        { headers: CACHE_HEADERS },
      )
    }
  }

  // Default: overview analytics
  const [coverageRes, trendRes, unconnectedRes, contextRes] = await Promise.all([
    supabase.from('care_coverage_summary').select('*').limit(1).single(),
    supabase.from('weekly_attendance_trend').select('*').order('week_start', { ascending: true }),
    supabase.from('active_unconnected_people').select('*').limit(20),
    supabase.from('context_summary').select('*'),
  ])

  return NextResponse.json(
    {
      coverage: coverageRes.data || { total_active: 0, total_attenders: 0, unconnected_active: 0, has_shepherd: 0, connection_percentage: 0 },
      attendanceTrend: trendRes.data || [],
      unconnectedPeople: unconnectedRes.data || [],
      contextSummary: contextRes.data || [],
    },
    { headers: CACHE_HEADERS },
  )
}
