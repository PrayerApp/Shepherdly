'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────
interface LayerItem {
  id: string
  name: string
  color: { bg: string; label: string }
  isDefault?: boolean
}

interface PcoList {
  id: string
  name: string
  totalPeople: number
}

interface PersonCard {
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

const BAND_HEIGHT = 200

// ── Defaults ───────────────────────────────────────────────────
const DEFAULT_LAYERS: LayerItem[] = [
  { id: 'default-elder',     name: 'Elder',        color: COLOR_PALETTE[0], isDefault: true },
  { id: 'default-staff',     name: 'Staff',        color: COLOR_PALETTE[1], isDefault: true },
  { id: 'default-volunteer', name: 'Volunteer',    color: COLOR_PALETTE[2], isDefault: true },
  { id: 'default-people',    name: 'Congregation', color: COLOR_PALETTE[3], isDefault: true },
]

// ── Component ──────────────────────────────────────────────────
export default function ShepherdTreeV2() {
  const [layers, setLayers] = useState<LayerItem[]>(DEFAULT_LAYERS)

  // Modal
  const [modalOpen, setModalOpen] = useState(false)
  const [draftLayers, setDraftLayers] = useState<LayerItem[]>([])
  const [newName, setNewName] = useState('')

  // Drag state for modal list
  const dragIdx = useRef<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // ── Assign List state ──────────────────────────────────────
  const [pcoLists, setPcoLists] = useState<PcoList[]>([])
  const [listsLoaded, setListsLoaded] = useState(false)
  // layerId → { list, people }
  const [layerAssignments, setLayerAssignments] = useState<Record<string, { list: PcoList; people: PersonCard[] }>>({})
  const [assignPickerLayerId, setAssignPickerLayerId] = useState<string | null>(null)
  const [assignLoading, setAssignLoading] = useState(false)

  // Fetch available PCO lists once
  useEffect(() => {
    fetch('/api/tree')
      .then(r => r.json())
      .then(data => {
        setPcoLists(data.pcoLists || [])
        setListsLoaded(true)
      })
      .catch(() => setListsLoaded(true))
  }, [])

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

  const saveModal = () => {
    setLayers(draftLayers)
    setModalOpen(false)
  }

  const addDraftLayer = () => {
    if (!newName.trim()) return
    const color = nextColor(draftLayers)
    setDraftLayers(prev => [...prev, {
      id: crypto.randomUUID(),
      name: newName.trim(),
      color,
    }])
    setNewName('')
  }

  const removeDraftLayer = (id: string) => {
    setDraftLayers(prev => prev.filter(l => l.id !== id))
  }

  // ── Drag handlers ────────────────────────────────────────────
  const onDragStart = (idx: number) => {
    dragIdx.current = idx
  }

  const onDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault()
    setDragOverIdx(idx)
  }

  const onDrop = (idx: number) => {
    const from = dragIdx.current
    if (from === null || from === idx) {
      dragIdx.current = null
      setDragOverIdx(null)
      return
    }
    setDraftLayers(prev => {
      const copy = [...prev]
      const [item] = copy.splice(from, 1)
      copy.splice(idx, 0, item)
      return copy
    })
    dragIdx.current = null
    setDragOverIdx(null)
  }

  const onDragEnd = () => {
    dragIdx.current = null
    setDragOverIdx(null)
  }

  // ── Assign list to a layer ──────────────────────────────────
  const assignList = async (layerId: string, list: PcoList) => {
    setAssignLoading(true)
    try {
      // Fetch the people on this list from the API
      const res = await fetch('/api/tree')
      if (!res.ok) throw new Error()
      const data = await res.json()

      // Find people linked to this list via pco_list_people
      // The GET /api/tree returns pcoListPeople is not directly available,
      // but we can use list_id to find people from the nodes/assignments
      // For now, just fetch the list info — the people will show after linking

      // Actually: we need to call link_list to make the backend resolve people,
      // but we don't have a real layer_id in the DB yet (layers are local state).
      // So for now, we'll just store the assignment locally and show
      // the list name + people count. The actual DB wiring happens later.

      setLayerAssignments(prev => ({
        ...prev,
        [layerId]: { list, people: [] },
      }))
      setAssignPickerLayerId(null)
    } catch {
      // silent
    } finally {
      setAssignLoading(false)
    }
  }

  const unassignList = (layerId: string) => {
    setLayerAssignments(prev => {
      const copy = { ...prev }
      delete copy[layerId]
      return copy
    })
  }

  // Which lists are already assigned to a layer
  const assignedListIds = new Set(Object.values(layerAssignments).map(a => a.list.id))

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
          const assignment = layerAssignments[layer.id]
          return (
            <div key={layer.id}>
              {i > 0 && (
                <div style={{ borderTop: '2px dashed rgba(0,0,0,0.15)', margin: '0 16px' }} />
              )}
              <div style={{
                minHeight: BAND_HEIGHT,
                background: layer.color.bg,
                position: 'relative',
                padding: '40px 16px 16px',
              }}>
                {/* Layer label + linked list badge */}
                <div style={{ position: 'absolute', left: 16, top: 12, display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
                  <div className="sans" style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: layer.color.label }}>
                    {layer.name.toUpperCase()}
                  </div>
                  {assignment && (
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '2px 8px', borderRadius: 6,
                      background: 'rgba(255,255,255,0.7)', border: `1px solid ${layer.color.label}40`,
                    }}>
                      <span className="sans" style={{ fontSize: 10, color: layer.color.label, fontWeight: 500 }}>
                        {assignment.list.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')}
                      </span>
                      <span className="sans" style={{ fontSize: 9, color: 'var(--muted-foreground)' }}>
                        ({assignment.list.totalPeople})
                      </span>
                      <button
                        onClick={() => unassignList(layer.id)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#8a3a3a', lineHeight: 1, padding: '0 0 0 2px' }}
                        title="Unlink list"
                      >×</button>
                    </div>
                  )}
                </div>

                {/* Assign List button */}
                <div style={{ position: 'absolute', right: 16, top: 10, zIndex: 5 }}>
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

                  {/* Dropdown */}
                  {assignPickerLayerId === layer.id && (
                    <div style={{
                      position: 'absolute', right: 0, top: 32, zIndex: 20,
                      background: 'white', borderRadius: 10,
                      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                      border: '1px solid var(--border)',
                      width: 280, maxHeight: 300, overflowY: 'auto',
                    }}>
                      <div className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', padding: '10px 12px 6px', fontWeight: 600 }}>
                        PCO Reference Lists
                      </div>
                      {!listsLoaded ? (
                        <div className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: '8px 12px 12px' }}>
                          Loading...
                        </div>
                      ) : pcoLists.length === 0 ? (
                        <div className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: '8px 12px 12px' }}>
                          No reference lists found. Sync PCO first.
                        </div>
                      ) : (
                        pcoLists.map(list => {
                          const isLinkedHere = assignment?.list.id === list.id
                          const isUsedElsewhere = assignedListIds.has(list.id) && !isLinkedHere
                          return (
                            <button
                              key={list.id}
                              onClick={() => isLinkedHere ? unassignList(layer.id) : assignList(layer.id, list)}
                              disabled={assignLoading || isUsedElsewhere}
                              className="sans"
                              style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                width: '100%', padding: '8px 12px', border: 'none', cursor: isUsedElsewhere ? 'default' : 'pointer',
                                background: isLinkedHere ? layer.color.bg : 'transparent',
                                textAlign: 'left', fontSize: 12,
                                color: isUsedElsewhere ? 'var(--muted-foreground)' : 'var(--foreground)',
                                opacity: isUsedElsewhere ? 0.5 : 1,
                              }}>
                              <span style={{ fontWeight: isLinkedHere ? 600 : 400 }}>
                                {list.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')}
                              </span>
                              <span style={{ fontSize: 10, color: 'var(--muted-foreground)', flexShrink: 0, marginLeft: 8 }}>
                                {isLinkedHere ? '✓ Linked' : isUsedElsewhere ? 'In use' : `${list.totalPeople} people`}
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
                  alignItems: 'center', justifyContent: 'center',
                  minHeight: BAND_HEIGHT - 56,
                }}>
                  {assignment && assignment.people.map(person => (
                    <div key={person.id} style={{
                      padding: '8px 14px', borderRadius: 10,
                      background: 'white', border: `1px solid ${layer.color.label}30`,
                      boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                    }}>
                      <span className="sans" style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>
                        {person.name}
                      </span>
                    </div>
                  ))}

                  {/* Placeholder: always visible for adding people */}
                  <button style={{
                    width: 220, height: 72,
                    border: `2px dashed ${layer.color.label}70`,
                    borderRadius: 12, background: 'white',
                    cursor: 'pointer', opacity: 0.7,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 2,
                  }}>
                    <span style={{ fontSize: 18, fontWeight: 300, color: layer.color.label }}>+</span>
                    <span className="sans" style={{ fontSize: 10, fontWeight: 600, color: layer.color.label }}>{layer.name}</span>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* Click-away to close assign picker */}
      {assignPickerLayerId && (
        <div
          style={{ position: 'fixed', inset: 0, zIndex: 4 }}
          onClick={() => setAssignPickerLayerId(null)}
        />
      )}

      {/* ══════════════════════════════════════════════════════════
          MODAL: Manage Layers — drag to reorder
         ══════════════════════════════════════════════════════════ */}
      {modalOpen && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, background: 'rgba(0,0,0,0.3)' }}>
          <div style={{
            background: 'white',
            borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)',
            border: '1px solid var(--border)',
            width: 'min(90vw, 440px)',
            maxHeight: 'min(85vh, 640px)',
            display: 'flex',
            flexDirection: 'column',
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
                  key={layer.id}
                  draggable
                  onDragStart={() => onDragStart(idx)}
                  onDragOver={e => onDragOver(e, idx)}
                  onDrop={() => onDrop(idx)}
                  onDragEnd={onDragEnd}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 12px',
                    margin: '0 0 4px',
                    borderRadius: 8,
                    background: layer.color.bg,
                    border: dragOverIdx === idx ? `2px dashed ${layer.color.label}` : '2px solid transparent',
                    cursor: 'grab',
                    userSelect: 'none',
                    transition: 'border-color 0.15s',
                  }}>
                  {/* Drag handle */}
                  <div style={{ color: layer.color.label, opacity: 0.5, fontSize: 14, flexShrink: 0, lineHeight: 1 }}>⠿</div>

                  {/* Color swatch */}
                  <div style={{ width: 10, height: 10, borderRadius: 3, background: layer.color.label, flexShrink: 0 }} />

                  {/* Name */}
                  <span className="sans" style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', flex: 1 }}>
                    {layer.name}
                  </span>

                  {/* Delete (not for defaults) */}
                  {layer.isDefault ? (
                    <span className="sans" style={{ fontSize: 9, color: 'var(--muted-foreground)', flexShrink: 0 }}>default</span>
                  ) : (
                    <button onClick={e => { e.stopPropagation(); removeDraftLayer(layer.id) }}
                      style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#8a3a3a', opacity: 0.7, flexShrink: 0 }}>
                      ×
                    </button>
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
                      padding: '8px 14px',
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
