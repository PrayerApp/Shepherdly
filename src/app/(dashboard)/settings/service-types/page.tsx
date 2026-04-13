'use client'

import { useState, useEffect } from 'react'

interface ServiceType {
  id: string
  pco_id: string
  name: string
  is_tracked: boolean
  created_at: string
}

export default function ServiceTypesSettingsPage() {
  const [serviceTypes, setServiceTypes] = useState<ServiceType[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/service-types')
      .then(r => r.json())
      .then(data => { setServiceTypes(data.serviceTypes || []); setLoading(false) })
  }, [])

  const toggleTracked = async (id: string, is_tracked: boolean) => {
    setUpdating(id)
    const res = await fetch('/api/service-types', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, is_tracked }),
    })
    if (res.ok) {
      setServiceTypes(prev => prev.map(st => st.id === id ? { ...st, is_tracked } : st))
    }
    setUpdating(null)
  }

  return (
    <div className="p-8 max-w-3xl">
      <h1 className="text-3xl font-serif mb-1" style={{ color: 'var(--foreground)' }}>Service Types</h1>
      <p className="sans text-sm mb-6" style={{ color: 'var(--foreground-muted)' }}>
        Choose which PCO service types (and their teams) are included in the shepherd tree and analytics.
        Untracked service types are still synced but won&apos;t appear in the tree.
      </p>

      {loading ? (
        <div className="text-center py-16 sans text-sm" style={{ color: 'var(--foreground-muted)' }}>Loading...</div>
      ) : serviceTypes.length === 0 ? (
        <div className="rounded-xl border p-8 text-center" style={{ background: 'var(--card)', borderColor: 'var(--border)' }}>
          <p className="sans text-sm" style={{ color: 'var(--foreground-muted)' }}>
            No service types found. Run a PCO sync to import service types.
          </p>
        </div>
      ) : (
        <div className="rounded-xl border overflow-hidden" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
          {serviceTypes.map((st, i) => (
            <div key={st.id}
              className="flex items-center justify-between px-5 py-4"
              style={{ borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
              <div>
                <div className="sans text-sm font-medium" style={{ color: 'var(--foreground)' }}>{st.name}</div>
                <div className="sans text-xs mt-0.5" style={{ color: 'var(--foreground-muted)' }}>PCO ID: {st.pco_id}</div>
              </div>
              <button
                onClick={() => toggleTracked(st.id, !st.is_tracked)}
                disabled={updating === st.id}
                className="relative w-11 h-6 rounded-full transition-colors"
                style={{ background: st.is_tracked ? 'var(--primary)' : 'var(--border)' }}>
                <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform shadow-sm"
                  style={{ transform: st.is_tracked ? 'translateX(20px)' : 'translateX(0)' }} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
