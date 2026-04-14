'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────
interface LayerItem {
  id: string
  name: string
  color: { bg: string; label: string }
  isDefault?: boolean
  category?: string
}

interface PcoList {
  id: string
  name: string
  totalPeople: number
}

interface ListLayerLink {
  listId: string
  layerId: string
}

interface PersonOnLayer {
  id: string
  name: string
}

// ── Color palette — each layer gets its own unique color ───────
const COLOR_PALETTE = [
  { bg: 'rgba(200, 175, 60, 0.30)',  label: '#7a6a10' },   // gold
  { bg: 'rgba(80, 130, 190, 0.30)',  label: '#2b5a8a' },   // blue
  { bg: 'rgba(60, 160, 90, 0.30)',   label: '#2a6a3a' },   // green
  { bg: 'rgba(190, 100, 100, 0.28)', label: '#8a3a3a' },   // rose
  { bg: 'rgba(140, 90, 180, 0.28)',  label: '#6a3a9a' },   // purple
  { bg: 'rgba(200, 140, 60, 0.30)',  label: '#8a5a1a' },   // amber
  { bg: 'rgba(60, 160, 160, 0.30)',  label: '#2a7a7a' },   // teal
  { bg: 'rgba(180, 80, 140, 0.28)',  label: '#8a2a6a' },   // magenta
  { bg: 'rgba(100, 140, 60, 0.30)',  label: '#4a6a2a' },   // olive
  { bg: 'rgba(80, 120, 160, 0.30)',  label: '#3a5a7a' },   // slate
]

const BAND_MIN_HEIGHT = 160

// ── Defaults (used if DB has no layers yet) ───────────────────
const DEFAULT_LAYERS: LayerItem[] = [
  { id: '', name: 'Elder',        color: COLOR_PALETTE[0], isDefault: true, category: 'elder' },
  { id: '', name: 'Staff',        color: COLOR_PALETTE[1], isDefault: true, category: 'staff' },
  { id: '', name: 'Volunteer',    color: COLOR_PALETTE[2], isDefault: true, category: 'volunteer' },
  { id: '', name: 'Congregation', color: COLOR_PALETTE[3], isDefault: true, category: 'people' },
]

function colorForIndex(i: number) {
  return COLOR_PALETTE[i % COLOR_PALETTE.length]
}

// ── Component ──────────────────────────────────────────────────
export default function ShepherdTreeV2() {
  const [layers, setLayers] = useState<LayerItem[]>([])
  const [loading, setLoading] = useState(true)

  // PCO list data
  const [pcoLists, setPcoLists] = useState<PcoList[]>([])
  const [listLayerLinks, setListLayerLinks] = useState<ListLayerLink[]>([])
  const [layerPeople, setLayerPeople] = useState<Record<string, PersonOnLayer[]>>({})

  // Manage Layers modal
  const [modalOpen, setModalOpen] = useState(false)
  const [draftLayers, setDraftLayers] = useState<LayerItem[]>([])
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  // Assign Layer picker
  const [assignPickerLayerId, setAssignPickerLayerId] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)

  // Drag state for modal list
  const dragIdx = useRef<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // ── Fetch data from API ──────────────────────────────────────
  const fetchData = useCallback(async () => {
    try {
      const res = await fetch('/api/tree')
      if (!res.ok) throw new Error('Failed to fetch')
      const data = await res.json()

      // Build layers from API
      const apiLayers: LayerItem[] = (data.layers || []).map((l: any, i: number) => ({
        id: l.id,
        name: l.name,
        color: colorForIndex(i),
        category: l.category,
      }))

      if (apiLayers.length === 0) {
        // No layers in DB — initialize with defaults
        setLayers(DEFAULT_LAYERS)
        // We'll save defaults on first "Save" in modal
      } else {
        setLayers(apiLayers)
      }

      // PCO lists
      setPcoLists(data.pcoLists || [])
      setListLayerLinks(data.listLayerLinks || [])

      // Build people per layer from assignments + nodes
      const peopleMap: Record<string, PersonOnLayer[]> = {}
      const assignments = data.assignments || {}
      const nodes = data.nodes || []
      const personNames = new Map<string, string>()
      for (const n of nodes) {
        if (n.personId && n.name) personNames.set(n.personId, n.name)
      }
      for (const [personId, assignment] of Object.entries(assignments)) {
        const a = assignment as any
        if (!peopleMap[a.layerId]) peopleMap[a.layerId] = []
        peopleMap[a.layerId].push({
          id: personId,
          name: personNames.get(personId) || 'Unknown',
        })
      }
      setLayerPeople(peopleMap)
    } catch (err) {
      console.error('Fetch error:', err)
      setLayers(DEFAULT_LAYERS)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData() }, [fetchData])

  // Pick next unused color
  const nextColor = useCallback((existing: LayerItem[]) => {
    const usedLabels = new Set(existing.map(l => l.color.label))
    return COLOR_PALETTE.find(c => !usedLabels.has(c.label)) || COLOR_PALETTE[existing.length % COLOR_PALETTE.length]
  }, [])

  // ── Modal actions ────────────────────────────────────────────
  const openModal = () => {
    setDraftLayers([...layers])
    setNewName('')
    setDragOverIdx(null)
    setModalOpen(true)
  }

  const saveModal = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_layers_v2',
          layers: draftLayers.map(l => ({
            id: l.id || undefined,
            name: l.name,
            category: l.category || 'custom',
          })),
        }),
      })
      if (!res.ok) throw new Error('Save failed')
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      console.error('Save error:', err)
    } finally {
      setSaving(false)
    }
  }

  const addDraftLayer = () => {
    if (!newName.trim()) return
    const color = nextColor(draftLayers)
    setDraftLayers(prev => [...prev, {
      id: '',
      name: newName.trim(),
      color,
      category: 'custom',
    }])
    setNewName('')
  }

  const removeDraftLayer = (id: string) => {
    setDraftLayers(prev => prev.filter(l => l.id !== id || !l.id))
  }

  // ── Drag handlers ────────────────────────────────────────────
  const onDragStart = (idx: number) => { dragIdx.current = idx }
  const onDragOver = (e: React.DragEvent, idx: number) => { e.preventDefault(); setDragOverIdx(idx) }
  const onDrop = (idx: number) => {
    const from = dragIdx.current
    if (from === null || from === idx) { dragIdx.current = null; setDragOverIdx(null); return }
    setDraftLayers(prev => {
      const copy = [...prev]
      const [item] = copy.splice(from, 1)
      copy.splice(idx, 0, item)
      return copy
    })
    dragIdx.current = null
    setDragOverIdx(null)
  }
  const onDragEnd = () => { dragIdx.current = null; setDragOverIdx(null) }

  // ── Assign Layer (link a PCO list to a layer) ────────────────
  const linkList = async (listId: string, layerId: string) => {
    setAssigning(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_list', list_id: listId, layer_id: layerId }),
      })
      if (!res.ok) throw new Error('Link failed')
      setAssignPickerLayerId(null)
      await fetchData()
    } catch (err) {
      console.error('Link error:', err)
    } finally {
      setAssigning(false)
    }
  }

  const unlinkList = async (listId: string) => {
    setAssigning(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink_list', list_id: listId }),
      })
      if (!res.ok) throw new Error('Unlink failed')
      await fetchData()
    } catch (err) {
      console.error('Unlink error:', err)
    } finally {
      setAssigning(false)
    }
  }

  // ── Helpers ──────────────────────────────────────────────────
  const getLinkedList = (layerId: string) => {
    const link = listLayerLinks.find(ll => ll.layerId === layerId)
    if (!link) return null
    const list = pcoLists.find(l => l.id === link.listId)
    return list ? { ...list, linkListId: link.listId } : null
  }

  const getAvailableLists = (currentLayerId: string) => {
    const linkedListIds = new Set(listLayerLinks.map(ll => ll.listId))
    // Show lists not yet linked to any layer, PLUS the one linked to this layer
    const currentLink = listLayerLinks.find(ll => ll.layerId === currentLayerId)
    return pcoLists.filter(l => !linkedListIds.has(l.id) || l.id === currentLink?.listId)
  }

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 300 }}>
        <span className="sans" style={{ fontSize: 13, color: 'var(--muted-foreground)' }}>Loading...</span>
      </div>
    )
  }

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
            fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 8,
            border: '1px solid var(--border)', background: 'white', color: 'var(--foreground)',
            cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
          }}>
          Manage Layers
        </button>
      </div>

      {/* ── Bands ── */}
      <div>
        {layers.map((layer, i) => {
          const people = layerPeople[layer.id] || []
          const linkedList = getLinkedList(layer.id)

          return (
            <div key={layer.id || `default-${i}`}>
              {i > 0 && (
                <div style={{ borderTop: '2px dashed rgba(0,0,0,0.15)', margin: '0 16px' }} />
              )}
              <div style={{
                minHeight: BAND_MIN_HEIGHT,
                background: layer.color.bg,
                position: 'relative',
                padding: '40px 16px 16px',
              }}>
                {/* Layer label */}
                <div style={{ position: 'absolute', left: 16, top: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div className="sans" style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: layer.color.label }}>
                    {layer.name.toUpperCase()}
                  </div>
                  {linkedList && (
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.7)', border: `1px solid ${layer.color.label}40`,
                    }}>
                      <span className="sans" style={{ fontSize: 10, color: layer.color.label, fontWeight: 500 }}>
                        {linkedList.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')}
                      </span>
                      <button
                        onClick={() => unlinkList(linkedList.linkListId)}
                        style={{
                          background: 'none', border: 'none', cursor: 'pointer',
                          fontSize: 12, color: '#8a3a3a', lineHeight: 1, padding: '0 0 0 2px',
                        }}
                        title="Unlink list"
                      >×</button>
                    </div>
                  )}
                </div>

                {/* Assign Layer button */}
                <div style={{ position: 'absolute', right: 16, top: 10 }}>
                  <button
                    onClick={() => setAssignPickerLayerId(assignPickerLayerId === layer.id ? null : layer.id)}
                    className="sans"
                    style={{
                      fontSize: 11, fontWeight: 500, padding: '4px 10px', borderRadius: 6,
                      border: `1px solid ${layer.color.label}50`, background: 'rgba(255,255,255,0.8)',
                      color: layer.color.label, cursor: 'pointer',
                    }}>
                    Assign List
                  </button>

                  {/* Dropdown picker */}
                  {assignPickerLayerId === layer.id && (
                    <div style={{
                      position: 'absolute', right: 0, top: 32, zIndex: 20,
                      background: 'white', borderRadius: 10,
                      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                      border: '1px solid var(--border)',
                      width: 260, maxHeight: 300, overflowY: 'auto',
                    }}>
                      <div className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', padding: '10px 12px 6px', fontWeight: 600 }}>
                        PCO Reference Lists
                      </div>
                      {pcoLists.length === 0 ? (
                        <div className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: '8px 12px 12px' }}>
                          No reference lists found. Sync PCO first.
                        </div>
                      ) : (
                        getAvailableLists(layer.id).map(list => {
                          const isLinkedHere = linkedList?.id === list.id
                          return (
                            <button
                              key={list.id}
                              onClick={() => isLinkedHere ? unlinkList(list.id) : linkList(list.id, layer.id)}
                              disabled={assigning}
                              className="sans"
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                width: '100%', padding: '8px 12px', border: 'none', cursor: 'pointer',
                                background: isLinkedHere ? `${layer.color.bg}` : 'transparent',
                                textAlign: 'left', fontSize: 12, color: 'var(--foreground)',
                              }}>
                              <span style={{ fontWeight: isLinkedHere ? 600 : 400 }}>
                                {list.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--muted-foreground)', flexShrink: 0, marginLeft: 8 }}>
                                {isLinkedHere ? '✓ Linked' : `${list.totalPeople} people`}
                              </span>
                            </button>
                          )
                        })
                      )}
                      <div style={{ borderTop: '1px solid var(--border)', padding: 6 }}>
                        <button
                          onClick={() => setAssignPickerLayerId(null)}
                          className="sans"
                          style={{
                            width: '100%', fontSize: 11, padding: '6px', borderRadius: 6,
                            border: 'none', background: 'var(--muted)', color: 'var(--muted-foreground)',
                            cursor: 'pointer',
                          }}>
                          Close
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* People cards + placeholder */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 8,
                  alignItems: 'flex-start', minHeight: 72,
                }}>
                  {people.map(person => (
                    <div
                      key={person.id}
                      style={{
                        padding: '8px 14px', borderRadius: 10,
                        background: 'white', border: `1px solid ${layer.color.label}30`,
                        boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                      }}>
                      <span className="sans" style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>
                        {person.name}
                      </span>
                    </div>
                  ))}

                  {/* Placeholder for manual add */}
                  <button style={{
                    padding: '8px 14px', borderRadius: 10,
                    border: `2px dashed ${layer.color.label}50`,
                    background: 'rgba(255,255,255,0.6)',
                    cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                  }}>
                    <span style={{ fontSize: 16, fontWeight: 300, color: layer.color.label, lineHeight: 1 }}>+</span>
                    <span className="sans" style={{ fontSize: 11, fontWeight: 600, color: layer.color.label }}>
                      {layer.name}
                    </span>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MODAL: Manage Layers — drag to reorder
         ═══════════════════════════════════════════════════════════ */}
      {modalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, background: 'rgba(0,0,0,0.3)' }}
          onClick={e => { if (e.target === e.currentTarget) setModalOpen(false) }}
        >
          <div style={{
            background: 'white', borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)', border: '1px solid var(--border)',
            width: 'min(90vw, 440px)', maxHeight: 'min(85vh, 640px)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <h3 className="font-serif" style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>Manage Layers</h3>
              <button onClick={() => setModalOpen(false)} style={{ fontSize: 18, lineHeight: 1, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            {/* Draggable list */}
            <div style={{ overflowY: 'auto', padding: '12px 20px', flex: 1 }}>
              <p className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>
                Drag to reorder. New layers get their own color.
              </p>

              {draftLayers.map((layer, idx) => (
                <div
                  key={layer.id || `draft-${idx}`}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={e => onDragOver(e, idx)}
                  onDrop={() => onDrop(idx)}
                  onDragEnd={onDragEnd}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '10px 12px', margin: '0 0 4px', borderRadius: 8,
                    background: layer.color.bg,
                    border: dragOverIdx === idx ? `2px dashed ${layer.color.label}` : '2px solid transparent',
                    cursor: 'grab', userSelect: 'none', transition: 'border-color 0.15s',
                  }}>
                  <div style={{ color: layer.color.label, opacity: 0.5, fontSize: 14, flexShrink: 0, lineHeight: 1 }}>⠿</div>
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: layer.color.label, flexShrink: 0 }} />
                  <span className="sans" style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', flex: 1 }}>
                    {layer.name}
                  </span>
                  {!layer.id ? (
                    <button onClick={e => { e.stopPropagation(); setDraftLayers(prev => prev.filter((_, j) => j !== idx)) }}
                      style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#8a3a3a', opacity: 0.7, flexShrink: 0 }}>
                      ×
                    </button>
                  ) : (
                    <span className="sans" style={{ fontSize: 9, color: 'var(--muted-foreground)', flexShrink: 0 }}>saved</span>
                  )}
                </div>
              ))}

              {/* Add new layer */}
              <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    placeholder="New layer name..."
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && addDraftLayer()}
                    className="sans"
                    style={{ flex: 1, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, color: 'var(--foreground)', minWidth: 0 }}
                  />
                  <button
                    onClick={addDraftLayer}
                    disabled={!newName.trim()}
                    className="sans"
                    style={{
                      padding: '8px 14px', borderRadius: 8, border: 'none',
                      background: 'var(--primary)', color: 'white',
                      fontSize: 12, fontWeight: 500,
                      cursor: newName.trim() ? 'pointer' : 'default',
                      opacity: newName.trim() ? 1 : 0.4, flexShrink: 0,
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
              <button onClick={saveModal} disabled={saving}
                className="sans"
                style={{ fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Click-away to close assign picker */}
      {assignPickerLayerId && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 15 }}
          onClick={() => setAssignPickerLayerId(null)}
        />
      )}
    </div>
  )
}
