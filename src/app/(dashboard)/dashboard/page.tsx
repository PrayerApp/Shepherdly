import { createClient } from '@/lib/supabase/server'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: appUser } = await supabase
    .from('app_users')
    .select('*')
    .eq('id', user!.id)
    .single()

  const { count: flockCount } = await supabase
    .from('shepherding_assignments')
    .select('*', { count: 'exact', head: true })
    .eq('shepherd_user_id', user!.id)
    .eq('is_active', true)

  const { count: checkinCount } = await supabase
    .from('checkins')
    .select('*', { count: 'exact', head: true })
    .eq('shepherd_user_id', user!.id)
    .gte('occurred_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())

  const now = new Date()
  const hour = now.getHours()
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening'

  return (
    <div className="p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-serif" style={{ color: 'var(--primary)' }}>
          {greeting}, {appUser?.full_name?.split(' ')[0] || 'friend'} 👋
        </h1>
        <p className="mt-1 sans text-sm" style={{ color: 'var(--muted-foreground)' }}>
          Here's the health of your flock at a glance.
        </p>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard label="In My Flock" value={flockCount ?? 0} icon="🐑" color="var(--primary)" />
        <StatCard label="Check-ins (30 days)" value={checkinCount ?? 0} icon="✅" color="var(--success)" />
        <StatCard label="Need Follow-up" value={0} icon="🔔" color="var(--warning)" />
        <StatCard label="Unassigned" value={0} icon="⚠️" color="var(--danger)" />
      </div>

      {/* Placeholder sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-2xl border p-6" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-serif text-lg mb-4" style={{ color: 'var(--primary)' }}>Recent Check-ins</h2>
          <div className="text-sm sans text-center py-8" style={{ color: 'var(--muted-foreground)' }}>
            No check-ins logged yet.<br />
            <a href="/checkins" className="underline mt-1 inline-block" style={{ color: 'var(--accent)' }}>
              Log your first check-in →
            </a>
          </div>
        </div>
        <div className="bg-white rounded-2xl border p-6" style={{ borderColor: 'var(--border)' }}>
          <h2 className="font-serif text-lg mb-4" style={{ color: 'var(--primary)' }}>Needs Attention</h2>
          <div className="text-sm sans text-center py-8" style={{ color: 'var(--muted-foreground)' }}>
            Everyone is accounted for. 🎉
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, icon, color }: { label: string; value: number; icon: string; color: string }) {
  return (
    <div className="bg-white rounded-2xl border p-5" style={{ borderColor: 'var(--border)' }}>
      <div className="flex items-start justify-between mb-3">
        <span className="text-xl">{icon}</span>
        <div className="w-2 h-2 rounded-full" style={{ background: color }} />
      </div>
      <div className="text-3xl font-serif" style={{ color }}>{value.toLocaleString()}</div>
      <div className="text-xs sans mt-1" style={{ color: 'var(--muted-foreground)' }}>{label}</div>
    </div>
  )
}
