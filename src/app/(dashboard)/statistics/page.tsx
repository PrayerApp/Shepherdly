'use client'

import { useEffect, useState } from 'react'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'

interface TypeStat {
  typeId: string
  typeName: string
  contexts: number
  members: number
  leaders: number
  joinedRecent: number
  exitedRecent: number
  delta: number
  series: { at: string; members: number; leaders: number }[]
  avgTenureActiveDays: number | null
  avgTenureExitedDays: number | null
}

interface StatsPayload {
  measurementDays: number
  snapshotPoints: number
  generatedAt: string
  categories: { total: number; shepherded: number; active: number; present: number }
  groupsByType: TypeStat[]
  teamsByType: TypeStat[]
  totals: {
    groups: { contexts: number; members: number; leaders: number; joinedRecent: number; exitedRecent: number }
    teams: { contexts: number; members: number; leaders: number; joinedRecent: number; exitedRecent: number }
  }
  ratios: { groupLeaderToMember: number | null; teamLeaderToMember: number | null }
  perPerson: { avgContexts: number | null; avgGroupAttendanceRate: number | null }
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return '—'
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString()
}

function fmtDays(n: number | null): string {
  if (n == null) return '—'
  if (n < 60) return `${n}d`
  if (n < 730) return `${Math.round(n / 30)}mo`
  return `${Math.round(n / 365 * 10) / 10}y`
}

function deltaColor(n: number): string {
  if (n > 0) return '#2a6a3a'
  if (n < 0) return '#8a3a3a'
  return 'var(--foreground-muted)'
}

function Sparkline({ series }: { series: TypeStat['series'] }) {
  // Reverse so oldest → newest left-to-right.
  const data = [...series].reverse().map((s, i) => ({ i, total: s.members + s.leaders }))
  return (
    <div style={{ width: 100, height: 30 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <Line type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={1.5} dot={false} />
          <Tooltip
            cursor={false}
            contentStyle={{ fontSize: 11, padding: '2px 6px' }}
            formatter={(v: unknown) => [String(v), 'total']}
            labelFormatter={() => ''}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function CategoryCard({ label, value, total, color }: { label: string; value: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((value / total) * 100) : 0
  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="text-xs font-medium sans uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>{label}</div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-3xl font-serif" style={{ color }}>{fmtNum(value)}</span>
        <span className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>{pct}%</span>
      </div>
      <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function TypeTable({ title, rows, totals, showTenure }: {
  title: string
  rows: TypeStat[]
  totals: StatsPayload['totals']['groups']
  showTenure: boolean
}) {
  return (
    <section className="mb-10">
      <h2 className="text-lg font-serif mb-3" style={{ color: 'var(--foreground)' }}>{title}</h2>
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
        <table className="w-full text-sm sans">
          <thead>
            <tr style={{ background: 'var(--muted)' }}>
              <th className="text-left px-4 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Type</th>
              <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Contexts</th>
              <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Members</th>
              <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Leaders</th>
              <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Ratio</th>
              <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Joined 3mo</th>
              <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Exited 3mo</th>
              <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Δ</th>
              {showTenure && (
                <>
                  <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Avg tenure (active)</th>
                  <th className="text-right px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Avg tenure (exited)</th>
                </>
              )}
              <th className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={showTenure ? 11 : 9} className="text-center py-6" style={{ color: 'var(--foreground-muted)' }}>
                  No tracked types yet.
                </td>
              </tr>
            ) : rows.map(r => {
              const ratio = r.members > 0 ? (r.leaders / r.members) : null
              return (
                <tr key={r.typeId} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-4 py-2.5" style={{ color: 'var(--foreground)' }}>{r.typeName}</td>
                  <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground)' }}>{fmtNum(r.contexts)}</td>
                  <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground)' }}>{fmtNum(r.members)}</td>
                  <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground)' }}>{fmtNum(r.leaders)}</td>
                  <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground-muted)' }}>
                    {ratio != null ? `1 : ${Math.round(1 / ratio)}` : '—'}
                  </td>
                  <td className="text-right px-3 py-2.5" style={{ color: '#2a6a3a' }}>{fmtNum(r.joinedRecent)}</td>
                  <td className="text-right px-3 py-2.5" style={{ color: '#8a3a3a' }}>{fmtNum(r.exitedRecent)}</td>
                  <td className="text-right px-3 py-2.5" style={{ color: deltaColor(r.delta) }}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </td>
                  {showTenure && (
                    <>
                      <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground)' }}>{fmtDays(r.avgTenureActiveDays)}</td>
                      <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground-muted)' }}>{fmtDays(r.avgTenureExitedDays)}</td>
                    </>
                  )}
                  <td className="px-3 py-2.5"><Sparkline series={r.series} /></td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--muted)', fontWeight: 500 }}>
              <td className="px-4 py-2.5" style={{ color: 'var(--foreground)' }}>Total</td>
              <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground)' }}>{fmtNum(totals.contexts)}</td>
              <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground)' }}>{fmtNum(totals.members)}</td>
              <td className="text-right px-3 py-2.5" style={{ color: 'var(--foreground)' }}>{fmtNum(totals.leaders)}</td>
              <td></td>
              <td className="text-right px-3 py-2.5" style={{ color: '#2a6a3a' }}>{fmtNum(totals.joinedRecent)}</td>
              <td className="text-right px-3 py-2.5" style={{ color: '#8a3a3a' }}>{fmtNum(totals.exitedRecent)}</td>
              <td className="text-right px-3 py-2.5" style={{ color: deltaColor(totals.joinedRecent - totals.exitedRecent) }}>
                {(() => { const d = totals.joinedRecent - totals.exitedRecent; return d > 0 ? `+${d}` : d })()}
              </td>
              {showTenure && (<><td></td><td></td></>)}
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  )
}

export default function StatisticsPage() {
  const [data, setData] = useState<StatsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/api/statistics')
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="p-8 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading statistics…</div>
  if (error) return <div className="p-8 sans text-sm" style={{ color: '#8a3a3a' }}>Failed to load: {error}</div>
  if (!data) return null

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-3xl font-serif" style={{ color: 'var(--foreground)' }}>Statistics</h1>
        <p className="mt-1 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
          Measurement threshold: {data.measurementDays} days · Trend shows {data.snapshotPoints} snapshots at {data.measurementDays}-day intervals (oldest left).
        </p>
      </div>

      {/* Categories of People */}
      <section className="mb-10">
        <h2 className="text-lg font-serif mb-3" style={{ color: 'var(--foreground)' }}>Categories of People</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <CategoryCard label="Total active" value={data.categories.total} total={data.categories.total} color="var(--foreground)" />
          <CategoryCard label="Shepherded" value={data.categories.shepherded} total={data.categories.total} color="#2a6a3a" />
          <CategoryCard label="Active" value={data.categories.active} total={data.categories.total} color="#c17f3e" />
          <CategoryCard label="Present" value={data.categories.present} total={data.categories.total} color="var(--foreground-muted)" />
        </div>
        <p className="mt-3 text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
          Shepherded: in at least one group or team. Active: not shepherded but has an engagement signal in the last year. Present: every other active PCO record.
        </p>
      </section>

      {/* Per-person key metrics */}
      <section className="mb-10">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <KeyMetric label="Avg contexts per person" value={data.perPerson.avgContexts != null ? data.perPerson.avgContexts.toString() : '—'} />
          <KeyMetric label="Avg group attendance" value={data.perPerson.avgGroupAttendanceRate != null ? `${Math.round(data.perPerson.avgGroupAttendanceRate * 100)}%` : '—'} />
          <KeyMetric label="Group leader : member" value={data.ratios.groupLeaderToMember != null ? `1 : ${Math.round(1 / data.ratios.groupLeaderToMember)}` : '—'} />
          <KeyMetric label="Team leader : member" value={data.ratios.teamLeaderToMember != null ? `1 : ${Math.round(1 / data.ratios.teamLeaderToMember)}` : '—'} />
        </div>
      </section>

      <TypeTable title="Groups by type" rows={data.groupsByType} totals={data.totals.groups} showTenure />
      <TypeTable title="Teams by service type" rows={data.teamsByType} totals={data.totals.teams} showTenure />

      <p className="text-xs sans mt-6" style={{ color: 'var(--foreground-muted)' }}>
        Generated {new Date(data.generatedAt).toLocaleString()}.
      </p>
    </div>
  )
}

function KeyMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
      <div className="text-xs font-medium sans uppercase tracking-wider" style={{ color: 'var(--foreground-muted)' }}>{label}</div>
      <div className="mt-1.5 text-2xl font-serif" style={{ color: 'var(--foreground)' }}>{value}</div>
    </div>
  )
}
