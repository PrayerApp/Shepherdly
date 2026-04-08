'use client'

import { useState, useEffect, useCallback } from 'react'

interface MirRow {
  id: string
  title: string
  reporting_period_start: string | null
  reporting_period_end: string | null
  metrics: Record<string, string | number>
  narrative: string | null
  outcomes: string | null
  status: string
  created_at: string
}

interface MetricEntry { key: string; value: string }

const STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  draft: { bg: '#f3f4f6', text: '#6b7280', label: 'Draft' },
  submitted: { bg: '#dbeafe', text: '#1e40af', label: 'Submitted' },
  approved: { bg: '#dcfce7', text: '#166534', label: 'Approved' },
}

export default function MirPage() {
  const [reports, setReports] = useState<MirRow[]>([])
  const [userRole, setUserRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [editing, setEditing] = useState<MirRow | null>(null)

  const fetchReports = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/mir')
    const data = await res.json()
    setReports(data.reports || [])
    setUserRole(data.userRole || '')
    setLoading(false)
  }, [])

  useEffect(() => { fetchReports() }, [fetchReports])

  const isAdmin = ['super_admin', 'staff'].includes(userRole)

  const handleStatusChange = async (id: string, status: string) => {
    await fetch(`/api/mir/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    })
    fetchReports()
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-serif" style={{ color: 'var(--foreground)' }}>Impact Reports</h1>
          <p className="mt-1 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
            Track and document ministry impact for reporting periods.
          </p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium sans"
            style={{ background: 'var(--primary)', color: 'white' }}>
            + New Report
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading…</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
          No impact reports yet. {isAdmin ? 'Create your first report.' : ''}
        </div>
      ) : (
        <div className="space-y-4">
          {reports.map(r => {
            const st = STATUS_STYLES[r.status] || STATUS_STYLES.draft
            return (
              <div key={r.id} className="rounded-xl border p-5"
                style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-xs sans px-2 py-0.5 rounded-full font-medium"
                    style={{ background: st.bg, color: st.text }}>{st.label}</span>
                  <h3 className="font-medium sans text-sm" style={{ color: 'var(--foreground)' }}>{r.title}</h3>
                  <span className="text-xs sans ml-auto" style={{ color: 'var(--foreground-muted)' }}>
                    {r.reporting_period_start && r.reporting_period_end
                      ? `${formatDate(r.reporting_period_start)} – ${formatDate(r.reporting_period_end)}`
                      : 'No period set'}
                  </span>
                </div>

                {/* Metrics */}
                {r.metrics && Object.keys(r.metrics).length > 0 && (
                  <div className="flex flex-wrap gap-3 mb-3">
                    {Object.entries(r.metrics).map(([key, val]) => (
                      <div key={key} className="text-center px-3 py-1.5 rounded-lg" style={{ background: 'var(--muted)' }}>
                        <div className="text-lg font-serif" style={{ color: 'var(--primary)' }}>{val}</div>
                        <div className="text-[10px] sans" style={{ color: 'var(--foreground-muted)' }}>{key}</div>
                      </div>
                    ))}
                  </div>
                )}

                {r.narrative && (
                  <p className="text-sm sans mb-2 line-clamp-2" style={{ color: 'var(--foreground)' }}>{r.narrative}</p>
                )}

                <div className="flex gap-2 mt-3">
                  {isAdmin && r.status === 'draft' && (
                    <>
                      <button onClick={() => setEditing(r)}
                        className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: 'var(--muted)', color: 'var(--foreground-muted)' }}>Edit</button>
                      <button onClick={() => handleStatusChange(r.id, 'submitted')}
                        className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
                        style={{ background: '#dbeafe', color: '#1e40af' }}>Submit</button>
                    </>
                  )}
                  {isAdmin && r.status === 'submitted' && (
                    <button onClick={() => handleStatusChange(r.id, 'approved')}
                      className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
                      style={{ background: '#dcfce7', color: '#166534' }}>Approve</button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {(showCreate || editing) && (
        <MirFormModal
          existing={editing}
          onClose={() => { setShowCreate(false); setEditing(null) }}
          onSuccess={() => { setShowCreate(false); setEditing(null); fetchReports() }}
        />
      )}
    </div>
  )
}

function MirFormModal({ existing, onClose, onSuccess }: {
  existing: MirRow | null; onClose: () => void; onSuccess: () => void
}) {
  const [title, setTitle] = useState(existing?.title || '')
  const [periodStart, setPeriodStart] = useState(existing?.reporting_period_start || '')
  const [periodEnd, setPeriodEnd] = useState(existing?.reporting_period_end || '')
  const [metrics, setMetrics] = useState<MetricEntry[]>(
    existing?.metrics ? Object.entries(existing.metrics).map(([key, value]) => ({ key, value: String(value) })) : [{ key: '', value: '' }]
  )
  const [narrative, setNarrative] = useState(existing?.narrative || '')
  const [outcomes, setOutcomes] = useState(existing?.outcomes || '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const addMetric = () => setMetrics([...metrics, { key: '', value: '' }])
  const removeMetric = (i: number) => setMetrics(metrics.filter((_, idx) => idx !== i))
  const updateMetric = (i: number, field: 'key' | 'value', val: string) => {
    const updated = [...metrics]
    updated[i] = { ...updated[i], [field]: val }
    setMetrics(updated)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const metricsObj: Record<string, string | number> = {}
    metrics.filter(m => m.key.trim()).forEach(m => {
      metricsObj[m.key.trim()] = isNaN(Number(m.value)) ? m.value : Number(m.value)
    })

    const body = {
      title,
      reporting_period_start: periodStart || null,
      reporting_period_end: periodEnd || null,
      metrics: metricsObj,
      narrative: narrative || null,
      outcomes: outcomes || null,
    }

    const url = existing ? `/api/mir/${existing.id}` : '/api/mir'
    const method = existing ? 'PATCH' : 'POST'
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false) } else onSuccess()
  }

  const inputStyle = { borderColor: 'var(--border)', background: 'var(--muted)', color: 'var(--foreground)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(44,36,22,0.4)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="font-serif text-xl mb-4" style={{ color: 'var(--primary)' }}>
          {existing ? 'Edit Report' : 'New Impact Report'}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>Title</label>
            <input type="text" value={title} onChange={e => setTitle(e.target.value)} required
              placeholder="e.g. Q1 2026 Ministry Impact Report"
              className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none" style={inputStyle} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>Period Start</label>
              <input type="date" value={periodStart} onChange={e => setPeriodStart(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none" style={inputStyle} />
            </div>
            <div>
              <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>Period End</label>
              <input type="date" value={periodEnd} onChange={e => setPeriodEnd(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none" style={inputStyle} />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>Key Metrics</label>
            <div className="space-y-2">
              {metrics.map((m, i) => (
                <div key={i} className="flex gap-2">
                  <input type="text" value={m.key} onChange={e => updateMetric(i, 'key', e.target.value)}
                    placeholder="Metric name" className="flex-1 px-3 py-2 rounded-lg border text-sm sans outline-none" style={inputStyle} />
                  <input type="text" value={m.value} onChange={e => updateMetric(i, 'value', e.target.value)}
                    placeholder="Value" className="w-24 px-3 py-2 rounded-lg border text-sm sans outline-none" style={inputStyle} />
                  {metrics.length > 1 && (
                    <button type="button" onClick={() => removeMetric(i)} className="text-xs px-2" style={{ color: 'var(--danger)' }}>X</button>
                  )}
                </div>
              ))}
              <button type="button" onClick={addMetric} className="text-xs sans font-medium" style={{ color: 'var(--primary)' }}>+ Add metric</button>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>Narrative</label>
            <textarea value={narrative} onChange={e => setNarrative(e.target.value)} rows={4}
              placeholder="Describe the ministry impact during this period…"
              className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none resize-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>Outcomes</label>
            <textarea value={outcomes} onChange={e => setOutcomes(e.target.value)} rows={3}
              placeholder="Key outcomes and results…"
              className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none resize-none" style={inputStyle} />
          </div>
          {error && <p className="text-sm sans rounded-lg px-3 py-2" style={{ background: '#fef2f2', color: 'var(--danger)' }}>{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm sans border"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}>Cancel</button>
            <button type="submit" disabled={loading || !title.trim()}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium sans disabled:opacity-50"
              style={{ background: 'var(--primary)', color: 'white' }}>
              {loading ? 'Saving…' : existing ? 'Save Changes' : 'Create Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function formatDate(d: string): string {
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
