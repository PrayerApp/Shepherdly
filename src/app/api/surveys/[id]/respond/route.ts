import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('id, church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })

  const { answers, is_urgent, target_person_id, context_type, context_id } = await request.json()
  if (!answers || Object.keys(answers).length === 0) {
    return NextResponse.json({ error: 'Answers required' }, { status: 400 })
  }

  const { data: response, error } = await supabase
    .from('survey_responses')
    .insert({
      survey_id: id,
      respondent_id: appUser.id,
      target_person_id: target_person_id || null,
      context_type: context_type || null,
      context_id: context_id || null,
      answers,
      is_urgent: !!is_urgent,
      church_id: appUser.church_id,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ response })
}
