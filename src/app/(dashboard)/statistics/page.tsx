'use client'

import { useEffect, useMemo, useState } from 'react'
import { LineChart, Line, ResponsiveContainer, Tooltip } from 'recharts'
import { Modal } from '@/components/ui'

interface TypeStat {
  typeId: string
  typeName: string
  contexts: number
  staff: number
  members: number
  leaders: number
  joinedRecent: number
  exitedRecent: number
  delta: number
  series: { at: string; members: number; leaders: number }[]
  avgTenureActiveDays: number | null
  avgTenureExitedDays: number | null
}

interface Totals {
  contexts: number
  staff: number
  members: number
  leaders: number
  joinedRecent: number
  exitedRecent: number
}

interface StatsPayload {
  measurementDays: number
  snapshotPoints: number
  generatedAt: string
  categories: { total: number; shepherded: number; active: number; present: number; excluded: number }
  groupsByType: TypeStat[]
  teamsByType: TypeStat[]
  totals: { groups: Totals; teams: Totals }
  ratios: { groupLeaderToMember: number | null; teamLeaderToMember: number | null }
  perPerson: { avgContexts: number | null; avgGroupAttendanceRate: number | null }
}

const STORAGE_KEY = 'shepherdly.stats.excluded.v1'

type ExcludedConfig = { groupTypes: string[]; teamTypes: string[] }

function loadExcluded(): ExcludedConfig {
  if (typeof window === 'undefined') return { groupTypes: [], teamTypes: [] }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return { groupTypes: [], teamTypes: [] }
    const parsed = JSON.parse(raw)
    return {
      groupTypes: Array.isArray(parsed?.groupTypes) ? parsed.groupTypes : [],
      teamTypes: Array.isArray(parsed?.teamTypes) ? parsed.teamTypes : [],
    }
  } catch {
    return { groupTypes: [], teamTypes: [] }
  }
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
  if (n > 0) return 'var(--color-status-joined)'
  if (n < 0) return 'var(--color-status-exited)'
  return 'var(--foreground-muted)'
}

/*
 * Mini-bar trend used inline on table rows. 5 bars, one per snapshot,
 * scaled by the max total in the series. Cheaper than rendering an
 * inline Recharts container per row (which previously re-mounted a
 * full ResponsiveContainer for every row on every sort).
 */
function MiniBars({ series }: { series: TypeStat['series'] }) {
  const totals = [...series].reverse().map(s => s.members + s.leaders)
  const max = Math.max(1, ...totals)
  return (
    <div
      className="flex items-end gap-0.5"
      style={{ width: 64, height: 24 }}
      aria-label={`Trend: ${totals.join(', ')}`}
    >
      {totals.map((t, i) => {
        const h = Math.max(2, Math.round((t / max) * 22))
        return (
          <span
            key={i}
            className="block w-full rounded-sm"
            style={{ height: h, background: 'var(--color-green-600)' }}
          />
        )
      })}
    </div>
  )
}

/*
 * Larger trend rendered inside an expanded detail row. Recharts here is
 * fine because it only renders for the currently-expanded row, not
 * every row on every sort.
 */
function ExpandedTrend({ series }: { series: TypeStat['series'] }) {
  const data = [...series].reverse().map((s, i) => ({
    i,
    label: new Date(s.at).toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    total: s.members + s.leaders,
    members: s.members,
    leaders: s.leaders,
  }))
  return (
    <div style={{ height: 120 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 6, right: 12, bottom: 0, left: 0 }}>
          <Line type="monotone" dataKey="total" stroke="var(--color-green-700)" strokeWidth={2} dot />
          <Tooltip
            cursor={false}
            contentStyle={{
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: 'var(--radius-md)',
              fontSize: 12,
            }}
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

function DetailMetric({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-neutral-500">{label}</div>
      <div className="font-serif text-lg tabular-nums" style={{ color: color ?? 'var(--foreground)' }}>{value}</div>
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

type SortDir = 'asc' | 'desc'
type SortKey =
  | 'typeName' | 'contexts' | 'staff' | 'leaders' | 'members' | 'ratio'
  | 'joinedRecent' | 'exitedRecent' | 'delta' | 'tenureActive' | 'tenureExited'

type ColumnDef = {
  key: SortKey
  label: string
  align: 'left' | 'right'
  numeric: boolean
  accessor: (r: TypeStat) => number | string | null
  /* Tier 1 columns are visible always; tier 2 columns only show in
   * the expanded detail row. Cuts the always-on column count from 11
   * to 5 so the table fits without horizontal scroll under 1400px. */
  tier: 1 | 2
  // Color for numeric display, optional.
  format?: (r: TypeStat) => React.ReactNode
}

function formatRatio(r: TypeStat): string {
  if (r.members <= 0) return '—'
  const ratio = r.leaders / r.members
  if (ratio <= 0) return '—'
  return `1 : ${Math.round(1 / ratio)}`
}

function ratioNumeric(r: TypeStat): number {
  if (r.members <= 0) return 0
  const ratio = r.leaders / r.members
  if (ratio <= 0) return 0
  // Sort by "people per leader" so fewer-people-per-leader sorts higher.
  return Math.round(1 / ratio)
}

const COLUMNS: ColumnDef[] = [
  { key: 'typeName', label: 'Type', align: 'left', numeric: false, tier: 1, accessor: r => r.typeName },
  { key: 'contexts', label: 'Contexts', align: 'right', numeric: true, tier: 1, accessor: r => r.contexts },
  { key: 'staff', label: 'Staff', align: 'right', numeric: true, tier: 1, accessor: r => r.staff },
  { key: 'members', label: 'Members', align: 'right', numeric: true, tier: 1, accessor: r => r.members },
  { key: 'delta', label: 'Δ 3mo', align: 'right', numeric: true, tier: 1, accessor: r => r.delta },
  { key: 'leaders', label: 'Leaders', align: 'right', numeric: true, tier: 2, accessor: r => r.leaders },
  { key: 'ratio', label: 'Ratio', align: 'right', numeric: true, tier: 2, accessor: ratioNumeric, format: r => formatRatio(r) },
  { key: 'joinedRecent', label: 'Joined 3mo', align: 'right', numeric: true, tier: 2, accessor: r => r.joinedRecent },
  { key: 'exitedRecent', label: 'Exited 3mo', align: 'right', numeric: true, tier: 2, accessor: r => r.exitedRecent },
  { key: 'tenureActive', label: 'Avg tenure (active)', align: 'right', numeric: true, tier: 2, accessor: r => r.avgTenureActiveDays ?? -1 },
  { key: 'tenureExited', label: 'Avg tenure (exited)', align: 'right', numeric: true, tier: 2, accessor: r => r.avgTenureExitedDays ?? -1 },
]

const PRIMARY_COLUMNS = COLUMNS.filter(c => c.tier === 1)
const DETAIL_COLUMNS = COLUMNS.filter(c => c.tier === 2)

function TypeTable({ title, rows, excluded, sort, onSort }: {
  title: string
  rows: TypeStat[]
  excluded: Set<string>
  sort: { key: SortKey; dir: SortDir }
  onSort: (key: SortKey) => void
}) {
  const visibleRows = useMemo(() => rows.filter(r => !excluded.has(r.typeId)), [rows, excluded])

  const sortedRows = useMemo(() => {
    const col = COLUMNS.find(c => c.key === sort.key)
    if (!col) return visibleRows
    const sorted = [...visibleRows].sort((a, b) => {
      const av = col.accessor(a)
      const bv = col.accessor(b)
      if (typeof av === 'string' || typeof bv === 'string') {
        return String(av).localeCompare(String(bv), undefined, { sensitivity: 'base' })
      }
      return (av as number) - (bv as number)
    })
    return sort.dir === 'desc' ? sorted.reverse() : sorted
  }, [visibleRows, sort])

  // Totals recomputed from visible-only rows so the footer matches
  // what's on screen. Staff here is a simple sum across types, so a
  // staff person who shepherds multiple visible types is counted
  // once per type — the page-level Totals object is the deduped
  // figure. Avg-tenure rolls up via a weighted average using
  // (members + leaders) as the weight, which approximates the true
  // average tenure across visible memberships without requiring raw
  // membership rows on the client.
  const totals = useMemo(() => {
    let contexts = 0, staff = 0, members = 0, leaders = 0
    let joined = 0, exited = 0
    let tenureActiveWeighted = 0, tenureActiveWeight = 0
    for (const r of visibleRows) {
      contexts += r.contexts
      staff += r.staff
      members += r.members
      leaders += r.leaders
      joined += r.joinedRecent
      exited += r.exitedRecent
      const w = r.members + r.leaders
      if (r.avgTenureActiveDays != null && w > 0) {
        tenureActiveWeighted += r.avgTenureActiveDays * w
        tenureActiveWeight += w
      }
    }
    const avgTenureActive = tenureActiveWeight > 0 ? Math.round(tenureActiveWeighted / tenureActiveWeight) : null
    return { contexts, staff, members, leaders, joined, exited, avgTenureActive }
  }, [visibleRows])
  const totalDelta = totals.joined - totals.exited

  const allExcluded = rows.length > 0 && rows.every(r => excluded.has(r.typeId))

  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const toggleExpanded = (typeId: string) => {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(typeId)) next.delete(typeId)
      else next.add(typeId)
      return next
    })
  }
  /* Total cells in a primary row: toggle + PRIMARY_COLUMNS + trend. */
  const PRIMARY_COL_COUNT = PRIMARY_COLUMNS.length + 2

  return (
    <section className="mb-10">
      <h2 className="text-lg font-serif mb-3" style={{ color: 'var(--foreground)' }}>{title}</h2>
      <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
        <table className="w-full text-sm sans">
          <caption className="sr-only">
            {title} — sortable; numeric columns are right-aligned. Click a row to expand additional metrics including leader counts, join/exit rates, and tenure averages.
          </caption>
          <thead>
            <tr style={{ background: 'var(--muted)' }}>
              <th scope="col" className="w-8 px-2 py-2.5" aria-label="Expand row" />
              {PRIMARY_COLUMNS.map(c => {
                const isSorted = sort.key === c.key
                const ariaSort = isSorted
                  ? sort.dir === 'asc' ? 'ascending' : 'descending'
                  : 'none'
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={ariaSort}
                    className={`px-3 py-2.5 font-medium ${c.align === 'right' ? 'text-right' : 'text-left'}`}
                    style={{ color: 'var(--foreground-muted)' }}
                  >
                    <button
                      type="button"
                      onClick={() => onSort(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-neutral-900 ${c.align === 'right' ? 'flex-row-reverse' : ''}`}
                      aria-label={`Sort by ${c.label}`}
                    >
                      <span>{c.label}</span>
                      {isSorted && (
                        <span aria-hidden className="text-[10px]">{sort.dir === 'asc' ? '▲' : '▼'}</span>
                      )}
                    </button>
                  </th>
                )
              })}
              <th scope="col" className="text-left px-3 py-2.5 font-medium" style={{ color: 'var(--foreground-muted)' }}>Trend</th>
            </tr>
          </thead>
          <tbody>
            {allExcluded ? (
              <tr>
                <td colSpan={PRIMARY_COL_COUNT} className="text-center py-6" style={{ color: 'var(--foreground-muted)' }}>
                  All types excluded. Open settings to include some.
                </td>
              </tr>
            ) : sortedRows.length === 0 ? (
              <tr>
                <td colSpan={PRIMARY_COL_COUNT} className="text-center py-6" style={{ color: 'var(--foreground-muted)' }}>
                  No tracked types yet.
                </td>
              </tr>
            ) : sortedRows.flatMap(r => {
              const isExpanded = expanded.has(r.typeId)
              const out: React.ReactNode[] = [
                <tr
                  key={r.typeId}
                  className="border-t hover:bg-neutral-50/60"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <td className="w-8 px-2 py-2.5">
                    <button
                      type="button"
                      onClick={() => toggleExpanded(r.typeId)}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} details for ${r.typeName}`}
                      className="rounded p-1 text-neutral-500 hover:bg-neutral-200/50 hover:text-neutral-900"
                    >
                      <span aria-hidden className="inline-block text-xs leading-none">
                        {isExpanded ? '▾' : '▸'}
                      </span>
                    </button>
                  </td>
                  <td className="px-4 py-2.5" style={{ color: 'var(--foreground)' }}>{r.typeName}</td>
                  <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: 'var(--foreground)' }}>{fmtNum(r.contexts)}</td>
                  <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: 'var(--foreground)' }}>{fmtNum(r.staff)}</td>
                  <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: 'var(--foreground)' }}>{fmtNum(r.members)}</td>
                  <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: deltaColor(r.delta) }}>
                    {r.delta > 0 ? `+${r.delta}` : r.delta}
                  </td>
                  <td className="px-3 py-2.5"><MiniBars series={r.series} /></td>
                </tr>,
              ]
              if (isExpanded) {
                out.push(
                  <tr
                    key={`${r.typeId}-detail`}
                    className="border-t"
                    style={{ borderColor: 'var(--border)', background: 'var(--background-subtle)' }}
                  >
                    <td colSpan={PRIMARY_COL_COUNT} className="px-6 py-4">
                      <div className="grid grid-cols-2 gap-x-8 gap-y-3 md:grid-cols-3 lg:grid-cols-6 mb-4">
                        <DetailMetric label="Leaders" value={fmtNum(r.leaders)} />
                        <DetailMetric label="Ratio" value={formatRatio(r)} />
                        <DetailMetric label="Joined 3mo" value={fmtNum(r.joinedRecent)} color="var(--color-status-joined)" />
                        <DetailMetric label="Exited 3mo" value={fmtNum(r.exitedRecent)} color="var(--color-status-exited)" />
                        <DetailMetric label="Avg tenure (active)" value={fmtDays(r.avgTenureActiveDays)} />
                        <DetailMetric label="Avg tenure (exited)" value={fmtDays(r.avgTenureExitedDays)} />
                      </div>
                      <div>
                        <div className="text-[11px] uppercase tracking-wider text-neutral-500 mb-1">12-month trend</div>
                        <ExpandedTrend series={r.series} />
                      </div>
                    </td>
                  </tr>,
                )
              }
              return out
            })}
          </tbody>
          {sortedRows.length > 0 && (
            <tfoot>
              <tr style={{ background: 'var(--muted)', fontWeight: 500 }}>
                <td />
                <td className="px-4 py-2.5" style={{ color: 'var(--foreground)' }}>Total (visible)</td>
                <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: 'var(--foreground)' }}>{fmtNum(totals.contexts)}</td>
                <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: 'var(--foreground)' }}>{fmtNum(totals.staff)}</td>
                <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: 'var(--foreground)' }}>{fmtNum(totals.members)}</td>
                <td className="text-right px-3 py-2.5 tabular-nums" style={{ color: deltaColor(totalDelta) }}>
                  {totalDelta > 0 ? `+${totalDelta}` : totalDelta}
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  )
}

function SettingsModal({ open, onClose, groupTypes, teamTypes, excluded, setExcluded }: {
  open: boolean
  onClose: () => void
  groupTypes: TypeStat[]
  teamTypes: TypeStat[]
  excluded: ExcludedConfig
  setExcluded: (e: ExcludedConfig) => void
}) {
  const toggle = (kind: 'groupTypes' | 'teamTypes', id: string) => {
    const set = new Set(excluded[kind])
    if (set.has(id)) set.delete(id); else set.add(id)
    setExcluded({ ...excluded, [kind]: [...set] })
  }
  const setAllForKind = (kind: 'groupTypes' | 'teamTypes', typeIds: string[], exclude: boolean) => {
    setExcluded({ ...excluded, [kind]: exclude ? typeIds : [] })
  }
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Statistics settings"
      description="Unchecked types are hidden from the tables and totals on this page. Settings are saved in your browser only."
      size="lg"
    >
      <div className="space-y-6">
        {[
          { title: 'Group types', kind: 'groupTypes' as const, types: groupTypes },
          { title: 'Team service types', kind: 'teamTypes' as const, types: teamTypes },
        ].map(section => {
          const allIds = section.types.map(t => t.typeId)
          const excludedSet = new Set(excluded[section.kind])
          const allExcluded = allIds.length > 0 && allIds.every(id => excludedSet.has(id))
          return (
            <div key={section.kind}>
              <div className="mb-2 flex items-center justify-between">
                <h4 className="text-sm font-medium text-neutral-900">{section.title}</h4>
                <div className="space-x-2 text-xs">
                  <button
                    type="button"
                    className="text-green-700 underline hover:text-green-800"
                    onClick={() => setAllForKind(section.kind, allIds, false)}
                  >
                    Include all
                  </button>
                  <button
                    type="button"
                    className="text-red-500 underline hover:text-red-600"
                    onClick={() => setAllForKind(section.kind, allIds, true)}
                  >
                    Exclude all
                  </button>
                </div>
              </div>
              {section.types.length === 0 ? (
                <p className="text-xs text-neutral-500">No types tracked.</p>
              ) : (
                <div className="grid grid-cols-1 gap-1 md:grid-cols-2">
                  {section.types.map(t => (
                    <label key={t.typeId} className="flex cursor-pointer items-center gap-2 py-1 text-sm">
                      <input
                        type="checkbox"
                        checked={!excludedSet.has(t.typeId)}
                        onChange={() => toggle(section.kind, t.typeId)}
                      />
                      <span className="text-neutral-900">{t.typeName}</span>
                      <span className="text-xs text-neutral-500">
                        ({t.contexts} contexts, {t.members + t.leaders} ppl)
                      </span>
                    </label>
                  ))}
                </div>
              )}
              {allExcluded && section.types.length > 0 && (
                <p className="mt-2 text-xs text-red-500">
                  All {section.title.toLowerCase()} excluded.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </Modal>
  )
}

function GearIcon() {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
}

export default function StatisticsPage() {
  const [data, setData] = useState<StatsPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [excluded, setExcludedState] = useState<ExcludedConfig>({ groupTypes: [], teamTypes: [] })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [groupSort, setGroupSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'members', dir: 'desc' })
  const [teamSort, setTeamSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'members', dir: 'desc' })

  // Load persisted excluded types once.
  useEffect(() => { setExcludedState(loadExcluded()) }, [])

  const setExcluded = (next: ExcludedConfig) => {
    setExcludedState(next)
    if (typeof window !== 'undefined') {
      try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore quota */ }
    }
  }

  useEffect(() => {
    let cancelled = false
    fetch('/api/statistics')
      .then(r => r.ok ? r.json() : Promise.reject(`HTTP ${r.status}`))
      .then(d => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(e => { if (!cancelled) { setError(String(e)); setLoading(false) } })
    return () => { cancelled = true }
  }, [])

  const toggleSort = (setter: typeof setGroupSort) => (key: SortKey) => {
    setter(cur => cur.key === key
      ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'typeName' ? 'asc' : 'desc' })
  }

  const excludedGroupSet = useMemo(() => new Set(excluded.groupTypes), [excluded.groupTypes])
  const excludedTeamSet = useMemo(() => new Set(excluded.teamTypes), [excluded.teamTypes])

  if (loading) return <div className="p-8 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading statistics…</div>
  if (error) return <div className="p-8 sans text-sm" style={{ color: 'var(--color-status-exited)' }}>Failed to load: {error}</div>
  if (!data) return null

  return (
    <div className="p-8 max-w-7xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-serif" style={{ color: 'var(--foreground)' }}>Statistics</h1>
          <p className="mt-1 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
            Measurement threshold: {data.measurementDays} days · Trend shows {data.snapshotPoints} snapshots at {data.measurementDays}-day intervals (oldest left).
          </p>
        </div>
        <button
          onClick={() => setSettingsOpen(true)}
          className="rounded-lg border px-3 py-2 text-sm sans flex items-center gap-2 hover:opacity-80"
          style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)', background: 'var(--card)' }}
          title="Statistics settings">
          <GearIcon />
          <span>Settings</span>
        </button>
      </div>

      {/* Categories of People */}
      <section className="mb-10">
        <h2 className="text-lg font-serif mb-3" style={{ color: 'var(--foreground)' }}>Categories of People</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <CategoryCard label="Total active" value={data.categories.total} total={data.categories.total} color="var(--foreground)" />
          <CategoryCard label="Shepherded" value={data.categories.shepherded} total={data.categories.total} color="var(--color-status-joined)" />
          <CategoryCard label="Active" value={data.categories.active} total={data.categories.total} color="var(--color-role-leader)" />
          <CategoryCard label="Present" value={data.categories.present} total={data.categories.total} color="var(--foreground-muted)" />
        </div>
        <p className="mt-3 text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
          Shepherded: in a group/team, carrying an Outreach Partner membership type, or checked in through a kids/ministry context in the last 12 months.
          Active: non-shepherded with a registration or prayer submission in the last 12 months, plus limited-engagement membership types (Benevolence / Activity / Parent / Online Submission Only).
          Present: other active PCO records.
          {data.categories.excluded > 0 ? ` ${data.categories.excluded} excluded (SYSTEM / Former Member, treated as inactive).` : ''}
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

      <TypeTable
        title="Groups by type"
        rows={data.groupsByType}
        excluded={excludedGroupSet}
        sort={groupSort}
        onSort={toggleSort(setGroupSort)}
      />
      <TypeTable
        title="Teams by service type"
        rows={data.teamsByType}
        excluded={excludedTeamSet}
        sort={teamSort}
        onSort={toggleSort(setTeamSort)}
      />

      <p className="text-xs sans mt-6" style={{ color: 'var(--foreground-muted)' }}>
        Generated {new Date(data.generatedAt).toLocaleString()}.
        {(excluded.groupTypes.length + excluded.teamTypes.length) > 0 && (
          <> · Excluding {excluded.groupTypes.length + excluded.teamTypes.length} type(s) from tables below (categories above still reflect the full dataset — see followup).</>
        )}
      </p>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        groupTypes={data.groupsByType}
        teamTypes={data.teamsByType}
        excluded={excluded}
        setExcluded={setExcluded}
      />
    </div>
  )
}
