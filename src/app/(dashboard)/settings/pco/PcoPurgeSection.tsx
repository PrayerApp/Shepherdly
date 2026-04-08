'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PcoPurgeSection() {
  const router = useRouter()
  const [purging, setPurging] = useState(false)
  const [purgeConfirm, setPurgeConfirm] = useState(false)
  const [result, setResult] = useState<'success' | 'error' | null>(null)

  const handlePurge = async () => {
    setPurging(true)
    setResult(null)
    try {
      const res = await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'purge' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || 'Purge failed')
      }
      setPurgeConfirm(false)
      setResult('success')
      router.refresh() // re-render server component so all panels reset
    } catch {
      setResult('error')
    }
    setPurging(false)
  }

  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <h2 className="font-serif text-base mb-1" style={{ color: 'var(--foreground)' }}>Danger Zone</h2>
      <p className="text-xs sans mb-4" style={{ color: 'var(--foreground-muted)' }}>
        Delete all synced PCO data from Shepherdly. This will not affect your Planning Center account.
      </p>

      {result === 'success' && (
        <div className="rounded-lg px-3 py-2 text-xs sans mb-3 flex items-center gap-2"
          style={{ background: '#f0fdf4', color: 'var(--green-800)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
          All PCO data deleted. Reloading&hellip;
        </div>
      )}

      {result === 'error' && (
        <div className="rounded-lg px-3 py-2 text-xs sans mb-3"
          style={{ background: 'var(--danger-light)', color: '#991b1b' }}>
          Failed to delete data. Please try again.
        </div>
      )}

      {!purgeConfirm ? (
        <button
          onClick={() => setPurgeConfirm(true)}
          className="text-xs sans font-medium px-4 py-2 rounded-lg border transition-colors hover:opacity-80"
          style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}>
          Delete All PCO Data
        </button>
      ) : (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs sans" style={{ color: 'var(--danger)' }}>
            This cannot be undone. Continue?
          </span>
          <button
            onClick={handlePurge}
            disabled={purging}
            className="text-xs sans font-bold px-4 py-2 rounded-lg transition-opacity hover:opacity-90"
            style={{ background: 'var(--danger)', color: 'white' }}>
            {purging ? 'Deleting\u2026' : 'Yes, Delete Everything'}
          </button>
          <button
            onClick={() => { setPurgeConfirm(false); setResult(null) }}
            className="text-xs sans px-4 py-2 rounded-lg border"
            style={{ borderColor: 'var(--neutral-300)', color: 'var(--foreground-muted)' }}>
            Cancel
          </button>
        </div>
      )}
    </div>
  )
}
