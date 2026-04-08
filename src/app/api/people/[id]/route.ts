import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: person, error } = await supabase
    .from('people')
    .select('*, groups:group_memberships(group_id, role, groups(id, name)), teams:team_memberships(team_id, role, teams(id, name))')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ person })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('role').eq('user_id', user.id).single()
  if (!['super_admin', 'staff'].includes(appUser?.role || ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const body = await request.json()
  const admin = createAdminClient()
  const updates: Record<string, unknown> = {}
  if (body.shepherd_id !== undefined) updates.shepherd_id = body.shepherd_id
  if (body.is_leader !== undefined) updates.is_leader = body.is_leader
  if (body.status !== undefined) updates.status = body.status

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from('people').update(updates).eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
