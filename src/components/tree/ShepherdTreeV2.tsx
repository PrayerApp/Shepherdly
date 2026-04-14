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
const BANDS = [
  { key: 'elder',     name: 'Elder',        bg: 'rgba(234, 222, 140, 0.25)', label: '#8a7a20' },
  { key: 'staff',     name: 'Staff',        bg: 'rgba(147, 180, 220, 0.25)', label: '#3b6ea5' },
  { key: 'volunteer', name: 'Volunteer',    bg: 'rgba(140, 210, 160, 0.25)', label: '#3a7a4a' },
  { key: 'people',    name: 'Congregation', bg: 'rgba(210, 150, 150, 0.20)', label: '#8a4a4a' },
]

const BAND_HEIGHT = 200

// ── Component ──────────────────────────────────────────────────
export default function ShepherdTreeV2() {
  const [layers, setLayers] = useState<Layer[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Layer management
  const [layerModalOpen, setLayerModalOpen] = useState(false)
  const [newLayerName, setNewLayerName] = useState('')
  const [newLayerCategory, setNewLayerCategory] = useState<'staff' | 'volunteer'>('staff')
  const [saving, setSaving] = useState(false)

  const isAdmin = ['super_admin', 'staff'].includes(currentUserRole || '')

  // ── Fetch ────────────────────────────────────────────────────
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

  // Group layers by category
  const layersByCategory = useMemo(() => {
    const map: Record<string, Layer[]> = { elder: [], staff: [], volunteer: [] }
    for (const l of sortedLayers) {
      if (map[l.category]) map[l.category].push(l)
    }
    return map
  }, [sortedLayers])

  // ── Layer actions ────────────────────────────────────────────
  const addLayer = async () => {
    if (!newLayerName.trim()) return
    setSaving(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_layer', category: newLayerCategory, name: newLayerName.trim() }),
      })
      const data = await res.json()
      if (data.error) { alert('Error: ' + data.error); return }
      setNewLayerName('')
      await fetchData()
    } finally { setSaving(false) }
  }

  const removeLayer = async (layerId: string) => {
    if (!confirm('Remove this layer?')) return
    await fetch('/api/tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_layer', layer_id: layerId }),
    })
    await fetchData()
  }

  const moveLayer = async (layerId: string, direction: 'up' | 'down') => {
    const idx = sortedLayers.findIndex(l => l.id === layerId)
    if (idx < 0) return
    const targetIdx = direction === 'up' ? idx - 1 : idx + 1
    if (targetIdx < 0 || targetIdx >= sortedLayers.length) return

    const layer = sortedLayers[idx]
    const neighbor = sortedLayers[targetIdx]

    // Only allow reordering within same category
    if (layer.category !== neighbor.category) return

    setSaving(true)
    try {
      // Swap ranks via batch reorder endpoint
      await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'reorder_layers',
          order: [
            { layer_id: layer.id, rank: neighbor.rank },
            { layer_id: neighbor.id, rank: layer.rank },
          ],
        }),
      })
      await fetchData()
    } finally { setSaving(false) }
  }

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
        {isAdmin && (
          <button onClick={() => setLayerModalOpen(true)}
            className="text-xs sans px-3 py-1.5 rounded-lg font-medium border hover:bg-gray-50 transition-colors"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
            Manage Layers
          </button>
        )}
      </div>

      {/* Scrollable band area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ background: 'var(--muted)' }}>
        {BANDS.map((band, i) => {
          const categoryLayers = layersByCategory[band.key] || []

          return (
            <div key={band.key}>
              {/* Dashed separator between bands */}
              {i > 0 && (
                <div style={{
                  borderTop: '2px dashed rgba(0,0,0,0.12)',
                  marginLeft: 16,
                  marginRight: 16,
                }} />
              )}

              {/* Band */}
              <div style={{ minHeight: BAND_HEIGHT, background: band.bg, position: 'relative' }}>
                {/* Band label */}
                <div className="absolute left-4 top-3 select-none">
                  <div className="text-[11px] font-bold sans tracking-widest"
                    style={{ color: band.label, opacity: 0.6 }}>
                    {band.name.toUpperCase()}
                  </div>
                  {/* Show sub-layers if any */}
                  {categoryLayers.length > 0 && (
                    <div className="mt-1 flex flex-col gap-0.5">
                      {categoryLayers.map(l => (
                        <span key={l.id} className="text-[9px] sans" style={{ color: band.label, opacity: 0.45 }}>
                          {l.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Placeholder */}
                <div className="flex items-center justify-center" style={{ minHeight: BAND_HEIGHT }}>
                  <button
                    className="flex items-center justify-center border-2 border-dashed rounded-xl transition-colors hover:shadow-md"
                    style={{
                      width: 220,
                      height: 72,
                      borderColor: band.label + '50',
                      background: 'white',
                      cursor: band.key === 'people' ? 'default' : 'pointer',
                      opacity: 0.65,
                    }}>
                    <div className="text-center">
                      <div className="text-lg font-light" style={{ color: band.label, opacity: 0.7 }}>+</div>
                      <div className="text-[10px] sans font-medium" style={{ color: band.label, opacity: 0.6 }}>
                        {band.name}
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════
          MODAL: Manage Layers
         ══════════════════════════════════════════════════════════ */}
      {layerModalOpen && (
        <div className="fixed inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.3)' }}>
          <div className="bg-white rounded-2xl shadow-xl border"
            style={{ borderColor: 'var(--border)', width: 'min(90vw, 520px)', maxHeight: 'min(80vh, 600px)', display: 'flex', flexDirection: 'column' }}>

            {/* Header */}
            <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
              <h3 className="font-serif text-sm" style={{ color: 'var(--primary)' }}>Manage Layers</h3>
              <button onClick={() => setLayerModalOpen(false)}
                className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
            </div>

            {/* Body */}
            <div className="overflow-y-auto px-5 py-4 flex-1 space-y-5">

              {/* Elder layers */}
              <div>
                <div className="text-[10px] sans font-bold tracking-widest mb-2" style={{ color: '#8a7a20' }}>ELDER</div>
                {layersByCategory.elder.length === 0 && (
                  <p className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Default elder layer (auto-created)</p>
                )}
                {layersByCategory.elder.map(l => (
                  <div key={l.id} className="flex items-center gap-2 py-1.5">
                    <span className="text-sm sans flex-1" style={{ color: 'var(--foreground)' }}>{l.name}</span>
                    <span className="text-[9px] sans px-1.5 py-0.5 rounded" style={{ background: 'rgba(234,222,140,0.3)', color: '#8a7a20' }}>
                      rank {l.rank}
                    </span>
                  </div>
                ))}
              </div>

              {/* Staff layers */}
              <div>
                <div className="text-[10px] sans font-bold tracking-widest mb-2" style={{ color: '#3b6ea5' }}>STAFF LAYERS</div>
                {layersByCategory.staff.length === 0 && (
                  <p className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>No staff layers yet</p>
                )}
                {layersByCategory.staff.map((l, idx) => (
                  <div key={l.id} className="flex items-center gap-2 py-1.5 group">
                    <span className="text-sm sans flex-1" style={{ color: 'var(--foreground)' }}>{l.name}</span>
                    <span className="text-[9px] sans px-1.5 py-0.5 rounded" style={{ background: 'rgba(147,180,220,0.3)', color: '#3b6ea5' }}>
                      rank {l.rank}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => moveLayer(l.id, 'up')}
                        disabled={idx === 0 || saving}
                        className="w-5 h-5 rounded flex items-center justify-center text-[10px] hover:bg-gray-100 disabled:opacity-20"
                        style={{ color: 'var(--muted-foreground)' }}>↑</button>
                      <button onClick={() => moveLayer(l.id, 'down')}
                        disabled={idx === layersByCategory.staff.length - 1 || saving}
                        className="w-5 h-5 rounded flex items-center justify-center text-[10px] hover:bg-gray-100 disabled:opacity-20"
                        style={{ color: 'var(--muted-foreground)' }}>↓</button>
                      <button onClick={() => removeLayer(l.id)}
                        className="w-5 h-5 rounded flex items-center justify-center text-[10px] hover:bg-red-50"
                        style={{ color: '#9b3a3a' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Volunteer layers */}
              <div>
                <div className="text-[10px] sans font-bold tracking-widest mb-2" style={{ color: '#3a7a4a' }}>VOLUNTEER LAYERS</div>
                {layersByCategory.volunteer.length === 0 && (
                  <p className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>No volunteer layers yet</p>
                )}
                {layersByCategory.volunteer.map((l, idx) => (
                  <div key={l.id} className="flex items-center gap-2 py-1.5 group">
                    <span className="text-sm sans flex-1" style={{ color: 'var(--foreground)' }}>{l.name}</span>
                    <span className="text-[9px] sans px-1.5 py-0.5 rounded" style={{ background: 'rgba(140,210,160,0.3)', color: '#3a7a4a' }}>
                      rank {l.rank}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => moveLayer(l.id, 'up')}
                        disabled={idx === 0 || saving}
                        className="w-5 h-5 rounded flex items-center justify-center text-[10px] hover:bg-gray-100 disabled:opacity-20"
                        style={{ color: 'var(--muted-foreground)' }}>↑</button>
                      <button onClick={() => moveLayer(l.id, 'down')}
                        disabled={idx === layersByCategory.volunteer.length - 1 || saving}
                        className="w-5 h-5 rounded flex items-center justify-center text-[10px] hover:bg-gray-100 disabled:opacity-20"
                        style={{ color: 'var(--muted-foreground)' }}>↓</button>
                      <button onClick={() => removeLayer(l.id)}
                        className="w-5 h-5 rounded flex items-center justify-center text-[10px] hover:bg-red-50"
                        style={{ color: '#9b3a3a' }}>×</button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Add new layer */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div className="text-[10px] sans font-bold tracking-widest mb-2" style={{ color: 'var(--muted-foreground)' }}>ADD LAYER</div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Layer name..."
                    value={newLayerName}
                    onChange={e => setNewLayerName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addLayer()}
                    className="flex-1 px-3 py-2 rounded-lg border text-sm sans"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  />
                  <select
                    value={newLayerCategory}
                    onChange={e => setNewLayerCategory(e.target.value as 'staff' | 'volunteer')}
                    className="px-2 py-2 rounded-lg border text-xs sans"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                    <option value="staff">Staff</option>
                    <option value="volunteer">Volunteer</option>
                  </select>
                  <button
                    onClick={addLayer}
                    disabled={saving || !newLayerName.trim()}
                    className="px-3 py-2 rounded-lg text-xs sans font-medium disabled:opacity-40"
                    style={{ background: 'var(--primary)', color: 'white' }}>
                    {saving ? '...' : 'Add'}
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-5 py-3 shrink-0 flex justify-end" style={{ borderTop: '1px solid var(--border)', background: 'var(--muted)' }}>
              <button onClick={() => setLayerModalOpen(false)}
                className="text-xs sans font-medium px-3 py-1.5 rounded-lg border"
                style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
