'use client'

import { useState } from 'react'

// ── Band config — exactly 4 fixed bands ────────────────────────
const BANDS = [
  { key: 'elder',     name: 'Elder',        bg: 'rgba(234, 222, 140, 0.25)', label: '#8a7a20' },
  { key: 'staff',     name: 'Staff',        bg: 'rgba(147, 180, 220, 0.25)', label: '#3b6ea5' },
  { key: 'volunteer', name: 'Volunteer',    bg: 'rgba(140, 210, 160, 0.25)', label: '#3a7a4a' },
  { key: 'people',    name: 'Congregation', bg: 'rgba(210, 150, 150, 0.20)', label: '#8a4a4a' },
]

const BAND_HEIGHT = 200

// ── Locally-managed layers (not from API — fresh start) ────────
interface LocalLayer {
  id: string
  name: string
  category: 'elder' | 'staff' | 'volunteer'
}

export default function ShepherdTreeV2() {
  const [localLayers, setLocalLayers] = useState<LocalLayer[]>([])
  const [layerModalOpen, setLayerModalOpen] = useState(false)
  const [newLayerName, setNewLayerName] = useState('')
  const [newLayerCategory, setNewLayerCategory] = useState<'staff' | 'volunteer'>('staff')

  // Group local layers by category
  const layersByCategory = (cat: string) => localLayers.filter(l => l.category === cat)

  const addLayer = () => {
    if (!newLayerName.trim()) return
    setLocalLayers(prev => [...prev, {
      id: crypto.randomUUID(),
      name: newLayerName.trim(),
      category: newLayerCategory,
    }])
    setNewLayerName('')
  }

  const removeLayer = (id: string) => {
    setLocalLayers(prev => prev.filter(l => l.id !== id))
  }

  const moveLayer = (id: string, direction: 'up' | 'down') => {
    setLocalLayers(prev => {
      const idx = prev.findIndex(l => l.id === id)
      if (idx < 0) return prev
      const layer = prev[idx]
      // Find neighbors within same category
      const sameCat = prev.filter(l => l.category === layer.category)
      const catIdx = sameCat.findIndex(l => l.id === id)
      const targetCatIdx = direction === 'up' ? catIdx - 1 : catIdx + 1
      if (targetCatIdx < 0 || targetCatIdx >= sameCat.length) return prev
      const neighbor = sameCat[targetCatIdx]
      // Swap in the full array
      const copy = [...prev]
      const aIdx = copy.findIndex(l => l.id === layer.id)
      const bIdx = copy.findIndex(l => l.id === neighbor.id)
      copy[aIdx] = neighbor
      copy[bIdx] = layer
      return copy
    })
  }

  return (
    <div style={{ minHeight: '100vh' }}>
      {/* ── Toolbar ── */}
      <div style={{
        position: 'sticky',
        top: 0,
        zIndex: 10,
        borderBottom: '1px solid var(--border)',
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        background: 'white',
      }}>
        <h2 className="font-serif" style={{ fontSize: 16, color: 'var(--primary)', margin: 0 }}>Shepherd Tree</h2>
        <button
          onClick={() => setLayerModalOpen(true)}
          className="sans"
          style={{
            fontSize: 12,
            fontWeight: 500,
            padding: '6px 12px',
            borderRadius: 8,
            border: '1px solid var(--border)',
            background: 'white',
            color: 'var(--foreground)',
            cursor: 'pointer',
          }}>
          Manage Layers
        </button>
      </div>

      {/* ── Bands ── */}
      <div style={{ background: 'var(--muted)' }}>
        {BANDS.map((band, i) => (
          <div key={band.key}>
            {/* Dashed separator */}
            {i > 0 && (
              <div style={{ borderTop: '2px dashed rgba(0,0,0,0.12)', margin: '0 16px' }} />
            )}

            {/* Band */}
            <div style={{ minHeight: BAND_HEIGHT, background: band.bg, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              {/* Band label */}
              <div style={{ position: 'absolute', left: 16, top: 12, userSelect: 'none' }}>
                <div className="sans" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: band.label, opacity: 0.6 }}>
                  {band.name.toUpperCase()}
                </div>
              </div>

              {/* Placeholder */}
              <button
                style={{
                  width: 220,
                  height: 72,
                  border: `2px dashed ${band.label}50`,
                  borderRadius: 12,
                  background: 'white',
                  cursor: band.key === 'people' ? 'default' : 'pointer',
                  opacity: 0.65,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: 2,
                }}>
                <span style={{ fontSize: 18, fontWeight: 300, color: band.label, opacity: 0.7 }}>+</span>
                <span className="sans" style={{ fontSize: 10, fontWeight: 500, color: band.label, opacity: 0.6 }}>{band.name}</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          MODAL: Manage Layers
         ══════════════════════════════════════════════════════════ */}
      {layerModalOpen && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, background: 'rgba(0,0,0,0.3)' }}>
          <div style={{
            background: 'white',
            borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            border: '1px solid var(--border)',
            width: 'min(90vw, 520px)',
            maxHeight: 'min(80vh, 600px)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <h3 className="font-serif" style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>Manage Layers</h3>
              <button onClick={() => setLayerModalOpen(false)} style={{ fontSize: 18, lineHeight: 1, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            {/* Body */}
            <div style={{ overflowY: 'auto', padding: '16px 20px', flex: 1 }}>
              {/* Staff layers */}
              <div style={{ marginBottom: 20 }}>
                <div className="sans" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#3b6ea5', marginBottom: 8 }}>STAFF LAYERS</div>
                {layersByCategory('staff').length === 0 && (
                  <p className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>No staff layers yet. Add one below.</p>
                )}
                {layersByCategory('staff').map((l, idx) => (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                    <span className="sans" style={{ fontSize: 13, color: 'var(--foreground)', flex: 1 }}>{l.name}</span>
                    <button onClick={() => moveLayer(l.id, 'up')} disabled={idx === 0}
                      style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted-foreground)', opacity: idx === 0 ? 0.2 : 1 }}>↑</button>
                    <button onClick={() => moveLayer(l.id, 'down')} disabled={idx === layersByCategory('staff').length - 1}
                      style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted-foreground)', opacity: idx === layersByCategory('staff').length - 1 ? 0.2 : 1 }}>↓</button>
                    <button onClick={() => removeLayer(l.id)}
                      style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: '#9b3a3a' }}>×</button>
                  </div>
                ))}
              </div>

              {/* Volunteer layers */}
              <div style={{ marginBottom: 20 }}>
                <div className="sans" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: '#3a7a4a', marginBottom: 8 }}>VOLUNTEER LAYERS</div>
                {layersByCategory('volunteer').length === 0 && (
                  <p className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>No volunteer layers yet. Add one below.</p>
                )}
                {layersByCategory('volunteer').map((l, idx) => (
                  <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0' }}>
                    <span className="sans" style={{ fontSize: 13, color: 'var(--foreground)', flex: 1 }}>{l.name}</span>
                    <button onClick={() => moveLayer(l.id, 'up')} disabled={idx === 0}
                      style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted-foreground)', opacity: idx === 0 ? 0.2 : 1 }}>↑</button>
                    <button onClick={() => moveLayer(l.id, 'down')} disabled={idx === layersByCategory('volunteer').length - 1}
                      style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: 'var(--muted-foreground)', opacity: idx === layersByCategory('volunteer').length - 1 ? 0.2 : 1 }}>↓</button>
                    <button onClick={() => removeLayer(l.id)}
                      style={{ width: 22, height: 22, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 11, color: '#9b3a3a' }}>×</button>
                  </div>
                ))}
              </div>

              {/* Add new layer */}
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <div className="sans" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 2, color: 'var(--muted-foreground)', marginBottom: 8 }}>ADD LAYER</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="text"
                    placeholder="Layer name..."
                    value={newLayerName}
                    onChange={e => setNewLayerName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addLayer()}
                    className="sans"
                    style={{ flex: 1, padding: '8px 12px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--foreground)' }}
                  />
                  <select
                    value={newLayerCategory}
                    onChange={e => setNewLayerCategory(e.target.value as 'staff' | 'volunteer')}
                    className="sans"
                    style={{ padding: '8px 8px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, color: 'var(--foreground)' }}>
                    <option value="staff">Staff</option>
                    <option value="volunteer">Volunteer</option>
                  </select>
                  <button
                    onClick={addLayer}
                    disabled={!newLayerName.trim()}
                    className="sans"
                    style={{
                      padding: '8px 14px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--primary)',
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: newLayerName.trim() ? 'pointer' : 'default',
                      opacity: newLayerName.trim() ? 1 : 0.4,
                    }}>
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--muted)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', borderRadius: '0 0 16px 16px' }}>
              <button onClick={() => setLayerModalOpen(false)}
                className="sans"
                style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
