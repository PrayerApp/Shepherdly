'use client'

import { useState, useEffect, useCallback } from 'react'

interface ReportRow {
  id: string
  leader_id: string
  group_name: string | null
  going_well: string | null
  needs_attention: string | null
  prayer_requests: string | null
  is_urgent: boolean
  status: string
  report_date: string
  created_at: string
  leader: { id: string; name: string } | null
}

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  new: { bg: '#dbeafe', text: '#1e40af' },
  reviewed: { bg: '#fef3c7', text: '#92400e' },
  resolved: { bg: '#dcfce7', text: '#166534' },
}

function relativeDate(date: string): string {
  const days = Math.floor((Date.now() - new Date(date).getTime()) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export default function CheckinsPage() {
  const [reports, setReports] = useState<ReportRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [urgentOnly, setUrgentOnly] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)

  const fetchReports = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (filter !== 'all') params.set('status', filter)
    if (urgentOnly) params.set('urgent', 'true')
    const res = await fetch(`/api/checkins?${params}`)
    const data = await res.json()
    setReports(data.reports || [])
    setLoading(false)
  }, [filter, urgentOnly])

  useEffect(() => { fetchReports() }, [fetchReports])

  const handleStatusChange = async (id: string, newStatus: string) => {
    await fetch(`/api/checkins/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    fetchReports()
  }

  return (
    <div className="p-8 max-w-5xl">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-serif" style={{ color: 'var(--foreground)' }}>Check-in Reports</h1>
          <p className="mt-1 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
            {reports.length} report{reports.length !== 1 ? 's' : ''}
          </p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium sans"
          style={{ background: 'var(--primary)', color: 'white' }}>
          + New Report
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-6">
        {['all', 'new', 'reviewed', 'resolved'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className="px-3 py-1.5 rounded-lg text-sm sans font-medium transition-all"
            style={{
              background: filter === s ? 'var(--primary)' : 'var(--muted)',
              color: filter === s ? 'white' : 'var(--foreground-muted)',
            }}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
        <label className="flex items-center gap-2 ml-2 text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
          <input type="checkbox" checked={urgentOnly} onChange={e => setUrgentOnly(e.target.checked)} className="w-4 h-4 rounded" />
          Urgent only
        </label>
      </div>

      {loading ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading…</div>
      ) : reports.length === 0 ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
          No reports found. Submit your first check-in report to get started.
        </div>
      ) : (
        <div className="space-y-3">
          {reports.map(r => {
            const sc = STATUS_COLORS[r.status] || STATUS_COLORS.new
            const isExpanded = expanded === r.id
            return (
              <div key={r.id}
                className="rounded-xl border transition-all"
                style={{ background: 'var(--card)', borderColor: isExpanded ? 'var(--primary)' : 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
                <div className="p-4 cursor-pointer" onClick={() => setExpanded(isExpanded ? null : r.id)}>
                  <div className="flex items-center gap-3">
                    <span className="text-xs sans px-2 py-0.5 rounded-full font-medium"
                      style={{ background: sc.bg, color: sc.text }}>{r.status}</span>
                    {r.is_urgent && (
                      <span className="text-xs sans px-2 py-0.5 rounded-full font-medium"
                        style={{ background: '#fef2f2', color: '#dc4a4a' }}>Urgent</span>
                    )}
                    <span className="text-sm font-medium sans" style={{ color: 'var(--foreground)' }}>
                      {r.group_name || 'General'}
                    </span>
                    <span className="text-xs sans ml-auto" style={{ color: 'var(--foreground-muted)' }}>
                      {relativeDate(r.report_date || r.created_at)}
                      {r.leader && ` · ${r.leader.name}`}
                    </span>
                  </div>
                  {/* Preview */}
                  {!isExpanded && (
                    <div className="mt-2 text-xs sans truncate" style={{ color: 'var(--foreground-muted)' }}>
                      {r.going_well && `Going well: ${r.going_well.slice(0, 80)}...`}
                      {!r.going_well && r.needs_attention && `Needs attention: ${r.needs_attention.slice(0, 80)}...`}
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t px-4 py-4 space-y-4" style={{ borderColor: 'var(--border)' }}>
                    {r.going_well && (
                      <div>
                        <div className="text-xs font-semibold sans mb-1" style={{ color: '#166534' }}>Going Well</div>
                        <div className="text-sm sans whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>{r.going_well}</div>
                      </div>
                    )}
                    {r.needs_attention && (
                      <div>
                        <div className="text-xs font-semibold sans mb-1" style={{ color: '#c17f3e' }}>Needs Attention</div>
                        <div className="text-sm sans whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>{r.needs_attention}</div>
                      </div>
                    )}
                    {r.prayer_requests && (
                      <div>
                        <div className="text-xs font-semibold sans mb-1" style={{ color: '#3a5f8a' }}>Prayer Requests</div>
                        <div className="text-sm sans whitespace-pre-wrap" style={{ color: 'var(--foreground)' }}>{r.prayer_requests}</div>
                      </div>
                    )}
                    <div className="flex gap-2 pt-2">
                      {r.status === 'new' && (
                        <button onClick={(e) => { e.stopPropagation(); handleStatusChange(r.id, 'reviewed') }}
                          className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
                          style={{ background: '#fef3c7', color: '#92400e' }}>Mark Reviewed</button>
                      )}
                      {r.status !== 'resolved' && (
                        <button onClick={(e) => { e.stopPropagation(); handleStatusChange(r.id, 'resolved') }}
                          className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
                          style={{ background: '#dcfce7', color: '#166534' }}>Mark Resolved</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {showNew && <NewReportModal onClose={() => setShowNew(false)} onSuccess={() => { setShowNew(false); fetchReports() }} />}
    </div>
  )
}

function NewReportModal({ onClose, onSuccess }: { onClose: () => void; onSuccess: () => void }) {
  const [groupName, setGroupName] = useState('')
  const [goingWell, setGoingWell] = useState('')
  const [needsAttention, setNeedsAttention] = useState('')
  const [prayerRequests, setPrayerRequests] = useState('')
  const [isUrgent, setIsUrgent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const res = await fetch('/api/checkins', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        group_name: groupName || null,
        going_well: goingWell || null,
        needs_attention: needsAttention || null,
        prayer_requests: prayerRequests || null,
        is_urgent: isUrgent,
        context_type: 'group',
      }),
    })
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false) } else onSuccess()
  }

  const inputStyle = { borderColor: 'var(--border)', background: 'var(--muted)', color: 'var(--foreground)' }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ background: 'rgba(44,36,22,0.4)' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-6 max-h-[90vh] overflow-y-auto">
        <h2 className="font-serif text-xl mb-1" style={{ color: 'var(--primary)' }}>New Check-in Report</h2>
        <p className="text-xs sans mb-5" style={{ color: 'var(--foreground-muted)' }}>How is your group doing?</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: 'var(--foreground)' }}>Group / Context</label>
            <input type="text" value={groupName} onChange={e => setGroupName(e.target.value)} placeholder="e.g. Tuesday Night Group"
              className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: '#166534' }}>Going Well</label>
            <textarea value={goingWell} onChange={e => setGoingWell(e.target.value)} rows={3} placeholder="What's going well in your group?"
              className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none resize-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: '#c17f3e' }}>Needs Attention</label>
            <textarea value={needsAttention} onChange={e => setNeedsAttention(e.target.value)} rows={3} placeholder="Anything that needs follow-up?"
              className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none resize-none" style={inputStyle} />
          </div>
          <div>
            <label className="block text-sm font-medium sans mb-1.5" style={{ color: '#3a5f8a' }}>Prayer Requests</label>
            <textarea value={prayerRequests} onChange={e => setPrayerRequests(e.target.value)} rows={3} placeholder="Any prayer needs?"
              className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none resize-none" style={inputStyle} />
          </div>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={isUrgent} onChange={e => setIsUrgent(e.target.checked)} className="w-4 h-4 rounded" />
            <span className="text-sm sans" style={{ color: '#dc4a4a' }}>Mark as urgent</span>
          </label>
          {error && <p className="text-sm sans rounded-lg px-3 py-2" style={{ background: '#fef2f2', color: 'var(--danger)' }}>{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 rounded-xl text-sm sans border"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground-muted)' }}>Cancel</button>
            <button type="submit" disabled={loading || (!goingWell && !needsAttention && !prayerRequests)}
              className="flex-1 py-2.5 rounded-xl text-sm font-medium sans disabled:opacity-50"
              style={{ background: 'var(--primary)', color: 'white' }}>
              {loading ? 'Submitting…' : 'Submit Report'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
