'use client'

import { useState, useMemo } from 'react'

// ── Types ──────────────────────────────────────────────────────
interface LayerItem {
  id: string
  name: string
  category: 'elder' | 'staff' | 'volunteer' | 'people'
  isDefault?: boolean  // default categories can't be deleted
}

// ── Color map ──────────────────────────────────────────────────
const COLORS: Record<string, { bg: string; label: string }> = {
  elder:     { bg: 'rgba(234, 222, 140, 0.25)', label: '#8a7a20' },
  staff:     { bg: 'rgba(147, 180, 220, 0.25)', label: '#3b6ea5' },
  volunteer: { bg: 'rgba(140, 210, 160, 0.25)', label: '#3a7a4a' },
  people:    { bg: 'rgba(210, 150, 150, 0.20)', label: '#8a4a4a' },
}

const BAND_HEIGHT = 200

// ── Default layers ─────────────────────────────────────────────
const DEFAULT_LAYERS: LayerItem[] = [
  { id: 'default-elder',     name: 'Elder',        category: 'elder',     isDefault: true },
  { id: 'default-staff',     name: 'Staff',        category: 'staff',     isDefault: true },
  { id: 'default-volunteer', name: 'Volunteer',    category: 'volunteer', isDefault: true },
  { id: 'default-people',    name: 'Congregation', category: 'people',    isDefault: true },
]

// ── Component ──────────────────────────────────────────────────
export default function ShepherdTreeV2() {
  // The single source of truth: ordered list of layers
  const [layers, setLayers] = useState<LayerItem[]>(DEFAULT_LAYERS)

  // Modal state
  const [modalOpen, setModalOpen] = useState(false)
  const [draftLayers, setDraftLayers] = useState<LayerItem[]>([])
  const [newName, setNewName] = useState('')
  const [newCategory, setNewCategory] = useState<'elder' | 'staff' | 'volunteer' | 'people'>('staff')

  // ── Modal actions ────────────────────────────────────────────
  const openModal = () => {
    setDraftLayers([...layers])
    setNewName('')
    setModalOpen(true)
  }

  const saveModal = () => {
    setLayers(draftLayers)
    setModalOpen(false)
  }

  const addDraftLayer = () => {
    if (!newName.trim()) return
    setDraftLayers(prev => [...prev, {
      id: crypto.randomUUID(),
      name: newName.trim(),
      category: newCategory,
    }])
    setNewName('')
  }

  const removeDraftLayer = (id: string) => {
    setDraftLayers(prev => prev.filter(l => l.id !== id))
  }

  const moveDraft = (idx: number, direction: 'up' | 'down') => {
    const target = direction === 'up' ? idx - 1 : idx + 1
    if (target < 0 || target >= draftLayers.length) return
    setDraftLayers(prev => {
      const copy = [...prev]
      const temp = copy[idx]
      copy[idx] = copy[target]
      copy[target] = temp
      return copy
    })
  }

  // ── Derive band colors from layer category ──────────────────
  const getColor = (cat: string) => COLORS[cat] || COLORS.staff

  return (
    <div style={{ maxWidth: '100%', overflowX: 'hidden' }}>
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
        boxSizing: 'border-box',
      }}>
        <h2 className="font-serif" style={{ fontSize: 16, color: 'var(--primary)', margin: 0 }}>Shepherd Tree</h2>
        <button
          onClick={openModal}
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
            whiteSpace: 'nowrap',
            flexShrink: 0,
          }}>
          Manage Layers
        </button>
      </div>

      {/* ── Bands ── */}
      <div>
        {layers.map((layer, i) => {
          const c = getColor(layer.category)
          return (
            <div key={layer.id}>
              {i > 0 && (
                <div style={{ borderTop: '2px dashed rgba(0,0,0,0.12)', margin: '0 16px' }} />
              )}
              <div style={{
                minHeight: BAND_HEIGHT,
                background: c.bg,
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}>
                <div style={{ position: 'absolute', left: 16, top: 12, userSelect: 'none' }}>
                  <div className="sans" style={{ fontSize: 11, fontWeight: 700, letterSpacing: 2, color: c.label, opacity: 0.6 }}>
                    {layer.name.toUpperCase()}
                  </div>
                </div>
                <button style={{
                  width: 220,
                  height: 72,
                  border: `2px dashed ${c.label}50`,
                  borderRadius: 12,
                  background: 'white',
                  cursor: 'pointer',
                  opacity: 0.65,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexDirection: 'column',
                  gap: 2,
                }}>
                  <span style={{ fontSize: 18, fontWeight: 300, color: c.label, opacity: 0.7 }}>+</span>
                  <span className="sans" style={{ fontSize: 10, fontWeight: 500, color: c.label, opacity: 0.6 }}>{layer.name}</span>
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {/* ══════════════════════════════════════════════════════════
          MODAL: Manage Layers — single sortable list
         ══════════════════════════════════════════════════════════ */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, background: 'rgba(0,0,0,0.3)' }}>
          <div style={{
            background: 'white',
            borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            border: '1px solid var(--border)',
            width: 'min(90vw, 480px)',
            maxHeight: 'min(85vh, 640px)',
            display: 'flex',
            flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <h3 className="font-serif" style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>Manage Layers</h3>
              <button onClick={() => setModalOpen(false)} style={{ fontSize: 18, lineHeight: 1, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            {/* Sortable list */}
            <div style={{ overflowY: 'auto', padding: '12px 20px', flex: 1 }}>
              <p className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>
                Reorder layers with ↑↓. Add new layers between existing ones. Save to apply.
              </p>

              {draftLayers.map((layer, idx) => {
                const c = getColor(layer.category)
                return (
                  <div key={layer.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '8px 10px',
                    margin: '0 0 4px',
                    borderRadius: 8,
                    background: c.bg,
                    border: '1px solid transparent',
                  }}>
                    {/* Color dot */}
                    <div style={{ width: 8, height: 8, borderRadius: 4, background: c.label, opacity: 0.6, flexShrink: 0 }} />

                    {/* Name */}
                    <span className="sans" style={{ fontSize: 13, color: 'var(--foreground)', flex: 1 }}>
                      {layer.name}
                      {layer.isDefault && (
                        <span style={{ fontSize: 9, color: 'var(--muted-foreground)', marginLeft: 6 }}>default</span>
                      )}
                    </span>

                    {/* Category badge */}
                    <span className="sans" style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1, color: c.label, opacity: 0.6, textTransform: 'uppercase' }}>
                      {layer.category === 'people' ? 'cong.' : layer.category}
                    </span>

                    {/* Move buttons */}
                    <button onClick={() => moveDraft(idx, 'up')} disabled={idx === 0}
                      style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'none', cursor: idx === 0 ? 'default' : 'pointer', fontSize: 12, color: 'var(--muted-foreground)', opacity: idx === 0 ? 0.15 : 0.6 }}>
                      ↑
                    </button>
                    <button onClick={() => moveDraft(idx, 'down')} disabled={idx === draftLayers.length - 1}
                      style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'none', cursor: idx === draftLayers.length - 1 ? 'default' : 'pointer', fontSize: 12, color: 'var(--muted-foreground)', opacity: idx === draftLayers.length - 1 ? 0.15 : 0.6 }}>
                      ↓
                    </button>

                    {/* Delete (not for defaults) */}
                    {layer.isDefault ? (
                      <div style={{ width: 24 }} />
                    ) : (
                      <button onClick={() => removeDraftLayer(layer.id)}
                        style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 13, color: '#9b3a3a', opacity: 0.7 }}>
                        ×
                      </button>
                    )}
                  </div>
                )
              })}

              {/* Add new layer */}
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div className="sans" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1.5, color: 'var(--muted-foreground)', marginBottom: 8 }}>ADD LAYER</div>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="Layer name..."
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addDraftLayer()}
                    className="sans"
                    style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--foreground)', minWidth: 0 }}
                  />
                  <select
                    value={newCategory}
                    onChange={e => setNewCategory(e.target.value as any)}
                    className="sans"
                    style={{ padding: '7px 6px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 11, color: 'var(--foreground)', flexShrink: 0 }}>
                    <option value="elder">Elder</option>
                    <option value="staff">Staff</option>
                    <option value="volunteer">Volunteer</option>
                    <option value="people">Congregation</option>
                  </select>
                  <button
                    onClick={addDraftLayer}
                    disabled={!newName.trim()}
                    className="sans"
                    style={{
                      padding: '7px 12px',
                      borderRadius: 8,
                      border: 'none',
                      background: 'var(--primary)',
                      color: 'white',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: newName.trim() ? 'pointer' : 'default',
                      opacity: newName.trim() ? 1 : 0.4,
                      flexShrink: 0,
                    }}>
                    Add
                  </button>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--muted)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8, borderRadius: '0 0 16px 16px' }}>
              <button onClick={() => setModalOpen(false)}
                className="sans"
                style={{ fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
                Cancel
              </button>
              <button onClick={saveModal}
                className="sans"
                style={{ fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer' }}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
