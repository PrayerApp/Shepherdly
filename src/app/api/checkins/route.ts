import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('id, role, church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const status = params.get('status')
  const urgent = params.get('urgent')
  const sort = params.get('sort') || 'newest'

  let query = supabase
    .from('check_in_reports')
    .select('*, leader:people!check_in_reports_leader_id_fkey(id, name)')
    .eq('church_id', appUser.church_id!)

  // Leaders see only their own reports; admins see all
  if (appUser.role === 'leader') {
    query = query.eq('respondent_id', appUser.id)
  }

  if (status && status !== 'all') {
    query = query.eq('status', status)
  }
  if (urgent === 'true') {
    query = query.eq('is_urgent', true)
  }

  query = sort === 'oldest'
    ? query.order('created_at', { ascending: true })
    : query.order('created_at', { ascending: false })

  const { data: reports, error } = await query.limit(100)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ reports: reports || [] })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('id, church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const body = await request.json()
  const { leader_id, group_name, going_well, needs_attention, prayer_requests, is_urgent, context_type, context_id } = body

  if (!going_well && !needs_attention && !prayer_requests) {
    return NextResponse.json({ error: 'At least one field must be filled' }, { status: 400 })
  }

  const { data: report, error } = await supabase
    .from('check_in_reports')
    .insert({
      leader_id: leader_id || null,
      group_name: group_name || null,
      going_well: going_well || null,
      needs_attention: needs_attention || null,
      prayer_requests: prayer_requests || null,
      is_urgent: !!is_urgent,
      status: 'new',
      context_type: context_type || 'group',
      context_id: context_id || null,
      respondent_id: appUser.id,
      report_date: new Date().toISOString().split('T')[0],
      church_id: appUser.church_id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ report })
}
