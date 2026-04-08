import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('id, role, church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const { data: surveys, error } = await supabase
    .from('surveys')
    .select('*, responses:survey_responses(count)')
    .eq('church_id', appUser.church_id!)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ surveys: surveys || [], userRole: appUser.role })
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('id, role, church_id').eq('user_id', user.id).single()
  if (!['super_admin', 'staff'].includes(appUser?.role || ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { title, questions, target_role } = await request.json()
  if (!title || !questions?.length) return NextResponse.json({ error: 'Title and questions required' }, { status: 400 })

  const { data: survey, error } = await supabase
    .from('surveys')
    .insert({
      title,
      questions,
      target_role: target_role || 'all',
      is_active: true,
      created_by: appUser!.id,
      church_id: appUser!.church_id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ survey })
}
