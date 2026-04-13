import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('id, role, church_id')
    .eq('user_id', user.id)
    .single()

  if (!appUser || !['super_admin', 'staff'].includes(appUser.role))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const admin = createAdminClient()
  const churchId = appUser.church_id!
  const search = request.nextUrl.searchParams.get('search') || ''

  // Build query — server-side search via ilike
  let query = admin
    .from('active_unconnected_people')
    .select('*')
    .eq('church_id', churchId)

  if (search.trim().length >= 2) {
    query = query.ilike('name', `%${search.trim()}%`)
  }

  const { data: people } = await query.order('name').limit(200)

  // Stats (admin only) — use DB aggregation
  let stats = null
  if (appUser.role === 'super_admin') {
    const [{ data: coverage }, { data: typeBreakdown }] = await Promise.all([
      admin.from('care_coverage_summary').select('*').limit(1).single(),
      admin.rpc('get_unconnected_type_counts', { p_church_id: churchId }),
    ])

    let typeCounts: Record<string, number> = {}
    if (typeBreakdown && Array.isArray(typeBreakdown)) {
      for (const row of typeBreakdown) {
        typeCounts[row.membership_type || 'Unknown'] = row.cnt
      }
    } else {
      for (const p of people || []) {
        const t = p.membership_type || 'Unknown'
        typeCounts[t] = (typeCounts[t] || 0) + 1
      }
    }

    stats = {
      totalActive: coverage?.total_active_people || 0,
      unassigned: coverage?.unconnected_active || 0,
      assigned: coverage?.has_shepherd || 0,
      connectionPct: coverage?.connection_pct || 0,
      byMembershipType: typeCounts,
    }
  }

  return NextResponse.json({
    people: people || [],
    stats,
    userRole: appUser.role,
  })
}
