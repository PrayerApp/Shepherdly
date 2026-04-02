'use client'

import { useState, useEffect } from 'react'

interface SyncStatus {
  hasCredentials: boolean
  lastSync: {
    status: string
    started_at: string
    completed_at: string | null
    records_synced: number
    error_message: string | null
    details: Record<string, number> | null
  } | null
  pcoLastSync: string | null
  counts: { people: number; groups: number; teams: number }
}

export default function PcoSyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/pco?action=status')
      const data = await res.json()
      setStatus(data)
    } catch { /* ignore */ }
    setLoading(false)
  }

  useEffect(() => { fetchStatus() }, [])

  const handleSync = async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      const res = await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const data = await res.json()
      if (data.success) {
        setSyncResult({
          type: 'success',
          message: `Synced ${data.records.toLocaleString()} records (${data.details?.people || 0} people, ${data.details?.groups || 0} groups, ${data.details?.teams || 0} teams)`,
        })
        fetchStatus() // Refresh counts
      } else {
        setSyncResult({ type: 'error', message: data.error || 'Sync failed.' })
      }
    } catch (e: any) {
      setSyncResult({ type: 'error', message: 'Network error during sync.' })
    }
    setSyncing(false)
  }

  if (loading) {
    return (
      <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
        <div className="flex items-center gap-3">
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
          <span className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>Loading sync status&hellip;</span>
        </div>
      </div>
    )
  }

  if (!status?.hasCredentials) {
    return (
      <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
        <h2 className="font-serif text-lg mb-2" style={{ color: 'var(--foreground)' }}>Data Sync</h2>
        <p className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
          Save your PCO credentials above to enable data syncing.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="font-serif text-lg" style={{ color: 'var(--foreground)' }}>Data Sync</h2>
          <p className="text-sm sans mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
            Import people, groups, and teams from Planning Center.
          </p>
        </div>
        <button
          onClick={handleSync}
          disabled={syncing}
          className="btn-primary text-sm sans flex items-center gap-2 disabled:opacity-50">
          {syncing ? (
            <>
              <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: 'rgba(255,255,255,0.3)', borderTopColor: 'white' }} />
              Syncing&hellip;
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <polyline points="1 4 1 10 7 10"/>
                <polyline points="23 20 23 14 17 14"/>
                <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
              </svg>
              Sync Now
            </>
          )}
        </button>
      </div>

      {/* Sync result message */}
      {syncResult && (
        <div className="rounded-lg px-4 py-3 text-sm sans mb-5 flex items-center gap-2"
          style={{
            background: syncResult.type === 'success' ? '#f0fdf4' : 'var(--danger-light)',
            color: syncResult.type === 'success' ? 'var(--green-800)' : '#991b1b',
          }}>
          {syncResult.type === 'success' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          )}
          {syncResult.message}
        </div>
      )}

      {/* Record counts */}
      <div className="grid grid-cols-3 gap-4 mb-5">
        <CountCard label="People" count={status.counts.people} />
        <CountCard label="Groups" count={status.counts.groups} />
        <CountCard label="Teams" count={status.counts.teams} />
      </div>

      {/* Last sync info */}
      {status.lastSync ? (
        <div className="rounded-lg p-4" style={{ background: 'var(--background-subtle)' }}>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full"
              style={{ background: status.lastSync.status === 'success' ? 'var(--success)' : status.lastSync.status === 'running' ? 'var(--gold-500)' : 'var(--danger)' }} />
            <span className="text-xs sans font-medium" style={{ color: 'var(--foreground)' }}>
              Last sync: {status.lastSync.status === 'success' ? 'Completed' : status.lastSync.status === 'running' ? 'In progress' : 'Failed'}
            </span>
          </div>
          <div className="text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
            {status.lastSync.completed_at
              ? formatRelativeTime(status.lastSync.completed_at)
              : status.lastSync.started_at
                ? `Started ${formatRelativeTime(status.lastSync.started_at)}`
                : ''}
            {status.lastSync.records_synced > 0 && ` \u00b7 ${status.lastSync.records_synced.toLocaleString()} records`}
          </div>
          {status.lastSync.error_message && (
            <div className="text-xs sans mt-1" style={{ color: 'var(--danger)' }}>
              {status.lastSync.error_message}
            </div>
          )}
        </div>
      ) : (
        <div className="rounded-lg p-4 text-center" style={{ background: 'var(--background-subtle)' }}>
          <p className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
            No syncs yet. Hit &ldquo;Sync Now&rdquo; to import your PCO data.
          </p>
        </div>
      )}
    </div>
  )
}

function CountCard({ label, count }: { label: string; count: number }) {
  return (
    <div className="rounded-lg p-3 text-center" style={{ background: 'var(--background-subtle)' }}>
      <div className="text-2xl font-serif" style={{ color: 'var(--primary)' }}>
        {count.toLocaleString()}
      </div>
      <div className="text-xs sans mt-0.5" style={{ color: 'var(--foreground-muted)' }}>{label}</div>
    </div>
  )
}

function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  return `${diffDay}d ago`
}
