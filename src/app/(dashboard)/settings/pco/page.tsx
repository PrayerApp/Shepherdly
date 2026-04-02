import { createClient } from '@/lib/supabase/server'
import PcoSettingsForm from './PcoSettingsForm'

export default async function PcoSettingsPage() {
  const supabase = await createClient()
  const { data: settings } = await supabase
    .from('church_settings')
    .select('*')
    .single()

  return (
    <div className="p-8 max-w-2xl">
      <h1 className="text-3xl font-serif mb-1" style={{ color: 'var(--primary)' }}>PCO Connection</h1>
      <p className="sans text-sm mb-8" style={{ color: 'var(--muted-foreground)' }}>
        Connect Shepherdly to Planning Center Online to sync your people, groups, and attendance.
      </p>
      <PcoSettingsForm settings={settings} />
    </div>
  )
}
