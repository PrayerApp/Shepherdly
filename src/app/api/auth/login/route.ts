import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { code } = await request.json()
  if (!code?.trim()) return NextResponse.json({ error: 'Code is required' }, { status: 400 })

  const admin = createAdminClient()

  // Look up the access code
  const { data: accessCode, error } = await admin
    .from('access_codes')
    .select('id, user_id, code, is_active')
    .eq('code', code.trim().toUpperCase())
    .eq('is_active', true)
    .single()

  if (error || !accessCode) {
    return NextResponse.json({ error: 'Invalid or inactive access code.' }, { status: 401 })
  }

  // Look up the linked app user
  const { data: appUser, error: userError } = await admin
    .from('app_users')
    .select('id, email, is_active')
    .eq('id', accessCode.user_id)
    .single()

  if (userError || !appUser) {
    return NextResponse.json({ error: 'No account linked to this code.' }, { status: 401 })
  }

  if (!appUser.is_active) {
    return NextResponse.json({ error: 'Your account has been deactivated.' }, { status: 403 })
  }

  // Generate a magic link server-side (no email sent)
  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email: appUser.email,
    options: { redirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback` }
  })

  if (linkError || !linkData) {
    return NextResponse.json({ error: 'Failed to create session.' }, { status: 500 })
  }

  // Update last_used_at
  await admin.from('access_codes').update({ last_used_at: new Date().toISOString() }).eq('id', accessCode.id)

  // Extract token and exchange for session
  const url = new URL(linkData.properties.action_link)
  const token = url.searchParams.get('token')
  if (!token) return NextResponse.json({ error: 'Token missing.' }, { status: 500 })

  const supabase = await createClient()
  const { error: sessionError } = await supabase.auth.verifyOtp({
    token_hash: token,
    type: 'magiclink',
  })

  if (sessionError) {
    return NextResponse.json({ error: 'Failed to establish session.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
