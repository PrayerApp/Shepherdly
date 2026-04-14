'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

// ── Types ──────────────────────────────────────────────────────
interface Layer {
  id: string
  name: string
  category: 'elder' | 'staff' | 'volunteer'
  rank: number
}

// ── Band config ────────────────────────────────────────────────
const BAND_STYLES: Record<string, { bg: string; label: string }> = {
  elder:     { bg: 'rgba(234, 222, 140, 0.25)', label: '#8a7a20' },
  staff:     { bg: 'rgba(147, 180, 220, 0.25)', label: '#3b6ea5' },
  volunteer: { bg: 'rgba(140, 210, 160, 0.25)', label: '#3a7a4a' },
}

// The 4 fixed bands: 3 from layers + congregation at bottom
const DEFAULT_BANDS = [
  { key: 'elder',     name: 'Elder',       category: 'elder' },
  { key: 'staff',     name: 'Staff',       category: 'staff' },
  { key: 'volunteer', name: 'Volunteer',   category: 'volunteer' },
  { key: 'people',    name: 'Congregation', category: 'people' },
]

const PEOPLE_BAND = { bg: 'rgba(210, 150, 150, 0.20)', label: '#8a4a4a' }
const BAND_HEIGHT = 200

// ── Component ──────────────────────────────────────────────────
export default function ShepherdTreeV2() {
  const [layers, setLayers] = useState<Layer[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // ── Fetch layers ─────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/tree')
      const data = await res.json()
      if (data.error) { setError(data.error); return }
      setLayers(data.layers || [])
      setCurrentUserRole(data.currentUserRole || null)
    } catch {
      setError('Failed to load')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  const sortedLayers = useMemo(() => [...layers].sort((a, b) => a.rank - b.rank), [layers])

  // Build bands from actual layers, grouped by category, + congregation
  const bands = useMemo(() => {
    if (sortedLayers.length === 0) return DEFAULT_BANDS

    const seen = new Set<string>()
    const result: { key: string; name: string; category: string; layers: Layer[] }[] = []

    // Group consecutive layers by category
    for (const l of sortedLayers) {
      if (!seen.has(l.category)) {
        seen.add(l.category)
        result.push({ key: l.category, name: l.category.charAt(0).toUpperCase() + l.category.slice(1), category: l.category, layers: [] })
      }
      result[result.length - 1].layers.push(l)
    }

    // Always add congregation at bottom
    result.push({ key: 'people', name: 'Congregation', category: 'people', layers: [] })

    return result
  }, [sortedLayers])

  const totalHeight = bands.length * BAND_HEIGHT

  // ── Render ───────────────────────────────────────────────────
  if (loading) return (
    <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--muted-foreground)' }}>
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
          style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
        <p className="sans text-sm">Loading...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex-1 flex items-center justify-center">
      <p className="text-sm sans" style={{ color: '#9b3a3a' }}>{error}</p>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Toolbar */}
      <div className="shrink-0 border-b px-4 py-2.5 flex items-center justify-between" style={{ borderColor: 'var(--border)', background: 'white' }}>
        <h2 className="font-serif text-base" style={{ color: 'var(--primary)' }}>Shepherd Tree</h2>
      </div>

      {/* Scrollable band area — no zoom, vertical scroll only */}
      <div className="flex-1 overflow-y-auto overflow-x-auto" style={{ background: 'var(--muted)' }}>
        <div style={{ minHeight: totalHeight, position: 'relative' }}>
          {bands.map((band, i) => {
            const style = band.category === 'people'
              ? PEOPLE_BAND
              : (BAND_STYLES[band.category] || { bg: 'rgba(200,200,200,0.15)', label: '#888' })

            return (
              <div key={band.key}
                style={{
                  height: BAND_HEIGHT,
                  background: style.bg,
                  position: 'relative',
                  borderBottom: i < bands.length - 1 ? 'none' : undefined,
                }}>
                {/* Band label */}
                <div className="absolute left-4 top-3 text-[11px] font-bold sans tracking-widest select-none"
                  style={{ color: style.label, opacity: 0.6 }}>
                  {band.name.toUpperCase()}
                </div>

                {/* Sub-layer labels if multiple layers in this band */}
                {'layers' in band && (band as any).layers?.length > 1 && (
                  <div className="absolute left-4 top-8 flex flex-col gap-0.5">
                    {(band as any).layers.map((l: Layer) => (
                      <span key={l.id} className="text-[9px] sans" style={{ color: style.label, opacity: 0.45 }}>
                        {l.name}
                      </span>
                    ))}
                  </div>
                )}

                {/* Placeholder node centered in band */}
                <div className="absolute inset-0 flex items-center justify-center">
                  <button
                    className="flex items-center justify-center border-2 border-dashed rounded-xl transition-colors hover:shadow-md"
                    style={{
                      width: 220,
                      height: 72,
                      borderColor: style.label + '60',
                      background: 'white',
                      cursor: 'pointer',
                      opacity: 0.7,
                    }}>
                    <div className="text-center">
                      <div className="text-lg font-light" style={{ color: style.label, opacity: 0.7 }}>+</div>
                      <div className="text-[10px] sans font-medium" style={{ color: style.label, opacity: 0.6 }}>
                        {band.name}
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
