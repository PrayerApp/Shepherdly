import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: report, error } = await supabase
    .from('ministry_impact_reports')
    .select('*')
    .eq('id', id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 404 })
  return NextResponse.json({ report })
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const updates: Record<string, unknown> = {}
  if (body.title !== undefined) updates.title = body.title
  if (body.reporting_period_start !== undefined) updates.reporting_period_start = body.reporting_period_start
  if (body.reporting_period_end !== undefined) updates.reporting_period_end = body.reporting_period_end
  if (body.metrics !== undefined) updates.metrics = body.metrics
  if (body.narrative !== undefined) updates.narrative = body.narrative
  if (body.outcomes !== undefined) updates.outcomes = body.outcomes
  if (body.status !== undefined) updates.status = body.status

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 })
  }

  const { error } = await supabase
    .from('ministry_impact_reports')
    .update(updates)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('role').eq('user_id', user.id).single()
  if (!['super_admin', 'staff'].includes(appUser?.role || ''))
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  // Only allow deleting drafts
  const { data: report } = await supabase
    .from('ministry_impact_reports').select('status').eq('id', id).single()
  if (report?.status !== 'draft')
    return NextResponse.json({ error: 'Only drafts can be deleted' }, { status: 400 })

  const { error } = await supabase
    .from('ministry_impact_reports').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
