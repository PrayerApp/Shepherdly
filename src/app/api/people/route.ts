import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role, name, church_id')
    .eq('user_id', user.id)
    .single()

  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const search = params.get('search') || ''
  const sort = params.get('sort') || 'name'
  const showAll = params.get('all') === 'true' && ['super_admin', 'staff'].includes(appUser.role)

  let query = supabase
    .from('people')
    .select('*, groups:group_memberships(group_id, role, groups(id, name)), teams:team_memberships(team_id, role, teams(id, name))')
    .eq('church_id', appUser.church_id!)
    .eq('is_active', true)

  if (!showAll) {
    // Find current user's people record
    const { data: myPerson } = await supabase
      .from('people')
      .select('id')
      .eq('is_leader', true)
      .eq('church_id', appUser.church_id!)
      .ilike('name', appUser.name || '')
      .limit(1)
      .single()

    if (myPerson) {
      query = query.eq('shepherd_id', myPerson.id)
    } else {
      return NextResponse.json({ people: [], myPersonId: null })
    }
  }

  if (search) {
    query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
  }

  if (sort === 'engagement') {
    query = query.order('engagement_score', { ascending: false, nullsFirst: false })
  } else if (sort === 'attendance') {
    query = query.order('last_attended_at', { ascending: false, nullsFirst: false })
  } else {
    query = query.order('name')
  }

  const { data: people, error } = await query.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ people: people || [] })
}
