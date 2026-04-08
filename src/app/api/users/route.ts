import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: caller } = await supabase.from('users').select('role').eq('user_id', user.id).single()
  if (caller?.role !== 'super_admin') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { data: users, error } = await supabase
    .from('users')
    .select('*')
    .order('role')
    .order('name')

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ users })
}
