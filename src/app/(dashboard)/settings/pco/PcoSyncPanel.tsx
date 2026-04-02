'use client'

import { useState, useEffect, useRef, useCallback } from 'react'

/* ── Types ─────────────────────────────────────────────────────── */

interface ResourceMeta {
  key: string
  label: string
  category: string
}

interface CategoryMeta {
  key: string
  label: string
}

interface SyncStatus {
  hasCredentials: boolean
  lastSync: {
    status: string
    started_at: string
    completed_at: string | null
    records_synced: number
    error_message: string | null
    details: Record<string, any> | null
  } | null
  counts: Record<string, number>
  categories: CategoryMeta[]
  resources: ResourceMeta[]
}

interface ResourceProgress {
  synced: number
  total: number
}

interface SyncProgress {
  phase: 'starting' | 'syncing' | 'finishing' | 'done' | 'error'
  currentResourceKey: string | null
  currentResourceLabel: string | null
  resources: Record<string, ResourceProgress>
  totalSynced: number
  totalExpected: number
  error?: string
}

/* ── Component ─────────────────────────────────────────────────── */

export default function PcoSyncPanel() {
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [progress, setProgress] = useState<SyncProgress | null>(null)
  const abortRef = useRef(false)

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/pco?action=status')
      const data = await res.json()
      setStatus(data)
    } catch { /* ignore */ }
    setLoading(false)
  }, [])

  useEffect(() => { fetchStatus() }, [fetchStatus])

  /* ── Sync handler ──────────────────────────────────────────── */
  const handleSync = async () => {
    setSyncing(true)
    abortRef.current = false
    setProgress({
      phase: 'starting',
      currentResourceKey: null,
      currentResourceLabel: null,
      resources: {},
      totalSynced: 0,
      totalExpected: 0,
    })

    try {
      // Step 1: Start sync — get per-resource counts + create log
      const startRes = await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync_start' }),
      })
      const startData = await startRes.json()
      if (!startRes.ok) throw new Error(startData.error || 'Failed to start sync')

      const { syncLogId, resourceInfo } = startData
      // resourceInfo: { [key]: { count, updatedSince } }

      // Build initial progress state from resourceInfo
      const initialResources: Record<string, ResourceProgress> = {}
      let totalExpected = 0
      for (const [key, info] of Object.entries(resourceInfo) as [string, any][]) {
        initialResources[key] = { synced: 0, total: info.count }
        totalExpected += info.count
      }

      setProgress(p => p ? {
        ...p,
        phase: 'syncing',
        resources: initialResources,
        totalExpected,
      } : p)

      let totalSynced = 0

      // Step 2: Page through each resource in order
      const resourceKeys = Object.keys(resourceInfo)
      for (const resourceKey of resourceKeys) {
        if (abortRef.current) break

        const info = resourceInfo[resourceKey]
        const resourceLabel = status?.resources.find(r => r.key === resourceKey)?.label || resourceKey

        setProgress(p => p ? {
          ...p,
          currentResourceKey: resourceKey,
          currentResourceLabel: resourceLabel,
        } : p)

        let offset = 0
        let resourceSynced = 0

        while (true) {
          if (abortRef.current) break

          const pageRes = await fetch('/api/pco', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'sync_page',
              resourceKey,
              offset,
              syncLogId,
              updatedSince: info.updatedSince || null,
            }),
          })
          const pageData = await pageRes.json()

          if (!pageRes.ok) {
            // Non-fatal for optional resources — PCO might not have that module
            if (resourceKey !== 'people') {
              break
            }
            throw new Error(pageData.error || `Failed syncing ${resourceKey}`)
          }

          resourceSynced += pageData.upserted || 0
          totalSynced += pageData.upserted || 0

          setProgress(p => {
            if (!p) return p
            const updated = { ...p.resources }
            updated[resourceKey] = { ...updated[resourceKey], synced: resourceSynced }
            return {
              ...p,
              resources: updated,
              totalSynced,
            }
          })

          if (!pageData.hasMore || pageData.nextOffset == null) break
          offset = pageData.nextOffset
        }
      }

      // Step 3: Finish sync
      setProgress(p => p ? { ...p, phase: 'finishing', currentResourceKey: null, currentResourceLabel: null } : p)

      await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'sync_finish',
          syncLogId,
          totalRecords: totalSynced,
          status: 'success',
          error: null,
        }),
      })

      setProgress(p => p ? { ...p, phase: 'done' } : p)
      fetchStatus()

    } catch (e: any) {
      setProgress(p => p ? { ...p, phase: 'error', error: e.message } : p)
      fetchStatus()
    }

    setSyncing(false)
  }

  const handleCancel = () => { abortRef.current = true }

  /* ── Loading state ─────────────────────────────────────────── */
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

  /* ── Helpers ────────────────────────────────────────────────── */
  const categories = status.categories || []
  const resources = status.resources || []
  const totalRecords = Object.values(status.counts).reduce((a, b) => a + b, 0)

  // Group resources by category for display
  const resourcesByCategory: Record<string, ResourceMeta[]> = {}
  for (const cat of categories) {
    resourcesByCategory[cat.key] = resources.filter(r => r.category === cat.key)
  }

  /* ── Render ────────────────────────────────────────────────── */
  return (
    <div className="rounded-xl border p-6" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-start justify-between mb-5">
        <div>
          <h2 className="font-serif text-lg" style={{ color: 'var(--foreground)' }}>Data Sync</h2>
          <p className="text-sm sans mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
            Import people, groups, services, and check-ins from Planning Center.
          </p>
        </div>
        {!syncing ? (
          <button onClick={handleSync} className="btn-primary text-sm sans flex items-center gap-2">
            <SyncIcon />
            Sync Now
          </button>
        ) : (
          <button onClick={handleCancel}
            className="text-sm sans px-4 py-2 rounded-lg border font-medium"
            style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
            Cancel
          </button>
        )}
      </div>

      {/* ── Active sync progress ──────────────────────────────── */}
      {progress && progress.phase !== 'done' && progress.phase !== 'error' && (
        <div className="rounded-lg p-4 mb-4" style={{ background: 'var(--primary-light)' }}>
          <div className="flex items-center gap-2 mb-3">
            <div className="w-4 h-4 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--green-300)', borderTopColor: 'var(--green-700)' }} />
            <span className="text-sm sans font-medium" style={{ color: 'var(--green-800)' }}>
              {progress.phase === 'starting' && 'Preparing sync\u2026'}
              {progress.phase === 'finishing' && 'Finishing up\u2026'}
              {progress.phase === 'syncing' && progress.currentResourceLabel &&
                `Syncing ${progress.currentResourceLabel}\u2026`}
            </span>
          </div>

          {/* Per-category progress bars */}
          {categories.map(cat => {
            const catResources = resourcesByCategory[cat.key] || []
            if (catResources.length === 0) return null

            const catSynced = catResources.reduce((sum, r) => sum + (progress.resources[r.key]?.synced || 0), 0)
            const catTotal = catResources.reduce((sum, r) => sum + (progress.resources[r.key]?.total || 0), 0)
            const catPct = catTotal > 0 ? Math.min(100, (catSynced / catTotal) * 100) : 0
            const isActive = catResources.some(r => r.key === progress.currentResourceKey)

            return (
              <div key={cat.key} className="mb-3 last:mb-0">
                <div className="flex justify-between text-xs sans mb-1" style={{ color: 'var(--green-800)' }}>
                  <span style={{ fontWeight: isActive ? 600 : 400 }}>{cat.label}</span>
                  <span>{catSynced.toLocaleString()}{catTotal > 0 ? ` / ${catTotal.toLocaleString()}` : ''}</span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--green-200)' }}>
                  <div className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${catPct}%`, background: 'var(--green-600)' }} />
                </div>
              </div>
            )
          })}

          <div className="text-xs sans mt-3 text-right" style={{ color: 'var(--green-700)' }}>
            {progress.totalSynced.toLocaleString()} records synced
          </div>
        </div>
      )}

      {/* ── Success toast ──────────────────────────────────────── */}
      {progress?.phase === 'done' && (
        <div className="rounded-lg px-4 py-3 text-sm sans mb-4 flex items-center gap-2"
          style={{ background: '#f0fdf4', color: 'var(--green-800)' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          Sync complete &mdash; {progress.totalSynced.toLocaleString()} records synced
        </div>
      )}

      {/* ── Error toast ────────────────────────────────────────── */}
      {progress?.phase === 'error' && (
        <div className="rounded-lg px-4 py-3 text-sm sans mb-4 flex items-center gap-2"
          style={{ background: 'var(--danger-light)', color: '#991b1b' }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          Sync failed: {progress.error}
        </div>
      )}

      {/* ── Synced record summary ──────────────────────────────── */}
      {totalRecords > 0 ? (
        <div className="rounded-lg p-4" style={{ background: 'var(--primary-light)' }}>
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm sans font-medium" style={{ color: 'var(--green-800)' }}>
              {totalRecords.toLocaleString()} records synced
            </span>
            {status.lastSync?.completed_at && (
              <span className="text-xs sans" style={{ color: 'var(--green-700)' }}>
                Last synced {formatRelativeTime(status.lastSync.completed_at)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {categories.map(cat => {
              const catResources = resourcesByCategory[cat.key] || []
              const catTotal = catResources.reduce((sum, r) => sum + (status.counts[r.key] || 0), 0)
              if (catTotal === 0) return null
              return (
                <span key={cat.key} className="text-xs sans" style={{ color: 'var(--green-700)' }}>
                  {cat.label}: {catTotal.toLocaleString()}
                </span>
              )
            })}
          </div>
          {status.lastSync?.error_message && (
            <div className="text-xs sans mt-2" style={{ color: 'var(--danger)' }}>
              {status.lastSync.error_message}
            </div>
          )}
        </div>
      ) : !progress && (
        <div className="rounded-lg p-4 text-center" style={{ background: 'var(--background-subtle)' }}>
          <p className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
            No syncs yet. Hit &ldquo;Sync Now&rdquo; to import your PCO data.
          </p>
        </div>
      )}

    </div>
  )
}

/* ── Utility components ──────────────────────────────────────── */

function SyncIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <polyline points="1 4 1 10 7 10"/>
      <polyline points="23 20 23 14 17 14"/>
      <path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/>
    </svg>
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
