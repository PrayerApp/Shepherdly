import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: currentUser } = await supabase
    .from('users')
    .select('id, role, church_id')
    .eq('user_id', user.id)
    .single()

  // Get all active users
  const { data: users } = await supabase
    .from('users')
    .select('id, name, email, role, photo_url, is_active, user_id')
    .eq('is_active', true)
    .order('role')

  // Get all people who are leaders (to map users to their people records)
  const { data: leaderPeople } = await supabase
    .from('people')
    .select('id, name, shepherd_id, pco_id')
    .eq('is_leader', true)
    .eq('is_active', true)

  // Get shepherding relationships for flock counts
  const { data: relationships } = await supabase
    .from('shepherding_relationships')
    .select('shepherd_id, person_id')

  // Count flock per shepherd (people.id)
  const flockCounts: Record<string, number> = {}
  relationships?.forEach(r => {
    flockCounts[r.shepherd_id] = (flockCounts[r.shepherd_id] || 0) + 1
  })

  // Also count via people.shepherd_id for direct assignments
  const { data: directAssignments } = await supabase
    .from('people')
    .select('shepherd_id')
    .not('shepherd_id', 'is', null)
    .eq('is_active', true)

  directAssignments?.forEach(a => {
    if (a.shepherd_id) {
      flockCounts[a.shepherd_id] = (flockCounts[a.shepherd_id] || 0) + 1
    }
  })

  // Get recent check-in report counts per leader
  const { data: recentReports } = await supabase
    .from('check_in_reports')
    .select('leader_id, created_at')
    .order('created_at', { ascending: false })

  const lastCheckin: Record<string, string> = {}
  recentReports?.forEach(r => {
    if (!lastCheckin[r.leader_id]) {
      lastCheckin[r.leader_id] = r.created_at
    }
  })

  // Build tree nodes from users + their people records
  // Match users to leader people records by email or name
  const nodes = users?.map(u => {
    // Try to find the user's people record (leader)
    const personRecord = leaderPeople?.find(p =>
      p.name?.toLowerCase() === u.name?.toLowerCase()
    )
    const personId = personRecord?.id
    const supervisorPersonId = personRecord?.shepherd_id || null

    // Find which user is the supervisor (map shepherd person back to user)
    let supervisorUserId: string | null = null
    if (supervisorPersonId) {
      const supervisorPerson = leaderPeople?.find(p => p.id === supervisorPersonId)
      if (supervisorPerson) {
        const supervisorUser = users?.find(su =>
          su.name?.toLowerCase() === supervisorPerson.name?.toLowerCase()
        )
        supervisorUserId = supervisorUser?.id || null
      }
    }

    return {
      id: u.id,
      name: u.name || u.email.split('@')[0],
      email: u.email,
      role: u.role,
      supervisorId: supervisorUserId,
      flockCount: personId ? (flockCounts[personId] || 0) : 0,
      lastCheckin: personId ? (lastCheckin[personId] || null) : null,
      isCurrentUser: u.user_id === user.id,
    }
  }) || []

  return NextResponse.json({ nodes, currentUserRole: currentUser?.role })
}
