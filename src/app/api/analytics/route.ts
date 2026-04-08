import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  // All queries in parallel
  const [coverageRes, trendRes, unconnectedRes, contextRes] = await Promise.all([
    supabase.from('care_coverage_summary').select('*').limit(1).single(),
    supabase.from('weekly_attendance_trend').select('*').order('week_start', { ascending: true }),
    supabase.from('active_unconnected_people').select('*').limit(20),
    supabase.from('context_summary').select('*'),
  ])

  return NextResponse.json({
    coverage: coverageRes.data || { total_active: 0, total_attenders: 0, unconnected_active: 0, has_shepherd: 0, connection_percentage: 0 },
    attendanceTrend: trendRes.data || [],
    unconnectedPeople: unconnectedRes.data || [],
    contextSummary: contextRes.data || [],
  })
}
