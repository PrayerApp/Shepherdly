import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

export async function POST(request: NextRequest) {
  const { code, email } = await request.json()
  if (!code?.trim()) return NextResponse.json({ error: 'Code is required' }, { status: 400 })
  if (!email?.trim()) return NextResponse.json({ error: 'Email is required' }, { status: 400 })

  const admin = createAdminClient()

  // Look up the church by invite code
  const { data: church, error } = await admin
    .from('churches')
    .select('id, name, invite_code')
    .ilike('invite_code', code.trim().toUpperCase())
    .single()

  if (error || !church) {
    return NextResponse.json({ error: 'Invalid invite code.' }, { status: 401 })
  }

  // Look up the user by email in this church
  const { data: appUser, error: userError } = await admin
    .from('users')
    .select('id, user_id, email, is_active, church_id')
    .eq('email', email.trim().toLowerCase())
    .eq('church_id', church.id)
    .single()

  if (userError || !appUser) {
    return NextResponse.json({ error: 'No account found for this email at this church.' }, { status: 401 })
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
