import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Fast, narrow people search for pickers.
 * Returns at most `limit` rows of just { id, name } matching the query
 * against `name` (case-insensitive). Excludes system/placeholder rows.
 *
 * Query params:
 *  - q: search string (optional; if empty, returns first N people)
 *  - limit: max rows (default 20, clamped to 50)
 */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users')
    .select('church_id, role')
    .eq('user_id', user.id)
    .single()
  if (!appUser?.church_id) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const params = request.nextUrl.searchParams
  const q = (params.get('q') || '').trim()
  const limitRaw = parseInt(params.get('limit') || '20', 10)
  const limit = Math.min(Math.max(Number.isFinite(limitRaw) ? limitRaw : 20, 1), 50)

  let query = supabase
    .from('people')
    .select('id, name, is_staff, is_leader')
    .eq('church_id', appUser.church_id)
    .eq('status', 'active')
    .not('name', 'like', '\\_%')
    .not('name', 'like', '-%')
    .neq('membership_type', 'SYSTEM USE - Do Not Delete')

  if (q) {
    // Simple ILIKE — backed by the lower(name) functional index added in migration.
    query = query.ilike('name', `%${q}%`)
  }

  const { data, error } = await query.order('name').limit(limit)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    people: (data || []).map(p => ({
      id: p.id,
      name: p.name || 'Unknown',
      isStaff: !!p.is_staff,
      isLeader: !!p.is_leader,
    })),
  })
}
