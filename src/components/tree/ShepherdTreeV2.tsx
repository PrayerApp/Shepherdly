'use client'

import { useState, useRef, useCallback, useEffect } from 'react'

// ── Types ──────────────────────────────────────────────────────
interface LayerItem {
  id: string
  name: string
  color: { bg: string; label: string }
  category?: string
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

interface PersonStat {
  s: number // staff shepherded
  l: number // non-staff leaders shepherded
  p: number // congregation via groups/teams
  f: number // floaters (direct shepherding only)
  total: number
}

// Category colors for stat pills
const STAT_STYLES = {
  s: { bg: 'rgba(140, 90, 180, 0.14)', fg: '#5a2e87' },  // staff — purple
  l: { bg: 'rgba(80, 130, 190, 0.16)', fg: '#2b5a8a' },  // leaders — blue
  p: { bg: 'rgba(60, 160, 90, 0.16)',  fg: '#2a6a3a' },  // groups/teams — green
  f: { bg: 'rgba(200, 140, 60, 0.18)', fg: '#8a5a1a' },  // floaters — amber
}

interface ListLayerLink {
  listId: string
  layerId: string
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

const DEFAULT_LAYER_NAMES = [
  { name: 'Elder',        category: 'elder' },
  { name: 'Staff',        category: 'staff' },
  { name: 'Volunteer',    category: 'volunteer' },
  { name: 'Congregation', category: 'people' },
]

function colorForIndex(i: number) {
  return COLOR_PALETTE[i % COLOR_PALETTE.length]
}

// ── Component ──────────────────────────────────────────────────
export default function ShepherdTreeV2() {
  const [layers, setLayers] = useState<LayerItem[]>([])
  const [loading, setLoading] = useState(true)

  // Manage Layers modal
  const [modalOpen, setModalOpen] = useState(false)
  const [draftLayers, setDraftLayers] = useState<LayerItem[]>([])
  const [newName, setNewName] = useState('')
  const [saving, setSaving] = useState(false)

  // Drag state for modal list
  const dragIdx = useRef<number | null>(null)
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null)

  // ── Assign List state ──────────────────────────────────────
  const [pcoLists, setPcoLists] = useState<PcoList[]>([])
  const [listPeople, setListPeople] = useState<ListPerson[]>([])
  const [listLayerLinks, setListLayerLinks] = useState<ListLayerLink[]>([])
  const [listsLoaded, setListsLoaded] = useState(false)
  const [personStats, setPersonStats] = useState<Record<string, PersonStat>>({})
  // Assign List modal
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [assignSelectedLayerId, setAssignSelectedLayerId] = useState<string | null>(null)
  const [assignBusy, setAssignBusy] = useState(false)

  // ── Fetch all data from API ─────────────────────────────────
  const fetchData = useCallback(async (isInit = false) => {
    try {
      const res = await fetch('/api/tree')
      if (!res.ok) throw new Error()
      const data = await res.json()

      // PCO data
      setPcoLists(data.pcoLists || [])
      setListPeople(data.pcoListPeople || [])
      setListLayerLinks(data.listLayerLinks || [])
      setPersonStats(data.personStats || {})
      setListsLoaded(true)

      // Layers from DB
      const dbLayers: LayerItem[] = (data.layers || []).map((l: any, i: number) => ({
        id: l.id,
        name: l.name,
        color: colorForIndex(i),
        category: l.category,
      }))

      if (dbLayers.length > 0) {
        setLayers(dbLayers)
      } else if (isInit) {
        // First time: save defaults to DB
        const res2 = await fetch('/api/tree', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'save_layers_v2',
            layers: DEFAULT_LAYER_NAMES.map(d => ({ name: d.name, category: d.category })),
          }),
        })
        if (res2.ok) {
          const d2 = await res2.json()
          if (d2.layers) {
            setLayers(d2.layers.map((l: any, i: number) => ({
              id: l.id, name: l.name, color: colorForIndex(i), category: l.category,
            })))
          }
        }
      }
    } catch {
      // If fetch fails, show defaults locally
      if (isInit) {
        setLayers(DEFAULT_LAYER_NAMES.map((d, i) => ({
          id: `local-${i}`, name: d.name, color: colorForIndex(i), category: d.category,
        })))
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchData(true) }, [fetchData])

  // ── Derived: people per layer from list-layer links ─────────
  const getPeopleForLayer = (layerId: string): PersonCard[] => {
    const link = listLayerLinks.find(ll => ll.layerId === layerId)
    if (!link) return []
    return listPeople
      .filter(lp => lp.listId === link.listId)
      .map(lp => ({ id: lp.personId, name: lp.personName }))
  }

  const getLinkedList = (layerId: string): PcoList | null => {
    const link = listLayerLinks.find(ll => ll.layerId === layerId)
    if (!link) return null
    return pcoLists.find(l => l.id === link.listId) || null
  }

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

  const saveModal = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_layers_v2',
          layers: draftLayers.map(l => ({
            id: l.id.startsWith('local-') ? undefined : l.id,
            name: l.name,
            category: l.category || 'custom',
          })),
        }),
      })
      if (!res.ok) throw new Error()
      setModalOpen(false)
      await fetchData()
    } catch (err) {
      console.error('Save layers error:', err)
    } finally {
      setSaving(false)
    }
  }

  const addDraftLayer = () => {
    if (!newName.trim()) return
    const color = nextColor(draftLayers)
    setDraftLayers(prev => [...prev, {
      id: crypto.randomUUID(), // temporary, will be replaced by DB id on save
      name: newName.trim(),
      color,
      category: 'custom',
    }])
    setNewName('')
  }

  const removeDraftLayer = (idx: number) => {
    setDraftLayers(prev => prev.filter((_, i) => i !== idx))
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

  // ── Assign / unassign list (persisted to DB) ────────────────
  const assignList = async (layerId: string, list: PcoList) => {
    setAssignBusy(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'link_list', list_id: list.id, layer_id: layerId }),
      })
      if (!res.ok) throw new Error()
      setAssignModalOpen(false)
      setAssignSelectedLayerId(null)
      await fetchData()
    } catch (err) {
      console.error('Link list error:', err)
    } finally {
      setAssignBusy(false)
    }
  }

  const unassignList = async (listId: string) => {
    setAssignBusy(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'unlink_list', list_id: listId }),
      })
      if (!res.ok) throw new Error()
      await fetchData()
    } catch (err) {
      console.error('Unlink list error:', err)
    } finally {
      setAssignBusy(false)
    }
  }

  // Which lists are already linked
  const linkedListIds = new Set(listLayerLinks.map(ll => ll.listId))

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
          const people = getPeopleForLayer(layer.id)
          const linkedList = getLinkedList(layer.id)

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
                    {linkedList && (
                      <span style={{ fontWeight: 500, letterSpacing: 0, marginLeft: 8, fontSize: 10, opacity: 0.7 }}>
                        — {linkedList.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')}
                        <button
                          onClick={() => unassignList(linkedList.id)}
                          disabled={assignBusy}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#8a3a3a', lineHeight: 1, padding: '0 0 0 4px', verticalAlign: 'middle' }}
                          title="Unlink list"
                        >×</button>
                      </span>
                    )}
                  </div>
                </div>

                {/* People cards + placeholder — horizontal scroll */}
                <div style={{
                  display: 'flex', flexWrap: 'nowrap', gap: 8,
                  alignItems: 'center',
                  minHeight: BAND_HEIGHT - 56,
                  overflowX: 'auto', overflowY: 'hidden',
                  paddingBottom: 6,
                  scrollbarWidth: 'thin',
                  WebkitOverflowScrolling: 'touch',
                  ...(people.length === 0 ? { justifyContent: 'center' } : {}),
                }}>
                  {people.map(person => {
                    const stat = personStats[person.id] || { s: 0, l: 0, p: 0, f: 0, total: 0 }
                    const total = stat.total
                    // Segmented bar proportions
                    const segs: [keyof typeof STAT_STYLES, number][] = [
                      ['s', stat.s], ['l', stat.l], ['p', stat.p], ['f', stat.f],
                    ]
                    return (
                      <div
                        key={person.id}
                        title={`${person.name} — ${total} shepherded · ${stat.s} staff · ${stat.l} leaders · ${stat.p} via groups/teams · ${stat.f} floaters`}
                        style={{
                          width: 210, height: 96,
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: 'white',
                          border: `1px solid ${layer.color.label}22`,
                          boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
                          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                          boxSizing: 'border-box',
                          flexShrink: 0,
                        }}
                      >
                        {/* Name */}
                        <div
                          className="sans"
                          style={{
                            fontSize: 13, fontWeight: 600, color: 'var(--foreground)',
                            lineHeight: 1.2, whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                          }}
                        >
                          {person.name}
                        </div>

                        {/* Count + segmented bar */}
                        <div>
                          <div className="sans" style={{
                            fontSize: 10, fontWeight: 500, color: 'var(--muted-foreground)',
                            letterSpacing: 0.3, marginBottom: 4,
                          }}>
                            shepherding <span style={{ fontWeight: 700, color: layer.color.label, fontSize: 11 }}>{total}</span>
                          </div>
                          <div style={{
                            display: 'flex', height: 4, borderRadius: 2,
                            background: 'rgba(0,0,0,0.05)', overflow: 'hidden', marginBottom: 5,
                          }}>
                            {total > 0 && segs.map(([k, v]) => (
                              v > 0 ? (
                                <div
                                  key={k}
                                  style={{
                                    flex: v,
                                    background: STAT_STYLES[k].fg,
                                    opacity: 0.85,
                                  }}
                                />
                              ) : null
                            ))}
                          </div>
                          {/* Stat pills */}
                          <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between' }}>
                            {(['s','l','p','f'] as const).map(k => {
                              const v = stat[k]
                              const style = STAT_STYLES[k]
                              const faded = v === 0
                              return (
                                <span
                                  key={k}
                                  className="sans"
                                  style={{
                                    flex: 1, textAlign: 'center',
                                    fontSize: 10, fontWeight: 600,
                                    padding: '2px 0', borderRadius: 4,
                                    background: faded ? 'rgba(0,0,0,0.03)' : style.bg,
                                    color: faded ? 'var(--muted-foreground)' : style.fg,
                                    letterSpacing: 0.2,
                                  }}
                                >
                                  {v}{k.toUpperCase()}
                                </span>
                              )
                            })}
                          </div>
                        </div>
                      </div>
                    )
                  })}

                  {/* Placeholder: always visible, matches card size for uniform look */}
                  <button style={{
                    width: 210, height: 96,
                    padding: 0,
                    border: `2px dashed ${layer.color.label}70`,
                    borderRadius: 12, background: 'white',
                    cursor: 'pointer', opacity: 0.7,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexDirection: 'column', gap: 2,
                    flexShrink: 0,
                    boxSizing: 'border-box',
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
                    const linked = getLinkedList(layer.id)
                    const people = getPeopleForLayer(layer.id)
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
                        {linked ? (
                          <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>
                            {linked.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')} ({people.length})
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
                      const isLinkedHere = listLayerLinks.some(ll => ll.layerId === assignSelectedLayerId && ll.listId === list.id)
                      const isUsedElsewhere = linkedListIds.has(list.id) && !isLinkedHere
                      const peopleCount = listPeople.filter(lp => lp.listId === list.id).length
                      return (
                        <button
                          key={list.id}
                          onClick={() => {
                            if (isLinkedHere) {
                              unassignList(list.id)
                              setAssignModalOpen(false)
                              setAssignSelectedLayerId(null)
                            } else {
                              assignList(assignSelectedLayerId, list)
                            }
                          }}
                          disabled={isUsedElsewhere || assignBusy}
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

              {draftLayers.map((layer, idx) => {
                // A layer is "new" if its id doesn't match any DB layer
                const isFromDb = layers.some(l => l.id === layer.id)
                return (
                  <div
                    key={`${layer.id}-${idx}`}
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

                    {/* Delete */}
                    <button onClick={e => { e.stopPropagation(); removeDraftLayer(idx) }}
                      style={{ width: 24, height: 24, borderRadius: 4, border: 'none', background: 'none', cursor: 'pointer', fontSize: 14, color: '#8a3a3a', opacity: 0.7, flexShrink: 0 }}
                      title={isFromDb ? 'Remove layer' : 'Remove'}>
                      ×
                    </button>
                  </div>
                )
              })}

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
              <button onClick={saveModal} disabled={saving}
                className="sans"
                style={{ fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: 'none', background: 'var(--primary)', color: 'white', cursor: 'pointer', opacity: saving ? 0.6 : 1 }}>
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
