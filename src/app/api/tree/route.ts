import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('app_users')
    .select('id, role')
    .eq('id', user.id)
    .single()

  // Get all visible users with their hierarchy
  const { data: users } = await supabase
    .from('app_users')
    .select('id, full_name, email, role, avatar_url, is_active')
    .eq('is_active', true)
    .order('role')

  const { data: hierarchy } = await supabase
    .from('user_hierarchy')
    .select('user_id, supervisor_id')

  // Get flock counts per shepherd
  const { data: assignments } = await supabase
    .from('shepherding_assignments')
    .select('shepherd_user_id')
    .eq('is_active', true)

  const flockCounts: Record<string, number> = {}
  assignments?.forEach(a => {
    flockCounts[a.shepherd_user_id] = (flockCounts[a.shepherd_user_id] || 0) + 1
  })

  // Get recent checkin dates per shepherd
  const { data: checkins } = await supabase
    .from('checkins')
    .select('shepherd_user_id, occurred_at')
    .order('occurred_at', { ascending: false })

  const lastCheckin: Record<string, string> = {}
  checkins?.forEach(c => {
    if (!lastCheckin[c.shepherd_user_id]) {
      lastCheckin[c.shepherd_user_id] = c.occurred_at
    }
  })

  // Build tree nodes
  const nodes = users?.map(u => ({
    id: u.id,
    name: u.full_name || u.email.split('@')[0],
    email: u.email,
    role: u.role,
    supervisorId: hierarchy?.find(h => h.user_id === u.id)?.supervisor_id || null,
    flockCount: flockCounts[u.id] || 0,
    lastCheckin: lastCheckin[u.id] || null,
    isCurrentUser: u.id === user.id,
  })) || []

  return NextResponse.json({ nodes, currentUserRole: currentUser?.role })
}
