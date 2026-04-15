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

interface LayerExclusion {
  personId: string
  layerId: string
}

interface GtMapping {
  id: string
  name: string
  kind: 'groups' | 'teams'
  leaderLayerId: string | null
  memberLayerId: string | null
  itemIds: string[]
}

interface MappingLayerPerson {
  layerId: string
  personId: string
  personName: string
  role: 'leader' | 'member'
}

interface GroupLite {
  id: string
  name: string
  groupTypeName: string | null
}
interface TeamLite {
  id: string
  name: string
  serviceTypeName: string | null
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

const BAND_HEIGHT = 150

const DEFAULT_LAYER_NAMES = [
  { name: 'Elder',        category: 'elder' },
  { name: 'Staff',        category: 'staff' },
  { name: 'Volunteer',    category: 'volunteer' },
  { name: 'Congregation', category: 'people' },
]

function colorForIndex(i: number) {
  return COLOR_PALETTE[i % COLOR_PALETTE.length]
}

// Extract last name for sorting. Ignores common suffixes (Jr., Sr., II, III, IV, V).
function lastName(full: string): string {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const suffixes = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i
  let i = parts.length - 1
  while (i > 0 && suffixes.test(parts[i])) i--
  return parts[i]
}

const SELECT_OUTLINE = '#e6b800' // warm yellow

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
  const [exclusions, setExclusions] = useState<LayerExclusion[]>([])
  const [gtMappings, setGtMappings] = useState<GtMapping[]>([])
  const [mappingLayerPeople, setMappingLayerPeople] = useState<MappingLayerPerson[]>([])
  const [groupsList, setGroupsList] = useState<GroupLite[]>([])
  const [teamsList, setTeamsList] = useState<TeamLite[]>([])
  // When a card is long-pressed, we enter "delete mode" for that (personId,layerId).
  // ── Edit mode: toggled from the toolbar ─────────────────────
  // In edit mode, excluded people re-appear as ghost cards and can be
  // restored. Clicking a card selects it (shift/cmd for multi-select).
  // Outside edit mode, cards are read-only.
  const [editMode, setEditMode] = useState(false)

  // ── Selection (key = "personId::layerId") ───────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const lastSelectedRef = useRef<{ layerId: string; index: number } | null>(null)
  const selKey = (personId: string, layerId: string) => `${personId}::${layerId}`
  // Assign List modal
  const [assignModalOpen, setAssignModalOpen] = useState(false)
  const [assignSelectedLayerId, setAssignSelectedLayerId] = useState<string | null>(null)
  const [assignBusy, setAssignBusy] = useState(false)
  // Assign modal tab: 'lists' (existing REF list flow) or 'mappings' (Group/Team flow)
  const [assignTab, setAssignTab] = useState<'lists' | 'mappings'>('lists')
  // Mapping editor state
  const [mappingDraft, setMappingDraft] = useState<{
    id?: string
    name: string
    kind: 'groups' | 'teams'
    leaderLayerId: string | null
    memberLayerId: string | null
    itemIds: Set<string>
    search: string
  } | null>(null)

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
      setExclusions(data.layerExclusions || [])
      setGtMappings(data.gtMappings || [])
      setMappingLayerPeople(data.mappingLayerPeople || [])
      setGroupsList(data.groupsList || [])
      setTeamsList(data.teamsList || [])
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

  // ── Derived: people per layer from list-layer links + Group/Team mappings ──
  // Unions PCO list-based entries with any mapping-derived entries (leader/member
  // derivations from Group/Team mappings). In edit mode, excluded people are
  // kept and flagged as ghosts; otherwise they're hidden.
  const getPeopleForLayer = (layerId: string): (PersonCard & { isExcluded: boolean })[] => {
    const excluded = new Set(
      exclusions.filter(e => e.layerId === layerId).map(e => e.personId)
    )

    // 1) People from a PCO reference list linked to this layer
    const link = listLayerLinks.find(ll => ll.layerId === layerId)
    const fromList: { id: string; name: string }[] = link
      ? listPeople.filter(lp => lp.listId === link.listId).map(lp => ({ id: lp.personId, name: lp.personName }))
      : []

    // 2) People derived from Group/Team mappings where this layer is the leader
    //    or member target
    const fromMappings = mappingLayerPeople
      .filter(mp => mp.layerId === layerId)
      .map(mp => ({ id: mp.personId, name: mp.personName }))

    // Merge by personId (dedupe)
    const byId = new Map<string, { id: string; name: string }>()
    for (const p of [...fromList, ...fromMappings]) {
      if (!byId.has(p.id)) byId.set(p.id, p)
    }

    return [...byId.values()]
      .filter(p => editMode || !excluded.has(p.id))
      .map(p => ({ id: p.id, name: p.name, isExcluded: excluded.has(p.id) }))
      .sort((a, b) => {
        const la = lastName(a.name), lb = lastName(b.name)
        const cmp = la.localeCompare(lb, undefined, { sensitivity: 'base' })
        if (cmp !== 0) return cmp
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      })
  }

  // ── Card click → selection (edit mode only) ────────────────
  const handleCardClick = (e: React.MouseEvent, personId: string, layerId: string, people: (PersonCard & { isExcluded: boolean })[]) => {
    if (!editMode) return
    const key = selKey(personId, layerId)
    const index = people.findIndex(p => p.id === personId)

    if (e.shiftKey && lastSelectedRef.current && lastSelectedRef.current.layerId === layerId) {
      // Range select within the same layer
      const [lo, hi] = [lastSelectedRef.current.index, index].sort((a, b) => a - b)
      const next = new Set(selected)
      for (let i = lo; i <= hi; i++) next.add(selKey(people[i].id, layerId))
      setSelected(next)
    } else if (e.metaKey || e.ctrlKey) {
      // Toggle additive
      const next = new Set(selected)
      if (next.has(key)) next.delete(key); else next.add(key)
      setSelected(next)
      lastSelectedRef.current = { layerId, index }
    } else {
      // Plain click: toggle this one, clear others
      const wasOnlyMe = selected.size === 1 && selected.has(key)
      const next = new Set<string>()
      if (!wasOnlyMe) next.add(key)
      setSelected(next)
      lastSelectedRef.current = { layerId, index }
    }
  }

  const selectAllInLayer = (layerId: string, people: (PersonCard & { isExcluded: boolean })[]) => {
    const next = new Set(selected)
    const allSelected = people.every(p => next.has(selKey(p.id, layerId)))
    if (allSelected) {
      for (const p of people) next.delete(selKey(p.id, layerId))
    } else {
      for (const p of people) next.add(selKey(p.id, layerId))
    }
    setSelected(next)
    if (people.length > 0) lastSelectedRef.current = { layerId, index: 0 }
  }

  const clearSelection = () => setSelected(new Set())

  // ── Bulk actions on the selected set ─────────────────────────
  // Walk the selection, group by layer, and post the right action per person.
  const applyToSelection = async (mode: 'remove' | 'restore') => {
    if (selected.size === 0) return
    const items: { personId: string; layerId: string }[] = []
    for (const k of selected) {
      const [personId, layerId] = k.split('::')
      items.push({ personId, layerId })
    }

    // Optimistic update
    setExclusions(prev => {
      const next = [...prev]
      for (const { personId, layerId } of items) {
        const idx = next.findIndex(e => e.personId === personId && e.layerId === layerId)
        if (mode === 'remove' && idx === -1) next.push({ personId, layerId })
        if (mode === 'restore' && idx !== -1) next.splice(idx, 1)
      }
      return next
    })
    clearSelection()

    try {
      await Promise.all(items.map(({ personId, layerId }) =>
        fetch('/api/tree', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: mode === 'remove' ? 'exclude_person' : 'include_person',
            person_id: personId,
            layer_id: layerId,
          }),
        }).then(r => { if (!r.ok) throw new Error() })
      ))
    } catch (err) {
      console.error('Bulk', mode, 'error:', err)
      // Re-sync from server on failure
      fetchData()
    }
  }

  // Selection summary (how many are excluded vs active) for the action bar
  const selectionSummary = (() => {
    const exclSet = new Set(exclusions.map(e => `${e.personId}::${e.layerId}`))
    let excludedCount = 0, activeCount = 0
    for (const k of selected) {
      if (exclSet.has(k)) excludedCount++; else activeCount++
    }
    return { excludedCount, activeCount, total: selected.size }
  })()
  // Escape exits edit mode / clears selection
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      if (selected.size > 0) clearSelection()
      else if (editMode) setEditMode(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selected, editMode])

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

  // ── Group/Team mapping: save + delete ───────────────────────
  const saveMappingDraft = async () => {
    if (!mappingDraft) return
    if (!mappingDraft.name.trim()) return
    if (!mappingDraft.leaderLayerId && !mappingDraft.memberLayerId) return
    setAssignBusy(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_gt_mapping',
          id: mappingDraft.id,
          name: mappingDraft.name.trim(),
          kind: mappingDraft.kind,
          leader_layer_id: mappingDraft.leaderLayerId,
          member_layer_id: mappingDraft.memberLayerId,
          item_ids: [...mappingDraft.itemIds],
        }),
      })
      if (!res.ok) throw new Error()
      setMappingDraft(null)
      await fetchData()
    } catch (err) {
      console.error('Save mapping error:', err)
    } finally {
      setAssignBusy(false)
    }
  }
  const deleteMapping = async (id: string) => {
    if (!confirm('Delete this mapping?')) return
    setAssignBusy(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'delete_gt_mapping', id }),
      })
      if (!res.ok) throw new Error()
      await fetchData()
    } catch (err) {
      console.error('Delete mapping error:', err)
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
          <button
            onClick={() => { setEditMode(m => !m); if (editMode) clearSelection() }}
            className="sans"
            style={{
              fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
              border: `1px solid ${editMode ? SELECT_OUTLINE : 'var(--border)'}`,
              background: editMode ? `${SELECT_OUTLINE}22` : 'white',
              color: editMode ? '#7a5a00' : 'var(--foreground)',
              cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            }}>
            {editMode ? 'Done' : 'Edit'}
          </button>
        </div>
      </div>

      {/* ── Bands: one shared horizontal scroller so columns align ── */}
      <div style={{
        overflowX: 'auto',
        overflowY: 'hidden',
        WebkitOverflowScrolling: 'touch',
      }}>
      <div style={{ minWidth: 'max-content' }}>
        {layers.map((layer, i) => {
          const people = getPeopleForLayer(layer.id)
          const linkedList = getLinkedList(layer.id)

          return (
            <div key={layer.id}>
              {i > 0 && (
                <div style={{ borderTop: '2px dashed rgba(0,0,0,0.15)', margin: '0 16px' }} />
              )}
              <div
                onClick={e => { if (e.target === e.currentTarget) clearSelection() }}
                style={{
                  minHeight: BAND_HEIGHT,
                  background: layer.color.bg,
                  position: 'relative',
                  padding: '40px 16px 16px',
                }}>
                {/* Layer label */}
                <div style={{ position: 'absolute', left: 16, top: 12, right: 16, userSelect: 'none', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div className="sans" style={{ fontSize: 12, fontWeight: 800, letterSpacing: 2, color: layer.color.label }}>
                    {layer.name.toUpperCase()}
                    {linkedList && (
                      <span style={{ fontWeight: 500, letterSpacing: 0, marginLeft: 8, fontSize: 10, opacity: 0.7 }}>
                        — {linkedList.name.replace(/^REFERENCE\s*[-–—:]\s*/i, '')}
                        <button
                          onClick={e => { e.stopPropagation(); unassignList(linkedList.id) }}
                          disabled={assignBusy}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#8a3a3a', lineHeight: 1, padding: '0 0 0 4px', verticalAlign: 'middle' }}
                          title="Unlink list"
                        >×</button>
                      </span>
                    )}
                  </div>
                  {editMode && people.length > 0 && (() => {
                    const selCount = people.reduce((n, p) => n + (selected.has(selKey(p.id, layer.id)) ? 1 : 0), 0)
                    const allSelected = selCount === people.length
                    return (
                      <button
                        onClick={e => { e.stopPropagation(); selectAllInLayer(layer.id, people) }}
                        className="sans"
                        title={allSelected ? 'Deselect all' : 'Select all in this layer'}
                        style={{
                          fontSize: 10, fontWeight: 600, letterSpacing: 0.5,
                          padding: '4px 8px', borderRadius: 6,
                          border: `1px solid ${selCount > 0 ? SELECT_OUTLINE : layer.color.label + '40'}`,
                          background: selCount > 0 ? `${SELECT_OUTLINE}22` : 'rgba(255,255,255,0.6)',
                          color: selCount > 0 ? '#7a5a00' : layer.color.label,
                          cursor: 'pointer', whiteSpace: 'nowrap',
                        }}>
                        {selCount > 0 ? `${selCount} SELECTED` : 'SELECT ALL'}
                      </button>
                    )
                  })()}
                </div>

                {/* People cards + placeholder — row lays out in full width; tree scrolls as a whole */}
                <div style={{
                  display: 'flex', flexWrap: 'nowrap', gap: 8,
                  alignItems: 'center',
                  minHeight: BAND_HEIGHT - 56,
                  width: 'max-content',
                  ...(people.length === 0 ? { justifyContent: 'center' } : {}),
                }}>
                  {people.map(person => {
                    const stat = personStats[person.id] || { s: 0, l: 0, p: 0, f: 0, total: 0 }
                    const total = stat.total
                    // Segmented bar proportions
                    const segs: [keyof typeof STAT_STYLES, number][] = [
                      ['s', stat.s], ['l', stat.l], ['p', stat.p], ['f', stat.f],
                    ]
                    const isSelected = selected.has(selKey(person.id, layer.id))
                    const isExcluded = person.isExcluded
                    return (
                      <div
                        key={person.id}
                        title={isExcluded
                          ? `${person.name} — hidden from ${layer.name}. Click to select, then "Restore" to bring back.`
                          : `${person.name} — ${total} shepherded · ${stat.s} staff · ${stat.l} leaders · ${stat.p} via groups/teams · ${stat.f} floaters`}
                        onClick={e => {
                          e.stopPropagation()
                          handleCardClick(e, person.id, layer.id, people)
                        }}
                        style={{
                          position: 'relative',
                          width: 210, height: 96,
                          padding: '10px 12px',
                          borderRadius: 12,
                          background: isExcluded ? 'rgba(255,255,255,0.55)' : 'white',
                          border: isSelected
                            ? `2px solid ${SELECT_OUTLINE}`
                            : isExcluded
                              ? `1px dashed ${layer.color.label}55`
                              : `1px solid ${layer.color.label}22`,
                          outline: isSelected ? `1px solid ${SELECT_OUTLINE}` : undefined,
                          outlineOffset: isSelected ? 1 : undefined,
                          boxShadow: isSelected
                            ? `0 0 0 2px ${SELECT_OUTLINE}33, 0 1px 4px rgba(0,0,0,0.06)`
                            : isExcluded
                              ? 'none'
                              : '0 1px 4px rgba(0,0,0,0.06)',
                          opacity: isExcluded ? 0.5 : 1,
                          display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
                          boxSizing: 'border-box',
                          flexShrink: 0,
                          userSelect: 'none',
                          WebkitUserSelect: 'none',
                          cursor: editMode ? 'pointer' : 'default',
                          transition: 'box-shadow 0.15s, border-color 0.15s, opacity 0.15s',
                          margin: isSelected ? -1 : 0,
                        }}
                      >
                        {isExcluded && (
                          <div
                            className="sans"
                            style={{
                              position: 'absolute', top: 6, right: 8,
                              fontSize: 9, fontWeight: 700, letterSpacing: 0.5,
                              color: '#c0392b', textTransform: 'uppercase',
                            }}
                          >
                            hidden
                          </div>
                        )}
                        {/* Name */}
                        <div
                          className="sans"
                          style={{
                            fontSize: 13, fontWeight: 600, color: 'var(--foreground)',
                            lineHeight: 1.2, whiteSpace: 'nowrap',
                            overflow: 'hidden', textOverflow: 'ellipsis',
                            textDecoration: isExcluded ? 'line-through' : 'none',
                            paddingRight: isExcluded ? 46 : 0,
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
      </div>

      {/* ── Floating action bar (edit mode, selection > 0) ── */}
      {editMode && selected.size > 0 && (
        <div
          className="sans"
          style={{
            position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)',
            zIndex: 40,
            background: 'white', borderRadius: 12,
            border: `1px solid ${SELECT_OUTLINE}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.15)',
            padding: '8px 10px',
            display: 'flex', alignItems: 'center', gap: 8,
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 600, color: '#7a5a00', padding: '0 6px' }}>
            {selected.size} selected
            {selectionSummary.excludedCount > 0 && (
              <span style={{ fontWeight: 400, color: 'var(--muted-foreground)', marginLeft: 6 }}>
                ({selectionSummary.activeCount} active, {selectionSummary.excludedCount} hidden)
              </span>
            )}
          </span>
          {selectionSummary.activeCount > 0 && (
            <button
              onClick={() => applyToSelection('remove')}
              style={{
                fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
                border: '1px solid #c0392b44', background: 'white', color: '#c0392b',
                cursor: 'pointer',
              }}>
              Remove {selectionSummary.activeCount > 1 ? `(${selectionSummary.activeCount})` : ''}
            </button>
          )}
          {selectionSummary.excludedCount > 0 && (
            <button
              onClick={() => applyToSelection('restore')}
              style={{
                fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8,
                border: '1px solid #2a6a3a44', background: 'white', color: '#2a6a3a',
                cursor: 'pointer',
              }}>
              Restore {selectionSummary.excludedCount > 1 ? `(${selectionSummary.excludedCount})` : ''}
            </button>
          )}
          <button
            onClick={clearSelection}
            style={{
              fontSize: 12, fontWeight: 500, padding: '6px 10px', borderRadius: 8,
              border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)',
              cursor: 'pointer',
            }}>
            Clear
          </button>
        </div>
      )}

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
            width: 'min(92vw, 520px)', maxHeight: 'min(88vh, 680px)',
            display: 'flex', flexDirection: 'column',
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
              <h3 className="font-serif" style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>
                {mappingDraft
                  ? (mappingDraft.id ? 'Edit Mapping' : 'New Group/Team Mapping')
                  : assignSelectedLayerId ? 'Choose a Reference List' : 'Assign Sources to Layers'}
              </h3>
              <button onClick={() => { setAssignModalOpen(false); setAssignSelectedLayerId(null); setMappingDraft(null) }}
                style={{ fontSize: 18, lineHeight: 1, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
            </div>

            {/* Tab bar (hidden when editing a mapping draft or in list-picker step) */}
            {!mappingDraft && !assignSelectedLayerId && (
              <div style={{ display: 'flex', padding: '6px 20px 0', borderBottom: '1px solid var(--border)', gap: 4, flexShrink: 0 }}>
                {([['lists', 'Reference Lists'], ['mappings', 'Groups & Teams']] as const).map(([k, label]) => (
                  <button
                    key={k}
                    onClick={() => setAssignTab(k)}
                    className="sans"
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '8px 12px',
                      borderRadius: '6px 6px 0 0',
                      border: 'none',
                      borderBottom: assignTab === k ? '2px solid var(--primary)' : '2px solid transparent',
                      background: 'none',
                      color: assignTab === k ? 'var(--primary)' : 'var(--muted-foreground)',
                      cursor: 'pointer',
                    }}>
                    {label}
                  </button>
                ))}
              </div>
            )}

            <div style={{ overflowY: 'auto', padding: '12px 20px', flex: 1 }}>
              {mappingDraft ? (
                /* ── Mapping editor ───────────────────────────────── */
                <MappingEditor
                  draft={mappingDraft}
                  setDraft={setMappingDraft}
                  layers={layers}
                  groupsList={groupsList}
                  teamsList={teamsList}
                />
              ) : assignTab === 'mappings' ? (
                /* ── Mappings tab: list existing + new button ─────── */
                <>
                  <p className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', margin: '0 0 12px' }}>
                    Map a curated set of PCO Groups or Teams onto two layers: one for leaders, one for members.
                    You can have multiple mappings (e.g. A TEAM vs B TEAM) pointing to different layers.
                  </p>
                  {gtMappings.length === 0 ? (
                    <p className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: '12px 0' }}>
                      No mappings yet. Click "New mapping" below to create one.
                    </p>
                  ) : (
                    gtMappings.map(m => {
                      const leaderLayer = layers.find(l => l.id === m.leaderLayerId)
                      const memberLayer = layers.find(l => l.id === m.memberLayerId)
                      return (
                        <div key={m.id} style={{
                          display: 'flex', alignItems: 'center', gap: 8,
                          padding: '10px 12px', margin: '0 0 4px', borderRadius: 8,
                          border: '1px solid var(--border)', background: 'white',
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div className="sans" style={{ fontSize: 13, fontWeight: 600, color: 'var(--foreground)' }}>
                              {m.name}
                            </div>
                            <div className="sans" style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 3 }}>
                              {m.kind === 'groups' ? 'Groups' : 'Teams'} · {m.itemIds.length} selected
                              {leaderLayer && <>  ·  leaders → <b style={{ color: leaderLayer.color.label }}>{leaderLayer.name}</b></>}
                              {memberLayer && <>  ·  members → <b style={{ color: memberLayer.color.label }}>{memberLayer.name}</b></>}
                            </div>
                          </div>
                          <button
                            onClick={() => setMappingDraft({
                              id: m.id, name: m.name, kind: m.kind,
                              leaderLayerId: m.leaderLayerId, memberLayerId: m.memberLayerId,
                              itemIds: new Set(m.itemIds), search: '',
                            })}
                            className="sans"
                            style={{ fontSize: 11, fontWeight: 500, padding: '5px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'white', color: 'var(--foreground)', cursor: 'pointer' }}>
                            Edit
                          </button>
                          <button
                            onClick={() => deleteMapping(m.id)}
                            disabled={assignBusy}
                            className="sans"
                            style={{ fontSize: 11, fontWeight: 500, padding: '5px 8px', borderRadius: 6, border: '1px solid #c0392b33', background: 'white', color: '#c0392b', cursor: 'pointer' }}
                            title="Delete">
                            ×
                          </button>
                        </div>
                      )
                    })
                  )}
                  <button
                    onClick={() => setMappingDraft({
                      name: '', kind: 'groups',
                      leaderLayerId: null, memberLayerId: null,
                      itemIds: new Set(), search: '',
                    })}
                    className="sans"
                    style={{
                      marginTop: 12, width: '100%',
                      padding: '10px', borderRadius: 8,
                      border: '1px dashed var(--border)', background: 'white',
                      color: 'var(--primary)', fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                    + New mapping
                  </button>
                </>
              ) : !assignSelectedLayerId ? (
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
            <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', background: 'var(--muted)', flexShrink: 0, display: 'flex', justifyContent: 'flex-end', gap: 8, borderRadius: '0 0 16px 16px' }}>
              {mappingDraft && (
                <>
                  <button
                    onClick={() => setMappingDraft(null)}
                    className="sans"
                    style={{ fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
                    Back
                  </button>
                  <button
                    onClick={saveMappingDraft}
                    disabled={assignBusy
                      || !mappingDraft.name.trim()
                      || (!mappingDraft.leaderLayerId && !mappingDraft.memberLayerId)
                      || mappingDraft.itemIds.size === 0}
                    className="sans"
                    style={{
                      fontSize: 12, fontWeight: 600, padding: '7px 14px', borderRadius: 8,
                      border: 'none', background: 'var(--primary)', color: 'white',
                      cursor: 'pointer',
                      opacity: assignBusy ? 0.6 : 1,
                    }}>
                    {assignBusy ? 'Saving...' : 'Save mapping'}
                  </button>
                </>
              )}
              {!mappingDraft && (
              <button onClick={() => { setAssignModalOpen(false); setAssignSelectedLayerId(null) }}
                className="sans"
                style={{ fontSize: 12, fontWeight: 500, padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
                Close
              </button>
              )}
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

// ── Group/Team Mapping editor sub-component ─────────────────────
interface MappingDraft {
  id?: string
  name: string
  kind: 'groups' | 'teams'
  leaderLayerId: string | null
  memberLayerId: string | null
  itemIds: Set<string>
  search: string
}

function MappingEditor({
  draft, setDraft, layers, groupsList, teamsList,
}: {
  draft: MappingDraft
  setDraft: (d: MappingDraft | null) => void
  layers: LayerItem[]
  groupsList: GroupLite[]
  teamsList: TeamLite[]
}) {
  const update = (patch: Partial<MappingDraft>) => setDraft({ ...draft, ...patch })

  // Source items for the current kind, optionally filtered by search
  const items = (draft.kind === 'groups' ? groupsList : teamsList) as (GroupLite | TeamLite)[]
  const typeKey = (it: GroupLite | TeamLite) =>
    (it as GroupLite).groupTypeName ?? (it as TeamLite).serviceTypeName ?? 'Other'

  const q = draft.search.trim().toLowerCase()
  const filtered = items.filter(it => {
    if (!q) return true
    return it.name.toLowerCase().includes(q) || (typeKey(it) || '').toLowerCase().includes(q)
  })
  // Group by type for readability
  const byType = new Map<string, typeof filtered>()
  for (const it of filtered) {
    const k = typeKey(it) || 'Other'
    if (!byType.has(k)) byType.set(k, [])
    byType.get(k)!.push(it)
  }
  const sortedTypes = [...byType.keys()].sort()

  const toggleItem = (id: string) => {
    const next = new Set(draft.itemIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    update({ itemIds: next })
  }

  const selectAllFiltered = () => {
    const next = new Set(draft.itemIds)
    for (const it of filtered) next.add(it.id)
    update({ itemIds: next })
  }
  const clearSelection = () => update({ itemIds: new Set() })

  return (
    <div>
      {/* Name */}
      <label className="sans" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 4 }}>
        Mapping name
      </label>
      <input
        type="text"
        value={draft.name}
        onChange={e => update({ name: e.target.value })}
        placeholder="e.g. Worship A TEAM"
        className="sans"
        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, marginBottom: 14, boxSizing: 'border-box' }}
      />

      {/* Kind toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['groups', 'teams'] as const).map(k => (
          <button
            key={k}
            onClick={() => update({ kind: k, itemIds: new Set() })}
            className="sans"
            style={{
              flex: 1, fontSize: 12, fontWeight: 600, padding: '8px 10px', borderRadius: 8,
              border: draft.kind === k ? '2px solid var(--primary)' : '1px solid var(--border)',
              background: draft.kind === k ? 'rgba(45, 96, 71, 0.06)' : 'white',
              color: draft.kind === k ? 'var(--primary)' : 'var(--foreground)',
              cursor: 'pointer',
            }}>
            PCO {k === 'groups' ? 'Groups' : 'Teams'}
          </button>
        ))}
      </div>

      {/* Layer pickers */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <LayerSelect
          label="Leaders layer"
          helper={`Leaders of selected ${draft.kind}`}
          value={draft.leaderLayerId}
          onChange={v => update({ leaderLayerId: v })}
          layers={layers}
        />
        <LayerSelect
          label="Members layer"
          helper={`Members of selected ${draft.kind}`}
          value={draft.memberLayerId}
          onChange={v => update({ memberLayerId: v })}
          layers={layers}
        />
      </div>

      {/* Item picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label className="sans" style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)' }}>
          {draft.kind === 'groups' ? 'Groups' : 'Teams'} to include
          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--muted-foreground)' }}>({draft.itemIds.size} selected)</span>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={selectAllFiltered} className="sans" style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'white', color: 'var(--foreground)', cursor: 'pointer' }}>
            Select all{q ? ' (filtered)' : ''}
          </button>
          <button onClick={clearSelection} className="sans" style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      </div>
      <input
        type="text"
        value={draft.search}
        onChange={e => update({ search: e.target.value })}
        placeholder={`Search ${draft.kind}…`}
        className="sans"
        style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
      />
      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {items.length === 0 ? (
          <p className="sans" style={{ padding: 12, fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
            No {draft.kind} found. Sync PCO first.
          </p>
        ) : filtered.length === 0 ? (
          <p className="sans" style={{ padding: 12, fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
            No matches.
          </p>
        ) : (
          sortedTypes.map(type => (
            <div key={type}>
              <div className="sans" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--muted-foreground)', padding: '8px 10px 4px', background: 'rgba(0,0,0,0.02)', textTransform: 'uppercase' }}>
                {type}
              </div>
              {byType.get(type)!.map(it => {
                const selected = draft.itemIds.has(it.id)
                return (
                  <label
                    key={it.id}
                    className="sans"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', fontSize: 12,
                      borderTop: '1px solid rgba(0,0,0,0.04)',
                      cursor: 'pointer',
                      background: selected ? 'rgba(45, 96, 71, 0.06)' : 'white',
                    }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleItem(it.id)}
                      style={{ margin: 0 }}
                    />
                    <span style={{ flex: 1, fontWeight: selected ? 600 : 400, color: 'var(--foreground)' }}>
                      {it.name}
                    </span>
                  </label>
                )
              })}
            </div>
          ))
        )}
      </div>
    </div>
  )
}

function LayerSelect({ label, helper, value, onChange, layers }: {
  label: string
  helper: string
  value: string | null
  onChange: (v: string | null) => void
  layers: LayerItem[]
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label className="sans" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 4 }}>
        {label}
      </label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        className="sans"
        style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'white', color: 'var(--foreground)' }}
      >
        <option value="">— none —</option>
        {layers.map(l => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <div className="sans" style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 3 }}>{helper}</div>
    </div>
  )
}
