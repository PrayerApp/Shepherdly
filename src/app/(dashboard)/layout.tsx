import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { DashboardShell } from '@/components/layout/DashboardShell'

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: appUser } = await supabase
    .from('users')
    .select('*')
    .eq('user_id', user.id)
    .single()

  if (!appUser) {
    await supabase.auth.signOut()
    redirect('/login?error=no_access')
  }

  return <DashboardShell user={appUser}>{children}</DashboardShell>
}
