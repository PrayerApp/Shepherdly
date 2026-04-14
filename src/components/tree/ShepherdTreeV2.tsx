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

interface ListPerson {
  listId: string
  personId: string
  personName: string
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

  // Manage Layers modal
  const [modalOpen, setModalOpen] = useState(false)
  const [draftLayers, setDraftLayers] = useState<LayerItem[]>([])
  const [newName, setNewName] = useState('')

  // Drag state for modal list
  const dragIdx = useRef<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // ── Assign List state ──────────────────────────────────────
  const [pcoLists, setPcoLists] = useState<PcoList[]>([])
  const [listPeople, setListPeople] = useState<ListPerson[]>([])
  const [listsLoaded, setListsLoaded] = useState(false)
  // layerId → { list, people[] }
  const [layerAssignments, setLayerAssignments] = useState<Record<string, { list: PcoList; people: PersonCard[] }>>({})
  // Assign List modal
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [assignSelectedLayerId, setAssignSelectedLayerId] = useState<string | null>(null)

  // Fetch available PCO lists + their people once
  useEffect(() => {
    fetch('/api/tree')
      .then(r => r.json())
      .then(data => {
        setPcoLists(data.pcoLists || [])
        setListPeople(data.pcoListPeople || [])
        setListsLoaded(true)
      })
      .catch(() => setListsLoaded(true))
  }, [])

  // Pick next unused color
  const nextColor = useCallback((existing: LayerItem[]) => {
    const usedLabels = new Set(existing.map(l => l.color.label))
    return COLOR_PALETTE.find(c => !usedLabels.has(c.label)) || COLOR_PALETTE[existing.length % COLOR_PALETTE.length]
  }, [])

  // ── Manage Layers modal actions ──────────────────────────────
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

  // ── Assign list to a layer ──────────────────────────────────
  const assignList = (layerId: string, list: PcoList) => {
    // Get the people on this list from the cached data
    const people = listPeople
      .filter(lp => lp.listId === list.id)
      .map(lp => ({ id: lp.personId, name: lp.personName }))

    setLayerAssignments(prev => ({
      ...prev,
      [layerId]: { list, people },
    }))
    setAssignModalOpen(false)
    setAssignSelectedLayerId(null)
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
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => { setAssignSelectedLayerId(null); setAssignModalOpen(true) }}
            className="sans"
            style={{
              fontSize: 12, fontWeight: 500, padding: '6px 12px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'white', color: 'var(--foreground)',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            Assign List
          </button>
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
      </div>

      {/* ── Bands ── */}
      <div>
        {layers.map((layer, i) => {
          const assignment = layerAssignments[layer.id]
          const people = assignment?.people || []

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
                {/* Layer label */}
                <div style={{ position: 'absolute', left: 16, top: 12, userSelect: 'none' }}>
                  <div className="sans" style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: layer.color.label }}>
                    {layer.name.toUpperCase()}
                    {assignment && (
                      <span style={{ fontWeight: 500, letterSpacing: 0, marginLeft: 8, fontSize: 10, opacity: 0.7 }}>
                        — {assignment.list.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')}
                        <button
                          onClick={() => unassignList(layer.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#8a3a3a', lineHeight: 1, padding: '0 0 0 4px', verticalAlign: 'middle' }}
                          title="Unlink list"
                        >×</button>
                      </span>
                    )}
                  </div>
                </div>

                {/* People cards + placeholder */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: 8,
                  alignItems: 'center',
                  minHeight: BAND_HEIGHT - 56,
                  ...(people.length === 0 ? { justifyContent: 'center' } : {}),
                }}>
                  {people.map(person => (
                    <div key={person.id} style={{
                      padding: '10px 16px', borderRadius: 10,
                      background: 'white', border: `1px solid ${layer.color.label}25`,
                      boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                    }}>
                      <span className="sans" style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>
                        {person.name}
                      </span>
                    </div>
                  ))}

                  {/* Placeholder: always visible */}
                  <button style={{
                    width: people.length > 0 ? 'auto' : 220,
                    height: people.length > 0 ? 'auto' : 72,
                    padding: people.length > 0 ? '10px 16px' : undefined,
                    border: `2px dashed ${layer.color.label}70`,
                    borderRadius: 12, background: 'white',
                    cursor: 'pointer', opacity: 0.7,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: people.length > 0 ? 'row' : 'column',
                    gap: people.length > 0 ? 6 : 2,
                  }}>
                    <span style={{ fontSize: people.length > 0 ? 14 : 18, fontWeight: 300, color: layer.color.label }}>+</span>
                    <span className="sans" style={{ fontSize: 10, fontWeight: 600, color: layer.color.label }}>{layer.name}</span>
                  </button>
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* ═══════════════════════════════════════════════════════════
          MODAL: Assign List — pick a layer, then a list
         ═══════════════════════════════════════════════════════════ */}
      {assignModalOpen && (
        <div
          style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, background: 'rgba(0,0,0,0.3)' }}
          onClick={e => { if (e.target === e.currentTarget) { setAssignModalOpen(false); setAssignSelectedLayerId(null) } }}
        >
          <div style={{
            background: 'white', borderRadius: 16,
            boxShadow: '0 8px 30px rgba(0,0,0,0.12)', border: '1px solid var(--border)',
            width: 'min(90vw, 440px)', maxHeight: 'min(85vh, 600px)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <h3 className="font-serif" style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>
                {assignSelectedLayerId ? 'Choose a Reference List' : 'Assign List to Layer'}
              </h3>
              <button onClick={() => { setAssignModalOpen(false); setAssignSelectedLayerId(null) }}
                style={{ fontSize: 18, lineHeight: 1, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            <div style={{ overflowY: 'auto', padding: '12px 20px', flex: 1 }}>
              {!assignSelectedLayerId ? (
                /* Step 1: Pick a layer */
                <>
                  <p className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>
                    Select a layer to assign a PCO Reference List to.
                  </p>
                  {layers.map(layer => {
                    const existing = layerAssignments[layer.id]
                    return (
                      <button
                        key={layer.id}
                        onClick={() => setAssignSelectedLayerId(layer.id)}
                        className="sans"
                        style={{
                          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
                          padding: '10px 12px', margin: '0 0 4px', borderRadius: 8,
                          background: layer.color.bg, border: '1px solid transparent',
                          cursor: 'pointer', textAlign: 'left',
                        }}>
                        <div style={{ width: 10, height: 10, borderRadius: 3, background: layer.color.label, flexShrink: 0 }} />
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)', flex: 1 }}>
                          {layer.name}
                        </span>
                        {existing ? (
                          <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>
                            {existing.list.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')} ({existing.people.length})
                          </span>
                        ) : (
                          <span style={{ fontSize: 10, color: layer.color.label }}>No list</span>
                        )}
                      </button>
                    )
                  })}
                </>
              ) : (
                /* Step 2: Pick a list */
                <>
                  <button
                    onClick={() => setAssignSelectedLayerId(null)}
                    className="sans"
                    style={{
                      fontSize: 11, color: 'var(--muted-foreground)', background: 'none',
                      border: 'none', cursor: 'pointer', padding: '0 0 8px', display: 'flex', alignItems: 'center', gap: 4,
                    }}>
                    ← Back to layers
                  </button>
                  <div className="sans" style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 10px' }}>
                    Assigning to: {layers.find(l => l.id === assignSelectedLayerId)?.name}
                  </div>
                  {!listsLoaded ? (
                    <p className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>Loading lists...</p>
                  ) : pcoLists.length === 0 ? (
                    <p className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)' }}>
                      No reference lists found. Sync PCO first.
                    </p>
                  ) : (
                    pcoLists.map(list => {
                      const isLinkedHere = layerAssignments[assignSelectedLayerId]?.list.id === list.id
                      const isUsedElsewhere = assignedListIds.has(list.id) && !isLinkedHere
                      const peopleCount = listPeople.filter(lp => lp.listId === list.id).length
                      return (
                        <button
                          key={list.id}
                          onClick={() => {
                            if (isLinkedHere) {
                              unassignList(assignSelectedLayerId)
                              setAssignModalOpen(false)
                              setAssignSelectedLayerId(null)
                            } else {
                              assignList(assignSelectedLayerId, list)
                            }
                          }}
                          disabled={isUsedElsewhere}
                          className="sans"
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            width: '100%', padding: '10px 12px', margin: '0 0 4px', borderRadius: 8,
                            border: isLinkedHere ? '2px solid var(--primary)' : '1px solid var(--border)',
                            cursor: isUsedElsewhere ? 'default' : 'pointer',
                            background: isLinkedHere ? 'rgba(45, 96, 71, 0.06)' : 'white',
                            textAlign: 'left', fontSize: 12,
                            color: isUsedElsewhere ? 'var(--muted-foreground)' : 'var(--foreground)',
                            opacity: isUsedElsewhere ? 0.5 : 1,
                          }}>
                          <span style={{ fontWeight: isLinkedHere ? 600 : 400 }}>
                            {list.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--muted-foreground)', flexShrink: 0, marginLeft: 8 }}>
                            {isLinkedHere ? '✓ Linked' : isUsedElsewhere ? 'In use' : `${peopleCount} people`}
                          </span>
                        </button>
                      )
                    })
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--muted)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', borderRadius: '0 0 16px 16px' }}>
              <button onClick={() => { setAssignModalOpen(false); setAssignSelectedLayerId(null) }}
                className="sans"
                style={{ fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════
          MODAL: Manage Layers — drag to reorder
         ═══════════════════════════════════════════════════════════ */}
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
