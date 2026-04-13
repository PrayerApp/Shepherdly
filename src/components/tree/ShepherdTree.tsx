'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

interface TreeNode {
  id: string
  personId?: string
  name: string
  role: 'shepherd' | 'member'
  supervisorId: string | null
  flockCount: number
  lastCheckin: string | null
  isCurrentUser: boolean
  isStaff?: boolean
  isLeadPastor?: boolean
  contextLabel: string | null
  warning: string | null
  groupTypeId?: string | null
  serviceTypeId?: string | null
  layerId?: string | null
  layerCategory?: string | null
  isPlaceholder?: boolean
  isBridge?: boolean
  placeholderSupervisorPersonId?: string | null
}

interface LayoutNode extends TreeNode {
  x: number
  y: number
  children: LayoutNode[]
  depth: number
}

const NODE_W = 220
const NODE_H = 72
const H_GAP = 40
const V_GAP = 100
const CO_LEADER_GAP = 12

interface CoLeaderLink { from: string; to: string }
interface GroupTypeOption { id: string; name: string; is_tracked: boolean }
interface ServiceTypeOption { id: string; name: string }
interface LayerOption { id: string; name: string; category: string; rank: number }
interface AssignmentInfo { layerId: string; layerName: string; layerCategory: string; layerRank: number; supervisorPersonId: string | null; sortOrder: number }
interface OversightEntry { contextType: string; contextId: string; typeName: string }
interface PcoListOption { id: string; name: string; totalPeople: number }
interface ListLayerLink { listId: string; layerId: string }
interface DepartmentOption { id: string; name: string; color: string }
interface DepartmentMember { department_id: string; person_id: string }

function buildTree(nodes: TreeNode[]): LayoutNode[] {
  const map = new Map<string, LayoutNode>()
  for (const n of nodes) {
    map.set(n.id, { ...n, x: 0, y: 0, children: [], depth: 0 })
  }

  const roots: LayoutNode[] = []
  for (const n of map.values()) {
    if (n.supervisorId && map.has(n.supervisorId)) {
      map.get(n.supervisorId)!.children.push(n)
    } else {
      roots.push(n)
    }
  }

  function measureWidth(node: LayoutNode): number {
    if (!node.children.length) return NODE_W
    const childWidths = node.children.map(measureWidth)
    const total = childWidths.reduce((a, b) => a + b, 0) + H_GAP * (node.children.length - 1)
    return Math.max(NODE_W, total)
  }

  function layout(node: LayoutNode, x: number, y: number, depth: number) {
    node.x = x
    node.y = y
    node.depth = depth
    if (!node.children.length) return
    const totalW = node.children.map(measureWidth).reduce((a, b) => a + b, 0) + H_GAP * (node.children.length - 1)
    let cx = x - totalW / 2
    for (const child of node.children) {
      const cw = measureWidth(child)
      layout(child, cx + cw / 2, y + NODE_H + V_GAP, depth + 1)
      cx += cw + H_GAP
    }
  }

  let rx = 0
  for (const root of roots) {
    const w = measureWidth(root)
    layout(root, rx + w / 2, 0, 0)
    rx += w + H_GAP * 2
  }

  return [...map.values()]
}

function applyCoLeaderLayout(
  nodes: LayoutNode[],
  coLeaderLinks: CoLeaderLink[],
): Map<string, { mx: number; my: number }> {
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  const midpoints = new Map<string, { mx: number; my: number }>()

  for (const link of coLeaderLinks) {
    const fromNode = nodeMap.get(link.from)
    const toNode = nodeMap.get(link.to)
    if (!fromNode || !toNode) continue

    const currentGap = toNode.x - fromNode.x
    const desiredGap = NODE_W + CO_LEADER_GAP
    if (Math.abs(currentGap) <= desiredGap) {
      const mx = (fromNode.x + toNode.x) / 2
      const my = fromNode.y + NODE_H
      midpoints.set(link.from, { mx, my })
      continue
    }

    const shift = (Math.abs(currentGap) - desiredGap) / 2
    const sign = currentGap > 0 ? 1 : -1

    const getDescendants = (node: LayoutNode): LayoutNode[] => {
      const result: LayoutNode[] = []
      const stack = [...node.children]
      while (stack.length) {
        const n = stack.pop()!
        result.push(n)
        stack.push(...n.children)
      }
      return result
    }

    const fromDescendants = getDescendants(fromNode)
    fromNode.x += shift * sign
    for (const d of fromDescendants) d.x += shift * sign

    const toDescendants = getDescendants(toNode)
    toNode.x -= shift * sign
    for (const d of toDescendants) d.x -= shift * sign

    const mx = (fromNode.x + toNode.x) / 2
    const my = fromNode.y + NODE_H
    midpoints.set(link.from, { mx, my })
  }

  return midpoints
}

function getAllEdges(nodes: LayoutNode[]): { from: LayoutNode; to: LayoutNode }[] {
  const map = new Map(nodes.map(n => [n.id, n]))
  const edges: { from: LayoutNode; to: LayoutNode }[] = []
  for (const n of nodes) {
    if (n.supervisorId && map.has(n.supervisorId)) {
      edges.push({ from: map.get(n.supervisorId)!, to: n })
    }
  }
  return edges
}

function healthColor(node: TreeNode): string {
  if (node.flockCount === 0) return '#94a3b8'
  if (!node.lastCheckin) return '#9b3a3a'
  const daysSince = Math.floor((Date.now() - new Date(node.lastCheckin).getTime()) / 86400000)
  if (daysSince <= 7) return '#4a7c59'
  if (daysSince <= 30) return '#c17f3e'
  return '#9b3a3a'
}

function checkinLabel(node: TreeNode): string {
  if (!node.lastCheckin) return 'No check-ins'
  const daysSince = Math.floor((Date.now() - new Date(node.lastCheckin).getTime()) / 86400000)
  if (daysSince === 0) return 'Today'
  if (daysSince === 1) return '1 day ago'
  return `${daysSince}d ago`
}

/* ── Drag handle icon (6 dots) ──────────────────────────────── */
function GripIcon({ color }: { color: string }) {
  return (
    <svg width="10" height="16" viewBox="0 0 10 16" fill={color} className="shrink-0 opacity-40 group-hover:opacity-80 cursor-grab active:cursor-grabbing">
      <circle cx="2.5" cy="2" r="1.5"/><circle cx="7.5" cy="2" r="1.5"/>
      <circle cx="2.5" cy="6" r="1.5"/><circle cx="7.5" cy="6" r="1.5"/>
      <circle cx="2.5" cy="10" r="1.5"/><circle cx="7.5" cy="10" r="1.5"/>
      <circle cx="2.5" cy="14" r="1.5"/><circle cx="7.5" cy="14" r="1.5"/>
    </svg>
  )
}

/* ── Department Modal (create/edit with tag-picker) ────────── */
function DepartmentModal({
  departments, departmentMembers, allStaffPeople,
  onClose, onChange,
}: {
  departments: DepartmentOption[]; departmentMembers: DepartmentMember[]
  allStaffPeople: { id: string; name: string }[]
  onClose: () => void; onChange: () => void
}) {
  const [selectedDeptId, setSelectedDeptId] = useState<string | null>(departments[0]?.id || null)
  const [newDeptName, setNewDeptName] = useState('')
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [showDropdown, setShowDropdown] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  // Local members state for the selected department
  const [localMembers, setLocalMembers] = useState<Set<string>>(() => {
    if (!departments[0]) return new Set()
    return new Set(departmentMembers.filter(dm => dm.department_id === departments[0].id).map(dm => dm.person_id))
  })
  const [membersDirty, setMembersDirty] = useState(false)

  const selectDept = (deptId: string) => {
    setSelectedDeptId(deptId)
    setLocalMembers(new Set(departmentMembers.filter(dm => dm.department_id === deptId).map(dm => dm.person_id)))
    setMembersDirty(false)
    setSearch('')
  }

  const createDept = async () => {
    if (!newDeptName.trim() || saving) return
    setSaving(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'add_department', name: newDeptName.trim() }),
      })
      const data = await res.json()
      setNewDeptName('')
      onChange()
      if (data.department) {
        setSelectedDeptId(data.department.id)
        setLocalMembers(new Set())
        setMembersDirty(false)
      }
    } finally { setSaving(false) }
  }

  const removeDept = async (deptId: string) => {
    if (!confirm('Remove this department? Oversight entries using it will also be removed.')) return
    setSaving(true)
    try {
      await fetch('/api/tree', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'remove_department', department_id: deptId }),
      })
      if (selectedDeptId === deptId) setSelectedDeptId(null)
      onChange()
    } finally { setSaving(false) }
  }

  const saveMembers = async () => {
    if (!selectedDeptId || saving) return
    setSaving(true)
    try {
      await fetch('/api/tree', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'set_department_members', department_id: selectedDeptId, person_ids: [...localMembers] }),
      })
      setMembersDirty(false)
      onChange()
    } finally { setSaving(false) }
  }

  const addMember = (personId: string) => {
    setLocalMembers(prev => new Set([...prev, personId]))
    setMembersDirty(true)
    setSearch('')
    setShowDropdown(false)
    inputRef.current?.focus()
  }

  const removeMember = (personId: string) => {
    setLocalMembers(prev => { const s = new Set(prev); s.delete(personId); return s })
    setMembersDirty(true)
  }

  const personNameMap = new Map(allStaffPeople.map(p => [p.id, p.name]))
  const memberList = [...localMembers].map(id => ({ id, name: personNameMap.get(id) || 'Unknown' })).sort((a, b) => a.name.localeCompare(b.name))
  const filtered = search.length >= 1
    ? allStaffPeople.filter(p => !localMembers.has(p.id) && p.name.toLowerCase().includes(search.toLowerCase())).slice(0, 8)
    : []

  return (
    <div className="absolute inset-0 flex items-center justify-center z-[60]" style={{ background: 'rgba(0,0,0,0.35)' }}>
      <div className="bg-white rounded-2xl shadow-xl border" style={{ borderColor: 'var(--border)', width: 'min(90vw, 800px)', height: 'min(80vh, 600px)', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-serif text-sm" style={{ color: 'var(--primary)' }}>Staff Teams / Departments</h3>
          <button onClick={onClose} className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Left: department list */}
          <div className="w-[220px] border-r overflow-y-auto py-3 shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}>
            <div className="px-3 mb-2">
              <div className="text-[10px] sans font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>Teams</div>
            </div>
            {departments.map(dept => {
              const memberCount = departmentMembers.filter(dm => dm.department_id === dept.id).length
              return (
                <button key={dept.id} onClick={() => selectDept(dept.id)}
                  className="w-full text-left px-4 py-2.5 text-sm sans flex items-center justify-between group"
                  style={{ background: selectedDeptId === dept.id ? 'white' : 'transparent', color: selectedDeptId === dept.id ? '#c17f3e' : 'var(--foreground)', fontWeight: selectedDeptId === dept.id ? 600 : 400 }}>
                  <span className="truncate flex-1">{dept.name}</span>
                  <span className="text-[10px] sans mr-1" style={{ color: 'var(--muted-foreground)' }}>{memberCount}</span>
                  <span className="text-xs opacity-0 group-hover:opacity-100" style={{ color: 'var(--danger, #9b3a3a)' }}
                    onClick={(e) => { e.stopPropagation(); removeDept(dept.id) }}>×</span>
                </button>
              )
            })}
            <div className="px-3 pt-3">
              <div className="flex gap-1.5">
                <input type="text" placeholder="New team name…" value={newDeptName}
                  onChange={e => setNewDeptName(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && createDept()}
                  className="flex-1 px-2.5 py-1.5 rounded-lg border text-xs sans min-w-0"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }} />
                <button onClick={createDept} disabled={saving || !newDeptName.trim()}
                  className="px-2.5 py-1.5 rounded-lg text-xs sans font-medium disabled:opacity-50 shrink-0"
                  style={{ background: '#c17f3e', color: 'white' }}>+</button>
              </div>
            </div>
          </div>

          {/* Right: tag-picker for members */}
          <div className="flex-1 overflow-y-auto p-6">
            {!selectedDeptId ? (
              <div className="text-sm sans text-center py-16" style={{ color: 'var(--muted-foreground)' }}>
                Select or create a team to manage members.
              </div>
            ) : (
              <>
                <div className="text-[11px] sans font-semibold uppercase tracking-wide mb-3" style={{ color: '#c17f3e' }}>
                  Members — {departments.find(d => d.id === selectedDeptId)?.name}
                </div>

                {/* Tag chips */}
                <div className="flex flex-wrap gap-2 mb-4 min-h-[32px]">
                  {memberList.map(m => (
                    <span key={m.id} className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs sans font-medium"
                      style={{ background: '#c17f3e15', color: '#c17f3e' }}>
                      {m.name}
                      <button onClick={() => removeMember(m.id)} className="text-sm leading-none hover:opacity-70">×</button>
                    </span>
                  ))}
                  {memberList.length === 0 && (
                    <span className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>No members yet — type a name to add.</span>
                  )}
                </div>

                {/* Search input */}
                <div className="relative">
                  <input ref={inputRef} type="text" placeholder="Type a name to add…" value={search}
                    onChange={e => { setSearch(e.target.value); setShowDropdown(true) }}
                    onFocus={() => search.length >= 1 && setShowDropdown(true)}
                    onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                    className="w-full px-4 py-2.5 rounded-lg border text-sm sans"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }} />

                  {showDropdown && filtered.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg z-10 max-h-56 overflow-y-auto"
                      style={{ borderColor: 'var(--border)' }}>
                      {filtered.map(p => (
                        <button key={p.id} onMouseDown={() => addMember(p.id)}
                          className="w-full text-left px-4 py-2.5 text-sm sans hover:bg-gray-50"
                          style={{ color: 'var(--foreground)' }}>
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                  {showDropdown && search.length >= 1 && filtered.length === 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white border rounded-xl shadow-lg z-10 px-4 py-3"
                      style={{ borderColor: 'var(--border)' }}>
                      <span className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>No matching staff found</span>
                    </div>
                  )}
                </div>

                {/* Save */}
                {membersDirty && (
                  <button onClick={saveMembers} disabled={saving}
                    className="mt-4 w-full px-4 py-2.5 rounded-lg text-sm sans font-medium disabled:opacity-50"
                    style={{ background: '#c17f3e', color: 'white' }}>
                    {saving ? 'Saving…' : 'Save Members'}
                  </button>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ── Manage Layers Modal ───────────────────────────────────── */
function ManageLayersModal({
  elderLayers, staffLayers, volunteerLayers, pcoLists, listLayerLinks, layers,
  newLayerName, setNewLayerName, newLayerCategory, setNewLayerCategory,
  saving, addLayer, removeLayer, onClose, onConfirm,
}: {
  elderLayers: LayerOption[]; staffLayers: LayerOption[]; volunteerLayers: LayerOption[]
  pcoLists: PcoListOption[]; listLayerLinks: ListLayerLink[]; layers: LayerOption[]
  newLayerName: string; setNewLayerName: (v: string) => void
  newLayerCategory: 'staff' | 'volunteer'; setNewLayerCategory: (v: 'staff' | 'volunteer') => void
  saving: boolean; addLayer: () => void; removeLayer: (id: string) => void
  onClose: () => void; onConfirm: () => void
}) {
  // Local state for drag-reorder (changes only apply on confirm)
  const [localStaffLayers, setLocalStaffLayers] = useState(staffLayers)
  const [localVolunteerLayers, setLocalVolunteerLayers] = useState(volunteerLayers)
  const [localLinks, setLocalLinks] = useState<Record<string, string>>(
    () => Object.fromEntries(listLayerLinks.map(ll => [ll.listId, ll.layerId]))
  )
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const dragItem = useRef<{ category: 'staff' | 'volunteer'; index: number } | null>(null)
  const dragOverItem = useRef<{ category: 'staff' | 'volunteer'; index: number } | null>(null)

  const handleDragStart = (category: 'staff' | 'volunteer', index: number) => {
    dragItem.current = { category, index }
  }

  const handleDragEnter = (category: 'staff' | 'volunteer', index: number) => {
    dragOverItem.current = { category, index }
  }

  const handleDragEnd = () => {
    if (!dragItem.current || !dragOverItem.current) return
    if (dragItem.current.category !== dragOverItem.current.category) return

    const cat = dragItem.current.category
    const setter = cat === 'staff' ? setLocalStaffLayers : setLocalVolunteerLayers
    const source = cat === 'staff' ? [...localStaffLayers] : [...localVolunteerLayers]

    const [removed] = source.splice(dragItem.current.index, 1)
    source.splice(dragOverItem.current.index, 0, removed)
    setter(source)
    setDirty(true)
    dragItem.current = null
    dragOverItem.current = null
  }

  const handleLinkChange = (listId: string, layerId: string) => {
    setLocalLinks(prev => {
      const next = { ...prev }
      if (layerId === '') { delete next[listId] } else { next[listId] = layerId }
      return next
    })
    setDirty(true)
  }

  const handleConfirm = async () => {
    setConfirming(true)
    try {
      // 1. Save layer order for staff
      if (localStaffLayers.length > 1) {
        const order = localStaffLayers.map((l, i) => ({ layer_id: l.id, rank: 100 + i }))
        await fetch('/api/tree', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reorder_layers', order }),
        })
      }
      // 2. Save layer order for volunteer
      if (localVolunteerLayers.length > 1) {
        const order = localVolunteerLayers.map((l, i) => ({ layer_id: l.id, rank: 200 + i }))
        await fetch('/api/tree', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reorder_layers', order }),
        })
      }
      // 3. Save list→layer links (diff against original)
      const origLinks: Record<string, string> = Object.fromEntries(listLayerLinks.map(ll => [ll.listId, ll.layerId]))
      for (const list of pcoLists) {
        const newLayerId = localLinks[list.id]
        const oldLayerId = origLinks[list.id]
        if (newLayerId && newLayerId !== oldLayerId) {
          await fetch('/api/tree', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'link_list', list_id: list.id, layer_id: newLayerId }),
          })
        } else if (!newLayerId && oldLayerId) {
          await fetch('/api/tree', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'unlink_list', list_id: list.id }),
          })
        }
      }
      // 4. Reload tree
      await onConfirm()
      setDirty(false)
    } finally {
      setConfirming(false)
    }
  }

  const renderLayerList = (categoryLayers: LayerOption[], setter: (v: LayerOption[]) => void, cat: 'staff' | 'volunteer', color: string, canReorder: boolean, canRemove: boolean) => (
    categoryLayers.map((l, i) => (
      <div key={l.id}
        className="group flex items-center gap-2 px-3 py-2 rounded-lg mb-1"
        style={{ background: color + '08' }}
        draggable={canReorder && categoryLayers.length > 1}
        onDragStart={() => handleDragStart(cat, i)}
        onDragEnter={() => handleDragEnter(cat, i)}
        onDragEnd={handleDragEnd}
        onDragOver={(e) => e.preventDefault()}
      >
        {canReorder && categoryLayers.length > 1 && <GripIcon color={color} />}
        <span className="text-xs sans font-medium flex-1" style={{ color }}>{l.name}</span>
        {canRemove && categoryLayers.length > 1 && (
          <button onClick={() => removeLayer(l.id)}
            className="text-[9px] sans ml-1 opacity-0 group-hover:opacity-100 transition-opacity" style={{ color: 'var(--danger, #9b3a3a)' }}>×</button>
        )}
      </div>
    ))
  )

  return (
    <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.3)' }}>
      <div className="w-[420px] bg-white rounded-2xl shadow-xl border" style={{ borderColor: 'var(--border)', maxHeight: 'min(85vh, 700px)', display: 'flex', flexDirection: 'column' }}>
        <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
          <h3 className="font-serif text-sm" style={{ color: 'var(--primary)' }}>Manage Layers</h3>
          <button onClick={onClose}
            className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
        </div>

        <div className="overflow-y-auto px-5 py-4 flex-1">
          <p className="text-xs sans mb-4" style={{ color: 'var(--muted-foreground)' }}>
            Drag to reorder sub-layers. Link PCO reference lists to layers. Changes apply when you confirm.
          </p>

          {/* Elder */}
          <div className="mb-3">
            <div className="text-[10px] sans font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#7c3aed' }}>Elder</div>
            {elderLayers.map(l => (
              <div key={l.id} className="flex items-center gap-2 px-3 py-2 rounded-lg mb-1" style={{ background: '#7c3aed08' }}>
                <span className="text-xs sans font-medium flex-1" style={{ color: '#7c3aed' }}>{l.name}</span>
              </div>
            ))}
          </div>

          {/* Staff */}
          <div className="mb-3">
            <div className="text-[10px] sans font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#3b6ea5' }}>Staff</div>
            {renderLayerList(localStaffLayers, setLocalStaffLayers, 'staff', '#3b6ea5', true, true)}
          </div>

          {/* Volunteer */}
          <div className="mb-3">
            <div className="text-[10px] sans font-semibold uppercase tracking-wide mb-1.5" style={{ color: '#4a7c59' }}>Volunteer</div>
            {renderLayerList(localVolunteerLayers, setLocalVolunteerLayers, 'volunteer', '#4a7c59', true, true)}
          </div>

          {/* People (PCO) info */}
          <div className="mb-4">
            <div className="text-[10px] sans font-semibold uppercase tracking-wide mb-1" style={{ color: '#6b7280' }}>People (Automatic)</div>
            <div className="px-3 py-2 rounded-lg" style={{ background: 'var(--muted)' }}>
              <span className="text-[10px] sans" style={{ color: 'var(--muted-foreground)' }}>PCO group/team leaders and members flow in automatically.</span>
            </div>
          </div>

          {/* PCO List → Layer links */}
          {pcoLists.length > 0 && (
            <div className="border-t pt-3 mb-4" style={{ borderColor: 'var(--border)' }}>
              <div className="text-[10px] sans font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted-foreground)' }}>
                PCO Reference Lists
              </div>
              <p className="text-[10px] sans mb-3" style={{ color: 'var(--muted-foreground)' }}>
                Connect a PCO list to a layer. People on that list will appear at that layer.
              </p>
              {pcoLists.map(list => (
                <div key={list.id} className="flex items-center gap-2 mb-2">
                  <span className="text-xs sans flex-1 truncate" style={{ color: 'var(--foreground)' }}>
                    {list.name}
                    <span className="ml-1 text-[10px]" style={{ color: 'var(--muted-foreground)' }}>({list.totalPeople})</span>
                  </span>
                  <select
                    value={localLinks[list.id] || ''}
                    onChange={e => handleLinkChange(list.id, e.target.value)}
                    className="px-2 py-1 rounded-lg border text-xs sans min-w-[120px]"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <option value="">— none —</option>
                    {layers.map(l => (
                      <option key={l.id} value={l.id}>{l.name} ({l.category})</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          )}

          {/* Add sub-layer */}
          <div className="border-t pt-3" style={{ borderColor: 'var(--border)' }}>
            <div className="text-[10px] sans font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted-foreground)' }}>Add Sub-Layer</div>
            <div className="flex items-center gap-2">
              <select value={newLayerCategory} onChange={e => setNewLayerCategory(e.target.value as 'staff' | 'volunteer')}
                className="px-2 py-1.5 rounded-lg border text-xs sans"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                <option value="staff">Staff</option>
                <option value="volunteer">Volunteer</option>
              </select>
              <input type="text" placeholder="Layer name..." value={newLayerName}
                onChange={e => setNewLayerName(e.target.value)}
                className="flex-1 px-2 py-1.5 rounded-lg border text-xs sans"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }} />
              <button onClick={addLayer} disabled={saving || !newLayerName.trim()}
                className="px-3 py-1.5 rounded-lg text-xs sans font-medium disabled:opacity-50"
                style={{ background: 'var(--primary)', color: 'white' }}>
                Add
              </button>
            </div>
          </div>

        </div>

        {/* Confirm / Cancel footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
          <button onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs sans font-medium border"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
            Cancel
          </button>
          <button onClick={handleConfirm} disabled={confirming}
            className="px-4 py-1.5 rounded-lg text-xs sans font-medium disabled:opacity-50"
            style={{ background: dirty ? 'var(--primary)' : 'var(--muted)', color: dirty ? 'white' : 'var(--muted-foreground)' }}>
            {confirming ? 'Saving…' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ShepherdTree() {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<LayoutNode[]>([])
  const [edges, setEdges] = useState<{ from: LayoutNode; to: LayoutNode }[]>([])
  const [coLeaderLinks, setCoLeaderLinks] = useState<CoLeaderLink[]>([])
  const [coLeaderMidpoints, setCoLeaderMidpoints] = useState<Map<string, { mx: number; my: number }>>(new Map())
  const [selected, setSelected] = useState<LayoutNode | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [allNodes, setAllNodes] = useState<TreeNode[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [groupTypes, setGroupTypes] = useState<GroupTypeOption[]>([])
  const [serviceTypes, setServiceTypes] = useState<ServiceTypeOption[]>([])
  const [layers, setLayers] = useState<LayerOption[]>([])
  const [assignmentsMap, setAssignmentsMap] = useState<Record<string, AssignmentInfo>>({})
  const [oversightMap, setOversightMap] = useState<Record<string, OversightEntry[]>>({})

  // PCO Lists
  const [pcoLists, setPcoLists] = useState<PcoListOption[]>([])
  const [listLayerLinks, setListLayerLinks] = useState<ListLayerLink[]>([])

  // Departments
  const [departments, setDepartments] = useState<DepartmentOption[]>([])
  const [departmentMembers, setDepartmentMembers] = useState<DepartmentMember[]>([])

  // Assignment modal
  type AssignModal = {
    personId: string
    personName: string
    layerId: string
    supervisorPersonId: string
    oversightEntries: { context_type: string; context_id: string }[]
    isLeadPastor: boolean
    isEdit: boolean
  }
  const [assignModal, setAssignModal] = useState<AssignModal | null>(null)
  const [assignSearch, setAssignSearch] = useState('')
  const [assignResults, setAssignResults] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)

  // Layer management modal
  const [layerModalOpen, setLayerModalOpen] = useState(false)
  const [deptModalOpen, setDeptModalOpen] = useState(false)
  const [newLayerName, setNewLayerName] = useState('')
  const [newLayerCategory, setNewLayerCategory] = useState<'staff' | 'volunteer'>('staff')

  // Unassigned panel
  const [unconnectedStaff, setUnconnectedStaff] = useState<{ id: string; name: string; layerName: string }[]>([])
  const [unlinkedGroupTypes, setUnlinkedGroupTypes] = useState<{ id: string; name: string }[]>([])
  const [unlinkedServiceTypes, setUnlinkedServiceTypes] = useState<{ id: string; name: string }[]>([])
  const [unconnectedVolunteers, setUnconnectedVolunteers] = useState<{ id: string; name: string; groupTypeId: string | null; serviceTypeId: string | null }[]>([])
  const [unassignedTab, setUnassignedTab] = useState<'staff' | 'types' | 'volunteers'>('types')
  const [volunteerFilter, setVolunteerFilter] = useState<string>('all')
  const [activeParent, setActiveParent] = useState<{ personId: string; nodeId: string; layerId: string } | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(false)

  // Search-to-navigate
  const [treeSearch, setTreeSearch] = useState('')
  const [treeSearchResults, setTreeSearchResults] = useState<LayoutNode[]>([])
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)

  // Filter
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterTab, setFilterTab] = useState<'groups' | 'services'>('groups')
  const [hiddenGroupTypes, setHiddenGroupTypes] = useState<Set<string>>(new Set())
  const [hiddenServiceTypes, setHiddenServiceTypes] = useState<Set<string>>(new Set())
  const [filterLoaded, setFilterLoaded] = useState(false)

  // Pan & zoom
  const [transform, setTransform] = useState({ x: 0, y: 60, scale: 1 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const initialLoadDone = useRef(false)

  const isAdmin = ['super_admin', 'staff'].includes(currentUserRole || '')

  // ── Persistence ──────────────────────────────────────────────
  useEffect(() => {
    try {
      const saved = localStorage.getItem('shepherdly-tree-filter')
      if (saved) {
        const parsed = JSON.parse(saved)
        if (parsed.hiddenGroupTypes) setHiddenGroupTypes(new Set(parsed.hiddenGroupTypes))
        if (parsed.hiddenServiceTypes) setHiddenServiceTypes(new Set(parsed.hiddenServiceTypes))
      }
    } catch { /* ignore */ }
    setFilterLoaded(true)
  }, [])

  useEffect(() => {
    if (!filterLoaded) return
    try {
      localStorage.setItem('shepherdly-tree-filter', JSON.stringify({
        hiddenGroupTypes: [...hiddenGroupTypes],
        hiddenServiceTypes: [...hiddenServiceTypes],
      }))
    } catch { /* ignore */ }
  }, [hiddenGroupTypes, hiddenServiceTypes, filterLoaded])

  const saveDefaultFilter = () => {
    try {
      localStorage.setItem('shepherdly-tree-filter-default', JSON.stringify({
        hiddenGroupTypes: [...hiddenGroupTypes],
        hiddenServiceTypes: [...hiddenServiceTypes],
      }))
    } catch { /* ignore */ }
  }
  const resetToDefault = () => {
    try {
      const saved = localStorage.getItem('shepherdly-tree-filter-default')
      if (saved) {
        const parsed = JSON.parse(saved)
        setHiddenGroupTypes(new Set(parsed.hiddenGroupTypes || []))
        setHiddenServiceTypes(new Set(parsed.hiddenServiceTypes || []))
      } else {
        setHiddenGroupTypes(new Set())
        setHiddenServiceTypes(new Set())
      }
    } catch {
      setHiddenGroupTypes(new Set())
      setHiddenServiceTypes(new Set())
    }
  }
  const hasDefaultFilter = typeof window !== 'undefined' && !!localStorage.getItem('shepherdly-tree-filter-default')

  // ── Search-to-navigate ───────────────────────────────────────
  useEffect(() => {
    if (treeSearch.length < 2) { setTreeSearchResults([]); return }
    const q = treeSearch.toLowerCase()
    const matches = nodes.filter(n => !n.isPlaceholder && !n.isBridge && n.name.toLowerCase().includes(q))
    const seen = new Set<string>()
    const deduped: LayoutNode[] = []
    for (const m of matches) {
      const pid = m.personId || m.id
      if (!seen.has(pid)) { seen.add(pid); deduped.push(m) }
    }
    setTreeSearchResults(deduped.slice(0, 8))
  }, [treeSearch, nodes])

  const navigateToNode = useCallback((node: LayoutNode) => {
    const svgEl = svgRef.current
    if (!svgEl) return
    const svgH = svgEl.clientHeight
    const targetScale = Math.max(transform.scale, 0.7)
    setTransform({
      x: -node.x,
      y: -node.y + svgH / (2 * targetScale),
      scale: targetScale,
    })
    setHighlightedNodeId(node.id)
    setSelected(node)
    setTreeSearch('')
    setTreeSearchResults([])
    setTimeout(() => setHighlightedNodeId(null), 3000)
  }, [transform.scale])

  // ── Filter ───────────────────────────────────────────────────
  // Staff/Elder nodes (isStaff or layerCategory) are immune from filtering
  const filteredNodes = useMemo(() => {
    if (hiddenGroupTypes.size === 0 && hiddenServiceTypes.size === 0) return allNodes
    return allNodes.filter(n => {
      if (n.isStaff) return true
      if (n.layerId) return true // manual hierarchy nodes always visible
      if (n.groupTypeId && hiddenGroupTypes.has(n.groupTypeId)) return false
      if (n.serviceTypeId && hiddenServiceTypes.has(n.serviceTypeId)) return false
      return true
    })
  }, [allNodes, hiddenGroupTypes, hiddenServiceTypes])

  // Rebuild tree when filtered nodes change
  useEffect(() => {
    if (filteredNodes.length === 0) { setNodes([]); setEdges([]); return }
    const laid = buildTree(filteredNodes)
    const midpoints = applyCoLeaderLayout(laid, coLeaderLinks)
    setCoLeaderMidpoints(midpoints)
    setNodes(laid)
    setEdges(getAllEdges(laid))
  }, [filteredNodes, coLeaderLinks])

  // ── Fetch tree ───────────────────────────────────────────────
  const fetchTree = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/tree')
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false); return }

    setAllNodes(data.nodes || [])
    setCoLeaderLinks(data.coLeaderLinks || [])
    setLayers(data.layers || [])
    setAssignmentsMap(data.assignments || {})
    setOversightMap(data.oversightMap || {})
    setCurrentUserRole(data.currentUserRole || null)
    setGroupTypes(data.groupTypes || [])
    setServiceTypes(data.serviceTypes || [])
    setPcoLists(data.pcoLists || [])
    setListLayerLinks(data.listLayerLinks || [])
    setDepartments(data.departments || [])
    setDepartmentMembers(data.departmentMembers || [])
    setUnconnectedStaff(data.unconnectedStaff || [])
    setUnlinkedGroupTypes(data.unlinkedGroupTypes || [])
    setUnlinkedServiceTypes(data.unlinkedServiceTypes || [])
    setUnconnectedVolunteers(data.unconnectedVolunteers || [])

    const laid = buildTree(data.nodes || [])
    const midpoints = applyCoLeaderLayout(laid, data.coLeaderLinks || [])
    setCoLeaderMidpoints(midpoints)
    setNodes(laid)
    setEdges(getAllEdges(laid))

    // Only center tree on initial load — preserve position on subsequent refreshes
    if (laid.length > 0 && !initialLoadDone.current) {
      const minX = Math.min(...laid.map(n => n.x)) - NODE_W / 2
      const maxX = Math.max(...laid.map(n => n.x)) + NODE_W / 2
      const treeW = maxX - minX
      setTransform({ x: -minX - treeW / 2, y: 60, scale: 1 })
      initialLoadDone.current = true
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchTree() }, [fetchTree])

  // People search for assign modal
  useEffect(() => {
    if (assignSearch.length < 2) { setAssignResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/people?search=${encodeURIComponent(assignSearch)}&all=true`)
      const data = await res.json()
      setAssignResults((data.people || []).slice(0, 12).map((p: any) => ({
        id: p.id, name: p.name,
      })))
    }, 300)
    return () => clearTimeout(t)
  }, [assignSearch])

  const realId = (node: TreeNode) => node.personId || node.id

  // ── Actions ──────────────────────────────────────────────────

  const openAssignModal = (personId?: string, personName?: string) => {
    const existing = personId ? assignmentsMap[personId] : null
    const existingOversight = personId ? (oversightMap[personId] || []) : []
    const existingPerson = personId ? allNodes.find(n => n.personId === personId) : null

    setAssignModal({
      personId: personId || '',
      personName: personName || '',
      layerId: existing?.layerId || layers[0]?.id || '',
      supervisorPersonId: existing?.supervisorPersonId || '',
      oversightEntries: existingOversight.map(o => ({ context_type: o.contextType, context_id: o.contextId })),
      isLeadPastor: !!existingPerson?.isLeadPastor,
      isEdit: !!existing,
    })
    setAssignSearch('')
    setAssignResults([])
  }

  const saveAssignment = async () => {
    if (!assignModal || !assignModal.personId || !assignModal.layerId) return
    setSaving(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_assignment',
          person_id: assignModal.personId,
          layer_id: assignModal.layerId,
          supervisor_person_id: assignModal.supervisorPersonId || null,
          oversight: assignModal.oversightEntries,
          is_lead_pastor: assignModal.isLeadPastor,
        }),
      })
      const data = await res.json()
      if (data.error) { alert('Error: ' + data.error); return }
      setAssignModal(null)
      await fetchTree()
    } finally {
      setSaving(false)
    }
  }

  const removeAssignment = async (personId: string, personName: string) => {
    if (!confirm(`Remove ${personName} from the manual hierarchy? They will still appear if they have PCO group/team memberships.`)) return
    await fetch('/api/tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_assignment', person_id: personId }),
    })
    setSelected(null)
    setAssignModal(null)
    await fetchTree()
  }

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
      await fetchTree()
    } finally {
      setSaving(false)
    }
  }

  const removeLayer = async (layerId: string) => {
    if (!confirm('Remove this layer? People assigned to it will be moved to another layer in the same category.')) return
    await fetch('/api/tree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_layer', layer_id: layerId }),
    })
    await fetchTree()
  }

  // ── Zoom helpers ─────────────────────────────────────────────
  const zoomIn = () => setTransform(t => ({ ...t, scale: Math.min(3, t.scale * 1.3) }))
  const zoomOut = () => setTransform(t => ({ ...t, scale: Math.max(0.05, t.scale / 1.3) }))
  const fitAll = useCallback(() => {
    const svgEl = svgRef.current
    if (!svgEl || nodes.length === 0) return
    const svgW = svgEl.clientWidth
    const svgH = svgEl.clientHeight
    const minX = Math.min(...nodes.map(n => n.x)) - NODE_W / 2 - 40
    const maxX = Math.max(...nodes.map(n => n.x)) + NODE_W / 2 + 40
    const minY = Math.min(...nodes.map(n => n.y)) - 40
    const maxY = Math.max(...nodes.map(n => n.y)) + NODE_H + 40
    const treeW = maxX - minX
    const treeH = maxY - minY
    const scale = Math.min(svgW / treeW, svgH / treeH, 1.5)
    setTransform({ x: -minX - treeW / 2, y: -minY + 20 / scale, scale })
  }, [nodes])

  // ── Mouse / touch ────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if ((e.target as Element).closest('.tree-node')) return
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform(t => ({ ...t, x: t.x + dx / t.scale, y: t.y + dy / t.scale }))
  }
  const onMouseUp = () => { dragging.current = false }

  useEffect(() => {
    const el = svgRef.current
    if (!el) return

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.ctrlKey || e.metaKey) {
        const sensitivity = 0.01
        const delta = 1 - e.deltaY * sensitivity
        setTransform(t => ({ ...t, scale: Math.min(3, Math.max(0.05, t.scale * delta)) }))
      } else {
        setTransform(t => ({ ...t, x: t.x - e.deltaX / t.scale, y: t.y - e.deltaY / t.scale }))
      }
    }

    let lastTouchDist = 0
    let lastTouchCenter = { x: 0, y: 0 }
    let touching = false

    const getTouchDist = (touches: TouchList) => {
      if (touches.length < 2) return 0
      const dx = touches[0].clientX - touches[1].clientX
      const dy = touches[0].clientY - touches[1].clientY
      return Math.sqrt(dx * dx + dy * dy)
    }
    const getTouchCenter = (touches: TouchList) => {
      if (touches.length < 2) return { x: touches[0].clientX, y: touches[0].clientY }
      return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 }
    }

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length >= 2) {
        e.preventDefault()
        lastTouchDist = getTouchDist(e.touches)
        lastTouchCenter = getTouchCenter(e.touches)
        touching = true
      } else if (e.touches.length === 1) {
        lastTouchCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        touching = true
      }
    }
    const handleTouchMove = (e: TouchEvent) => {
      if (!touching) return
      e.preventDefault()
      if (e.touches.length >= 2) {
        const dist = getTouchDist(e.touches)
        if (lastTouchDist > 0) {
          const ratio = dist / lastTouchDist
          setTransform(t => ({ ...t, scale: Math.min(3, Math.max(0.05, t.scale * ratio)) }))
        }
        lastTouchDist = dist
        const center = getTouchCenter(e.touches)
        const dx = center.x - lastTouchCenter.x
        const dy = center.y - lastTouchCenter.y
        setTransform(t => ({ ...t, x: t.x + dx / t.scale, y: t.y + dy / t.scale }))
        lastTouchCenter = center
      } else if (e.touches.length === 1) {
        const dx = e.touches[0].clientX - lastTouchCenter.x
        const dy = e.touches[0].clientY - lastTouchCenter.y
        lastTouchCenter = { x: e.touches[0].clientX, y: e.touches[0].clientY }
        setTransform(t => ({ ...t, x: t.x + dx / t.scale, y: t.y + dy / t.scale }))
      }
    }
    const handleTouchEnd = () => { lastTouchDist = 0; touching = false }

    el.addEventListener('wheel', handleWheel, { passive: false })
    el.addEventListener('touchstart', handleTouchStart, { passive: false })
    el.addEventListener('touchmove', handleTouchMove, { passive: false })
    el.addEventListener('touchend', handleTouchEnd)
    return () => {
      el.removeEventListener('wheel', handleWheel)
      el.removeEventListener('touchstart', handleTouchStart)
      el.removeEventListener('touchmove', handleTouchMove)
      el.removeEventListener('touchend', handleTouchEnd)
    }
  }, [])

  // Close dropdowns when clicking outside
  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Element
      if (!target.closest('.filter-dropdown')) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

  // All people on manual layers (for department tagging)
  const allStaffPeople = useMemo(() => {
    const seen = new Set<string>()
    const result: { id: string; name: string }[] = []
    for (const n of allNodes) {
      const pid = n.personId || n.id
      if (!seen.has(pid) && n.layerId) {
        seen.add(pid)
        result.push({ id: pid, name: n.name })
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }, [allNodes])

  // ── Render states ────────────────────────────────────────────

  if (loading) return (
    <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--muted-foreground)' }}>
      <div className="text-center">
        <div className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin mx-auto mb-3"
          style={{ borderColor: 'var(--border)', borderTopColor: 'var(--accent)' }} />
        <p className="sans text-sm">Loading shepherd tree...</p>
      </div>
    </div>
  )

  if (error) return (
    <div className="flex-1 flex items-center justify-center">
      <p className="sans text-sm" style={{ color: 'var(--danger)' }}>{error}</p>
    </div>
  )

  if (nodes.length === 0 && allNodes.length === 0) return (
    <div className="flex-1 flex items-center justify-center text-center px-8">
      <div>
        <p className="font-serif text-2xl mb-2" style={{ color: 'var(--primary)' }}>No tree data yet</p>
        <p className="sans text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
          Sync PCO Reference Lists and connect them to layers to populate the tree. Then use the placeholders to assign who each person oversees.
        </p>
        {isAdmin && (
          <div className="flex items-center justify-center gap-2">
            <button onClick={() => setLayerModalOpen(true)}
              className="text-xs sans px-4 py-2 rounded-lg font-medium border"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
              Manage Layers
            </button>
            <button onClick={() => setDeptModalOpen(true)}
              className="text-xs sans px-4 py-2 rounded-lg font-medium border"
              style={{ borderColor: 'var(--border)', color: '#c17f3e' }}>
              Departments
            </button>
          </div>
        )}
      </div>
    </div>
  )

  const primaryCoLeaderIds = new Set(coLeaderLinks.map(l => l.from))

  // People with manual assignments for supervisor dropdown
  const assignedPeople = Object.entries(assignmentsMap).map(([pid, info]) => {
    const person = allNodes.find(n => n.personId === pid)
    return { id: pid, name: person?.name || 'Unknown', ...info }
  }).sort((a, b) => a.layerName.localeCompare(b.layerName) || a.name.localeCompare(b.name))

  const trackedGroupTypes = groupTypes.filter(gt => gt.is_tracked)
  const trackedServiceTypes = serviceTypes
  const activeFilterCount = hiddenGroupTypes.size + hiddenServiceTypes.size

  // Layer categories for the assign modal
  const elderLayers = layers.filter(l => l.category === 'elder')
  const staffLayers = layers.filter(l => l.category === 'staff')
  const volunteerLayers = layers.filter(l => l.category === 'volunteer')

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: 'var(--border)', background: 'white' }}>
        <div className="shrink-0">
          <h1 className="font-serif text-lg" style={{ color: 'var(--primary)' }}>Shepherd Tree</h1>
          <p className="sans text-[11px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {new Set(nodes.filter(n => n.role === 'shepherd').map(n => n.personId || n.id)).size} shepherds · {nodes.length} nodes · scroll to pan, ctrl+scroll to zoom
          </p>
        </div>
        <div className="flex items-center gap-2">
          {/* Search */}
          <div className="relative">
            <input type="text" placeholder="Find person..." value={treeSearch}
              onChange={e => setTreeSearch(e.target.value)}
              className="w-36 md:w-48 px-3 py-1.5 rounded-lg border text-xs sans"
              style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }} />
            {treeSearchResults.length > 0 && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-lg shadow-xl border z-50 max-h-64 overflow-y-auto"
                style={{ borderColor: 'var(--border)' }}>
                {treeSearchResults.map(n => (
                  <button key={n.id} onClick={() => navigateToNode(n)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors">
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium sans shrink-0"
                      style={{ background: n.role === 'shepherd' ? '#4a7c5918' : '#6b728018', color: n.role === 'shepherd' ? '#4a7c59' : '#6b7280' }}>
                      {n.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs sans font-medium truncate" style={{ color: 'var(--foreground)' }}>{n.name}</div>
                      <div className="text-[10px] sans truncate" style={{ color: 'var(--muted-foreground)' }}>{n.contextLabel || (n.role === 'shepherd' ? 'Shepherd' : 'Member')}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Health legend */}
          <div className="hidden lg:flex items-center gap-2.5 text-[11px] sans mr-1" style={{ color: 'var(--muted-foreground)' }}>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#4a7c59' }} />Healthy</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#c17f3e' }} />Attention</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#9b3a3a' }} />At risk</span>
          </div>

          {isAdmin && (
            <>
              <button onClick={() => setLayerModalOpen(true)}
                className="text-xs sans px-3 py-1.5 rounded-lg font-medium border"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                title="Manage Layers">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline -mt-0.5 mr-1">
                  <circle cx="12" cy="12" r="3"/><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
                </svg>
                Layers
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tree canvas */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden" style={{ background: 'var(--muted)', touchAction: 'none' }}>
        <svg ref={svgRef}
          className="w-full h-full cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.5"/>
            </pattern>
            <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08"/></filter>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          <g transform={`translate(${(svgRef.current?.clientWidth ?? 800) / 2 + transform.x * transform.scale}, ${transform.y}) scale(${transform.scale})`}>
            {/* Edges */}
            {edges.map(({ from, to }) => {
              let fx = from.x, fy = from.y + NODE_H
              if (primaryCoLeaderIds.has(from.id) && coLeaderMidpoints.has(from.id)) {
                const mid = coLeaderMidpoints.get(from.id)!
                fx = mid.mx
                fy = mid.my
              }
              const tx = to.x, ty = to.y
              const my = (fy + ty) / 2
              return (
                <path key={`${from.id}-${to.id}`}
                  d={`M ${fx} ${fy} C ${fx} ${my}, ${tx} ${my}, ${tx} ${ty}`}
                  fill="none" stroke="var(--border)" strokeWidth="1.5" />
              )
            })}

            {/* Co-leader horizontal connectors */}
            {coLeaderLinks.map(link => {
              const nodeMap = new Map(nodes.map(n => [n.id, n]))
              const fromNode = nodeMap.get(link.from)
              const toNode = nodeMap.get(link.to)
              if (!fromNode || !toNode) return null
              const y = fromNode.y + NODE_H / 2
              const x1 = Math.min(fromNode.x, toNode.x) + NODE_W / 2
              const x2 = Math.max(fromNode.x, toNode.x) - NODE_W / 2
              const midX = (fromNode.x + toNode.x) / 2
              const midY = fromNode.y + NODE_H
              return (
                <g key={`co-${link.from}-${link.to}`}>
                  <line x1={x1} y1={y} x2={x2} y2={y}
                    stroke="#4a7c59" strokeWidth="2" strokeDasharray="6 3" />
                  <circle cx={midX} cy={midY} r={5} fill="#4a7c59" opacity="0.7" />
                </g>
              )
            })}

            {/* Nodes */}
            {nodes.map(node => {
              // ── Bridge node (invisible spacer for depth alignment) ──
              if (node.isBridge) {
                return (
                  <g key={node.id} transform={`translate(${node.x - NODE_W / 2}, ${node.y})`}>
                    <rect x={0} y={0} width={NODE_W} height={NODE_H} rx={10}
                      fill="transparent" stroke="var(--border)" strokeWidth="1"
                      strokeDasharray="4 4" opacity="0.3" />
                    <line x1={NODE_W / 2} y1={0} x2={NODE_W / 2} y2={NODE_H}
                      stroke="var(--border)" strokeWidth="1" strokeDasharray="3 3" opacity="0.3" />
                  </g>
                )
              }

              // ── Placeholder node ──
              if (node.isPlaceholder) {
                const phColor = node.layerCategory === 'elder' ? '#7c3aed' : node.layerCategory === 'staff' ? '#3b6ea5' : '#4a7c59'
                return (
                  <g key={node.id} className="tree-node"
                    transform={`translate(${node.x - NODE_W / 2}, ${node.y})`}
                    style={{ cursor: isAdmin ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (!isAdmin) return
                      // Set active parent for bottom panel quick-assign (no modal)
                      setActiveParent({
                        personId: node.placeholderSupervisorPersonId || '',
                        nodeId: node.id,
                        layerId: node.layerId || '',
                      })
                      setPanelCollapsed(false)
                    }}>
                    <rect x={0} y={0} width={NODE_W} height={NODE_H} rx={10}
                      fill="white" stroke={phColor} strokeWidth="1.5"
                      strokeDasharray="6 4" opacity="0.6" />
                    <text x={NODE_W / 2} y={NODE_H / 2 - 6} textAnchor="middle"
                      fontSize={16} fontWeight="300" fontFamily="system-ui" fill={phColor} opacity="0.7">
                      +
                    </text>
                    <text x={NODE_W / 2} y={NODE_H / 2 + 12} textAnchor="middle"
                      fontSize={10} fontFamily="system-ui" fill={phColor} opacity="0.6">
                      Add {node.contextLabel}
                    </text>
                  </g>
                )
              }

              // ── Regular node ──
              const isShepherd = node.role === 'shepherd'
              const isManual = !!node.layerId
              const color = node.warning === 'Unconnected' ? '#9b3a3a' : node.isLeadPastor ? '#7c3aed' : isManual ? '#3b6ea5' : isShepherd ? '#4a7c59' : '#6b7280'
              const health = healthColor(node)
              const isSelected = selected?.id === node.id
              const initials = node.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()

              return (
                <g key={node.id} className="tree-node"
                  transform={`translate(${node.x - NODE_W / 2}, ${node.y})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(isSelected ? null : node)}>
                  <rect x={0} y={0} width={NODE_W} height={NODE_H} rx={10}
                    fill={node.isCurrentUser ? color : 'white'}
                    stroke={highlightedNodeId === node.id ? '#f59e0b' : isSelected ? color : node.isCurrentUser ? color : 'var(--border)'}
                    strokeWidth={highlightedNodeId === node.id ? 3 : isSelected ? 2.5 : 1} filter="url(#shadow)" />
                  {highlightedNodeId === node.id && (
                    <rect x={-3} y={-3} width={NODE_W + 6} height={NODE_H + 6} rx={12}
                      fill="none" stroke="#f59e0b" strokeWidth="2" opacity="0.5">
                      <animate attributeName="opacity" values="0.5;0.1;0.5" dur="1.5s" repeatCount="indefinite" />
                    </rect>
                  )}
                  <rect x={0} y={0} width={4} height={NODE_H} rx={2}
                    fill={color} style={{ clipPath: 'inset(0 0 0 0 round 10px 0 0 10px)' }} />

                  {isShepherd && !node.warning && !isManual && <circle cx={NODE_W - 10} cy={10} r={4} fill={health} />}

                  {/* Badges */}
                  {node.isLeadPastor && (
                    <g transform={`translate(${NODE_W - 82}, ${NODE_H - 16})`}>
                      <rect x={0} y={0} width={74} height={14} rx={3} fill="#7c3aed" opacity="0.85" />
                      <text x={37} y={10} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="system-ui" fill="white">LEAD PASTOR</text>
                    </g>
                  )}
                  {!node.isLeadPastor && isManual && node.layerCategory === 'elder' && (
                    <g transform={`translate(${NODE_W - 48}, ${NODE_H - 16})`}>
                      <rect x={0} y={0} width={40} height={14} rx={3} fill="#7c3aed" opacity="0.7" />
                      <text x={20} y={10} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="system-ui" fill="white">ELDER</text>
                    </g>
                  )}
                  {isManual && node.layerCategory === 'staff' && (
                    <g transform={`translate(${NODE_W - 44}, ${NODE_H - 16})`}>
                      <rect x={0} y={0} width={36} height={14} rx={3} fill="#3b6ea5" opacity="0.85" />
                      <text x={18} y={10} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="system-ui" fill="white">STAFF</text>
                    </g>
                  )}
                  {!isManual && node.isStaff && (
                    <g transform={`translate(${NODE_W - 44}, ${NODE_H - 16})`}>
                      <rect x={0} y={0} width={36} height={14} rx={3} fill="#3b6ea5" opacity="0.85" />
                      <text x={18} y={10} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="system-ui" fill="white">STAFF</text>
                    </g>
                  )}

                  {node.warning && (
                    <g transform={`translate(${NODE_W - 16}, 4)`}>
                      <polygon points="6,0 12,11 0,11" fill={node.warning === 'Unconnected' ? '#9b3a3a' : '#c17f3e'} />
                      <text x={6} y={9} textAnchor="middle" fontSize={8} fontWeight="700" fill="white">!</text>
                    </g>
                  )}

                  <circle cx={28} cy={NODE_H / 2} r={18}
                    fill={node.isCurrentUser ? 'rgba(255,255,255,0.2)' : color + '18'} />
                  <text x={28} y={NODE_H / 2 + 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={11} fontWeight="600" fontFamily="system-ui"
                    fill={node.isCurrentUser ? 'white' : color}>
                    {initials}
                  </text>

                  <text x={52} y={isShepherd ? NODE_H / 2 - 9 : NODE_H / 2 - 4}
                    fontSize={12} fontWeight="600" fontFamily="Georgia, serif"
                    fill={node.isCurrentUser ? 'white' : 'var(--foreground)'}>
                    {node.name.slice(0, 22)}{node.name.length > 22 ? '...' : ''}
                  </text>

                  {isShepherd ? (
                    <>
                      <text x={52} y={NODE_H / 2 + 6} fontSize={10} fontFamily="system-ui"
                        fill={node.isCurrentUser ? 'rgba(255,255,255,0.75)' : 'var(--muted-foreground)'}>
                        {node.flockCount} in flock
                      </text>
                      <text x={52} y={NODE_H / 2 + 19} fontSize={9} fontFamily="system-ui"
                        fill={node.isCurrentUser ? 'rgba(255,255,255,0.6)' : 'var(--muted-foreground)'}>
                        {node.contextLabel ? node.contextLabel.slice(0, 30) : 'Shepherd'}
                      </text>
                    </>
                  ) : (
                    <text x={52} y={NODE_H / 2 + 9} fontSize={10} fontFamily="system-ui"
                      fill={node.isCurrentUser ? 'rgba(255,255,255,0.75)' : 'var(--muted-foreground)'}>
                      {node.contextLabel ? node.contextLabel.slice(0, 28) : 'Member'}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* ── Floating controls ── */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2.5 z-40 filter-dropdown">
          <button onClick={() => setFilterOpen(!filterOpen)}
            className="w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-gray-50 transition-colors relative"
            style={{ borderColor: 'var(--border)' }} title="Filter">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={activeFilterCount > 0 ? 'var(--primary)' : '#6b7280'} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
            </svg>
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 w-4.5 h-4.5 min-w-[18px] rounded-full text-[10px] flex items-center justify-center font-bold"
                style={{ background: 'var(--primary)', color: 'white' }}>
                {activeFilterCount}
              </span>
            )}
          </button>
          <button onClick={zoomIn}
            className="w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-gray-50 transition-colors text-lg font-bold"
            style={{ borderColor: 'var(--border)', color: '#6b7280' }} title="Zoom in">+</button>
          <button onClick={zoomOut}
            className="w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-gray-50 transition-colors text-lg font-bold"
            style={{ borderColor: 'var(--border)', color: '#6b7280' }} title="Zoom out">-</button>
          <button onClick={fitAll}
            className="w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-gray-50 transition-colors"
            style={{ borderColor: 'var(--border)' }} title="Fit all">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>
          <span className="text-[10px] sans font-medium" style={{ color: 'var(--muted-foreground)' }}>
            {Math.round(transform.scale * 100)}%
          </span>
        </div>

        {/* ── Filter panel ── */}
        {filterOpen && (
          <div className="absolute right-[72px] top-1/2 -translate-y-1/2 w-72 bg-white rounded-2xl shadow-2xl border z-50 filter-dropdown overflow-hidden"
            style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="font-serif text-sm" style={{ color: 'var(--primary)' }}>Filter Tree</span>
              <button onClick={() => setFilterOpen(false)}
                className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
            </div>

            <div className="flex mx-4 mb-3 rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              <button onClick={() => setFilterTab('groups')}
                className="flex-1 px-3 py-1.5 text-xs font-medium sans transition-colors"
                style={{ background: filterTab === 'groups' ? 'var(--primary)' : 'white', color: filterTab === 'groups' ? 'white' : 'var(--muted-foreground)' }}>
                Group Types
              </button>
              <button onClick={() => setFilterTab('services')}
                className="flex-1 px-3 py-1.5 text-xs font-medium sans transition-colors"
                style={{ background: filterTab === 'services' ? 'var(--primary)' : 'white', color: filterTab === 'services' ? 'white' : 'var(--muted-foreground)' }}>
                Service Types
              </button>
            </div>

            <div className="px-4 pb-2 max-h-56 overflow-y-auto">
              {filterTab === 'groups' && (
                <>
                  {trackedGroupTypes.length > 0 && (
                    <label className="flex items-center gap-2.5 px-1 py-1.5 cursor-pointer hover:bg-gray-50 rounded border-b mb-1 pb-2" style={{ borderColor: 'var(--border)' }}>
                      <input type="checkbox"
                        checked={hiddenGroupTypes.size === 0}
                        ref={el => { if (el) el.indeterminate = hiddenGroupTypes.size > 0 && hiddenGroupTypes.size < trackedGroupTypes.length }}
                        onChange={() => {
                          if (hiddenGroupTypes.size === 0) setHiddenGroupTypes(new Set(trackedGroupTypes.map(gt => gt.id)))
                          else setHiddenGroupTypes(new Set())
                        }}
                        className="rounded" style={{ accentColor: 'var(--primary)' }} />
                      <span className="text-xs sans font-semibold" style={{ color: 'var(--foreground)' }}>Select All</span>
                    </label>
                  )}
                  {trackedGroupTypes.map(gt => {
                    const hidden = hiddenGroupTypes.has(gt.id)
                    return (
                      <label key={gt.id} className="flex items-center gap-2.5 px-1 py-1.5 cursor-pointer hover:bg-gray-50 rounded">
                        <input type="checkbox" checked={!hidden}
                          onChange={() => {
                            setHiddenGroupTypes(prev => {
                              const next = new Set(prev)
                              if (hidden) next.delete(gt.id); else next.add(gt.id)
                              return next
                            })
                          }}
                          className="rounded" style={{ accentColor: 'var(--primary)' }} />
                        <span className="text-xs sans" style={{ color: 'var(--foreground)' }}>{gt.name}</span>
                      </label>
                    )
                  })}
                  {trackedGroupTypes.length === 0 && (
                    <p className="text-xs sans py-4 text-center" style={{ color: 'var(--muted-foreground)' }}>No tracked group types</p>
                  )}
                </>
              )}
              {filterTab === 'services' && (
                <>
                  {trackedServiceTypes.length > 0 && (
                    <label className="flex items-center gap-2.5 px-1 py-1.5 cursor-pointer hover:bg-gray-50 rounded border-b mb-1 pb-2" style={{ borderColor: 'var(--border)' }}>
                      <input type="checkbox"
                        checked={hiddenServiceTypes.size === 0}
                        ref={el => { if (el) el.indeterminate = hiddenServiceTypes.size > 0 && hiddenServiceTypes.size < trackedServiceTypes.length }}
                        onChange={() => {
                          if (hiddenServiceTypes.size === 0) setHiddenServiceTypes(new Set(trackedServiceTypes.map(st => st.id)))
                          else setHiddenServiceTypes(new Set())
                        }}
                        className="rounded" style={{ accentColor: 'var(--primary)' }} />
                      <span className="text-xs sans font-semibold" style={{ color: 'var(--foreground)' }}>Select All</span>
                    </label>
                  )}
                  {trackedServiceTypes.map(st => {
                    const hidden = hiddenServiceTypes.has(st.id)
                    return (
                      <label key={st.id} className="flex items-center gap-2.5 px-1 py-1.5 cursor-pointer hover:bg-gray-50 rounded">
                        <input type="checkbox" checked={!hidden}
                          onChange={() => {
                            setHiddenServiceTypes(prev => {
                              const next = new Set(prev)
                              if (hidden) next.delete(st.id); else next.add(st.id)
                              return next
                            })
                          }}
                          className="rounded" style={{ accentColor: 'var(--primary)' }} />
                        <span className="text-xs sans" style={{ color: 'var(--foreground)' }}>{st.name}</span>
                      </label>
                    )
                  })}
                  {trackedServiceTypes.length === 0 && (
                    <p className="text-xs sans py-4 text-center" style={{ color: 'var(--muted-foreground)' }}>No service types</p>
                  )}
                </>
              )}
            </div>

            <div className="px-4 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}>
              <button onClick={resetToDefault}
                className="text-[11px] sans font-medium px-2.5 py-1 rounded-lg border hover:bg-white transition-colors"
                style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
                {hasDefaultFilter ? 'Reset to Default' : 'Show All'}
              </button>
              <button onClick={() => { saveDefaultFilter(); setFilterOpen(false) }}
                className="text-[11px] sans font-medium px-2.5 py-1 rounded-lg transition-colors"
                style={{ background: 'var(--primary)', color: 'white' }}>
                Set as Default
              </button>
            </div>
          </div>
        )}

        {/* ── Detail panel ── */}
        {selected && (() => {
          const isShepherd = selected.role === 'shepherd'
          const isManual = !!selected.layerId
          const detailColor = selected.isLeadPastor ? '#7c3aed' : isManual ? '#3b6ea5' : isShepherd ? '#4a7c59' : '#6b7280'
          const initials = selected.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()
          const pid = realId(selected)
          const assignment = assignmentsMap[pid]
          const personOversight = oversightMap[pid] || []

          return (
            <div className="absolute right-4 top-4 w-72 bg-white rounded-2xl shadow-xl border p-5"
              style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-11 h-11 rounded-full flex items-center justify-center text-sm font-semibold sans"
                    style={{ background: detailColor + '20', color: detailColor }}>
                    {initials}
                  </div>
                  <div>
                    <div className="font-serif text-base" style={{ color: 'var(--primary)' }}>{selected.name}</div>
                    <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>
                      {selected.contextLabel || (isShepherd ? 'Shepherd' : 'Member')}
                    </div>
                  </div>
                </div>
                <button onClick={() => setSelected(null)}
                  className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
              </div>

              <div className="flex items-center gap-2 mb-3 flex-wrap">
                {selected.isLeadPastor && (
                  <span className="inline-block text-xs sans px-2.5 py-1 rounded-full font-medium"
                    style={{ background: '#7c3aed20', color: '#7c3aed' }}>Lead Pastor</span>
                )}
                {assignment && (
                  <span className="inline-block text-xs sans px-2.5 py-1 rounded-full font-medium"
                    style={{ background: detailColor + '15', color: detailColor }}>
                    {assignment.layerName}
                  </span>
                )}
                {!assignment && (
                  <span className="inline-block text-xs sans px-2.5 py-1 rounded-full font-medium"
                    style={{ background: detailColor + '15', color: detailColor }}>
                    {isShepherd ? 'Volunteer Leader' : 'Member'}
                  </span>
                )}
                {selected.warning && (
                  <span className="inline-block text-xs sans px-2.5 py-1 rounded-full font-medium"
                    style={{ background: selected.warning === 'Unconnected' ? '#9b3a3a20' : '#fef3cd', color: selected.warning === 'Unconnected' ? '#9b3a3a' : '#856404' }}>{selected.warning}</span>
                )}
              </div>

              {/* Oversight list */}
              {personOversight.length > 0 && (
                <div className="mb-3 px-3 py-2 rounded-lg" style={{ background: 'var(--muted)' }}>
                  <div className="text-[10px] sans font-semibold uppercase tracking-wide mb-1" style={{ color: 'var(--muted-foreground)' }}>Oversees</div>
                  {personOversight.map((o, i) => (
                    <div key={i} className="text-xs sans" style={{ color: 'var(--foreground)' }}>{o.typeName}</div>
                  ))}
                </div>
              )}

              {isShepherd && (
                <div className="grid grid-cols-2 gap-3 mb-3">
                  <div className="rounded-xl p-3 text-center" style={{ background: 'var(--muted)' }}>
                    <div className="text-2xl font-serif" style={{ color: 'var(--primary)' }}>{selected.flockCount}</div>
                    <div className="text-xs sans mt-0.5" style={{ color: 'var(--muted-foreground)' }}>In Flock</div>
                  </div>
                  <div className="rounded-xl p-3 text-center" style={{ background: 'var(--muted)' }}>
                    <div className="text-sm font-serif" style={{ color: healthColor(selected) }}>{checkinLabel(selected)}</div>
                    <div className="text-xs sans mt-0.5" style={{ color: 'var(--muted-foreground)' }}>Last Check-in</div>
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {isAdmin && (
                  <button
                    onClick={() => openAssignModal(pid, selected.name)}
                    className="w-full text-center text-xs sans py-2 rounded-lg font-medium"
                    style={{ background: 'var(--primary)', color: 'white' }}>
                    Edit Assignment
                  </button>
                )}
                {isShepherd && (
                  <a href={`/checkins?shepherd=${pid}`}
                    className="w-full text-center text-xs sans py-2 rounded-lg font-medium border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
                    View Check-ins
                  </a>
                )}
                {isAdmin && assignment && (
                  <button
                    onClick={() => removeAssignment(pid, selected.name)}
                    className="w-full text-center text-xs sans py-2 rounded-lg font-medium border mt-1"
                    style={{ borderColor: 'var(--danger, #9b3a3a)', color: 'var(--danger, #9b3a3a)' }}>
                    Remove from Hierarchy
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        {/* ══════════════════════════════════════════════════════
            MODAL: Assign / Edit Person
           ══════════════════════════════════════════════════════ */}
        {assignModal && (
          <div className="absolute inset-0 flex items-center justify-center z-50" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="w-[440px] bg-white rounded-2xl shadow-xl border" style={{ borderColor: 'var(--border)', maxHeight: 'min(85vh, 700px)', display: 'flex', flexDirection: 'column' }}>
              {/* Header */}
              <div className="flex items-center justify-between px-5 pt-4 pb-3 shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
                <h3 className="font-serif text-sm" style={{ color: 'var(--primary)' }}>
                  {assignModal.isEdit ? `Edit — ${assignModal.personName}` : 'Add Person'}
                </h3>
                <button onClick={() => setAssignModal(null)}
                  className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
              </div>

              {/* Scrollable content */}
              <div className="overflow-y-auto px-5 py-4 flex-1 space-y-4">
                {/* Person search (only if not editing) */}
                {!assignModal.isEdit && (
                  <div>
                    <label className="text-[10px] sans font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted-foreground)' }}>Person</label>
                    {assignModal.personId ? (
                      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--muted)' }}>
                        <span className="text-sm sans font-medium" style={{ color: 'var(--foreground)' }}>{assignModal.personName}</span>
                        <button onClick={() => setAssignModal({ ...assignModal, personId: '', personName: '' })}
                          className="text-xs ml-auto" style={{ color: 'var(--muted-foreground)' }}>Change</button>
                      </div>
                    ) : (
                      <>
                        <input type="text" placeholder="Search by name..." value={assignSearch}
                          onChange={e => setAssignSearch(e.target.value)}
                          className="w-full px-3 py-2 rounded-lg border text-sm sans"
                          style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }} autoFocus />
                        {assignResults.length > 0 && (
                          <div className="mt-1 max-h-40 overflow-y-auto border rounded-lg" style={{ borderColor: 'var(--border)' }}>
                            {assignResults.map(p => (
                              <button key={p.id} onClick={() => {
                                setAssignModal({ ...assignModal, personId: p.id, personName: p.name })
                                setAssignSearch('')
                                setAssignResults([])
                              }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 text-sm sans"
                                style={{ color: 'var(--foreground)' }}>
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium sans shrink-0"
                                  style={{ background: '#4a7c5918', color: '#4a7c59' }}>
                                  {p.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                                </div>
                                {p.name}
                                {assignmentsMap[p.id] && (
                                  <span className="ml-auto text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                                    Already: {assignmentsMap[p.id].layerName}
                                  </span>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}

                {/* Layer indicator (read-only) */}
                {assignModal.layerId && (() => {
                  const layer = layers.find(l => l.id === assignModal.layerId)
                  if (!layer) return null
                  const lColor = layer.category === 'elder' ? '#7c3aed' : layer.category === 'staff' ? '#3b6ea5' : '#4a7c59'
                  return (
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: lColor + '10' }}>
                      <span className="text-[10px] sans font-semibold uppercase tracking-wide" style={{ color: 'var(--muted-foreground)' }}>Layer:</span>
                      <span className="text-xs sans font-medium" style={{ color: lColor }}>{layer.name}</span>
                    </div>
                  )
                })()}

                {/* Reports to (supervisor) — only people from layers above */}
                <div>
                  <label className="text-[10px] sans font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted-foreground)' }}>Reports To</label>
                  <select
                    value={assignModal.supervisorPersonId}
                    onChange={e => setAssignModal({ ...assignModal, supervisorPersonId: e.target.value })}
                    className="w-full px-3 py-2 rounded-lg border text-sm sans"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                    <option value="">None (top of tree)</option>
                    {(() => {
                      const currentLayerRank = layers.find(l => l.id === assignModal.layerId)?.rank ?? 999
                      return assignedPeople
                        .filter(p => p.id !== assignModal.personId && p.layerRank < currentLayerRank)
                        .map(p => (
                          <option key={p.id} value={p.id}>{p.name} ({p.layerName})</option>
                        ))
                    })()}
                  </select>
                </div>

                {/* Lead Pastor toggle (only for elder layer) */}
                {elderLayers.some(l => l.id === assignModal.layerId) && (
                  <div className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: '#7c3aed10' }}>
                    <div>
                      <div className="text-xs sans font-medium" style={{ color: '#7c3aed' }}>Lead Pastor</div>
                      <div className="text-[10px] sans" style={{ color: 'var(--muted-foreground)' }}>Top of the shepherd tree</div>
                    </div>
                    <button
                      onClick={() => setAssignModal({ ...assignModal, isLeadPastor: !assignModal.isLeadPastor })}
                      className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                      style={{ background: assignModal.isLeadPastor ? '#7c3aed' : 'var(--border)' }}>
                      <span className="absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform"
                        style={{ transform: assignModal.isLeadPastor ? 'translateX(16px)' : 'translateX(0)' }} />
                    </button>
                  </div>
                )}

                {/* Oversight checkboxes */}
                <div>
                  <label className="text-[10px] sans font-semibold uppercase tracking-wide block mb-1.5" style={{ color: 'var(--muted-foreground)' }}>Oversees (optional)</label>
                  <p className="text-[10px] sans mb-2" style={{ color: 'var(--muted-foreground)' }}>
                    PCO group/team leaders of these types will appear under this person.
                  </p>

                  {groupTypes.filter(gt => gt.is_tracked).length > 0 && (
                    <div className="mb-2">
                      <div className="text-[9px] sans font-semibold uppercase tracking-wide mb-1" style={{ color: '#4a7c59' }}>Group Types</div>
                      {groupTypes.filter(gt => gt.is_tracked).map(gt => {
                        const active = assignModal.oversightEntries.some(o => o.context_type === 'group_type' && o.context_id === gt.id)
                        return (
                          <label key={gt.id} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50">
                            <input type="checkbox" checked={active}
                              onChange={() => {
                                const entries = active
                                  ? assignModal.oversightEntries.filter(o => !(o.context_type === 'group_type' && o.context_id === gt.id))
                                  : [...assignModal.oversightEntries, { context_type: 'group_type', context_id: gt.id }]
                                setAssignModal({ ...assignModal, oversightEntries: entries })
                              }}
                              className="rounded" style={{ accentColor: '#4a7c59' }} />
                            <span className="text-xs sans" style={{ color: 'var(--foreground)' }}>{gt.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {serviceTypes.length > 0 && (
                    <div className="mb-2">
                      <div className="text-[9px] sans font-semibold uppercase tracking-wide mb-1" style={{ color: '#3b6ea5' }}>Service Types</div>
                      {serviceTypes.map(st => {
                        const active = assignModal.oversightEntries.some(o => o.context_type === 'service_type' && o.context_id === st.id)
                        return (
                          <label key={st.id} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50">
                            <input type="checkbox" checked={active}
                              onChange={() => {
                                const entries = active
                                  ? assignModal.oversightEntries.filter(o => !(o.context_type === 'service_type' && o.context_id === st.id))
                                  : [...assignModal.oversightEntries, { context_type: 'service_type', context_id: st.id }]
                                setAssignModal({ ...assignModal, oversightEntries: entries })
                              }}
                              className="rounded" style={{ accentColor: '#3b6ea5' }} />
                            <span className="text-xs sans" style={{ color: 'var(--foreground)' }}>{st.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}

                  {departments.length > 0 && (
                    <div>
                      <div className="text-[9px] sans font-semibold uppercase tracking-wide mb-1" style={{ color: '#c17f3e' }}>Departments</div>
                      {departments.map(dept => {
                        const active = assignModal.oversightEntries.some(o => o.context_type === 'department' && o.context_id === dept.id)
                        return (
                          <label key={dept.id} className="flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer hover:bg-gray-50">
                            <input type="checkbox" checked={active}
                              onChange={() => {
                                const entries = active
                                  ? assignModal.oversightEntries.filter(o => !(o.context_type === 'department' && o.context_id === dept.id))
                                  : [...assignModal.oversightEntries, { context_type: 'department', context_id: dept.id }]
                                setAssignModal({ ...assignModal, oversightEntries: entries })
                              }}
                              className="rounded" style={{ accentColor: '#c17f3e' }} />
                            <span className="text-xs sans" style={{ color: 'var(--foreground)' }}>{dept.name}</span>
                          </label>
                        )
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* Footer */}
              <div className="px-5 py-3 border-t flex items-center justify-between shrink-0" style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}>
                <div>
                  {assignModal.isEdit && (
                    <button onClick={() => removeAssignment(assignModal.personId, assignModal.personName)}
                      className="text-[11px] sans font-medium px-2.5 py-1 rounded-lg"
                      style={{ color: 'var(--danger, #9b3a3a)' }}>
                      Remove
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setAssignModal(null)}
                    className="text-[11px] sans font-medium px-3 py-1.5 rounded-lg border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
                    Cancel
                  </button>
                  <button onClick={saveAssignment} disabled={saving || !assignModal.personId || !assignModal.layerId}
                    className="text-[11px] sans font-medium px-3 py-1.5 rounded-lg disabled:opacity-50"
                    style={{ background: 'var(--primary)', color: 'white' }}>
                    {saving ? 'Saving...' : assignModal.isEdit ? 'Save Changes' : 'Assign'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            MODAL: Manage Layers
           ══════════════════════════════════════════════════════ */}
        {layerModalOpen && <ManageLayersModal
          elderLayers={elderLayers}
          staffLayers={staffLayers}
          volunteerLayers={volunteerLayers}
          pcoLists={pcoLists}
          listLayerLinks={listLayerLinks}
          layers={layers}
          newLayerName={newLayerName}
          setNewLayerName={setNewLayerName}
          newLayerCategory={newLayerCategory}
          setNewLayerCategory={setNewLayerCategory}
          saving={saving}
          addLayer={addLayer}
          removeLayer={removeLayer}
          onClose={() => setLayerModalOpen(false)}
          onConfirm={fetchTree}
        />}

        {deptModalOpen && (
          <DepartmentModal
            departments={departments}
            departmentMembers={departmentMembers}
            allStaffPeople={allStaffPeople}
            onClose={() => setDeptModalOpen(false)}
            onChange={fetchTree}
          />
        )}
      </div>

      {/* ══════════════════════════════════════════════════════
          BOTTOM PANEL: Unassigned
         ══════════════════════════════════════════════════════ */}
      {isAdmin && (
        <div className="shrink-0 border-t bg-white" style={{ borderColor: 'var(--border)' }}>
          {/* Panel header */}
          <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: panelCollapsed ? 'none' : '1px solid var(--border)' }}>
            <div className="flex items-center gap-3">
              <button onClick={() => setPanelCollapsed(!panelCollapsed)}
                className="text-xs sans font-medium" style={{ color: 'var(--primary)' }}>
                {panelCollapsed ? '▸' : '▾'} Unassigned
              </button>
              {!panelCollapsed && (
                <div className="flex items-center gap-1">
                  {[
                    { key: 'staff' as const, label: 'Shepherd Team', count: unconnectedStaff.length, color: '#3b6ea5' },
                    { key: 'types' as const, label: 'Group / Service Types', count: unlinkedGroupTypes.length + unlinkedServiceTypes.length, color: '#4a7c59' },
                    { key: 'volunteers' as const, label: 'Volunteers', count: unconnectedVolunteers.length, color: '#6b7280' },
                  ].map(tab => (
                    <button key={tab.key} onClick={() => setUnassignedTab(tab.key)}
                      className="text-[11px] sans px-2.5 py-1 rounded-full font-medium transition-colors"
                      style={{
                        background: unassignedTab === tab.key ? tab.color + '15' : 'transparent',
                        color: unassignedTab === tab.key ? tab.color : 'var(--muted-foreground)',
                      }}>
                      {tab.label} <span className="ml-0.5 text-[10px]">({tab.count})</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {!panelCollapsed && activeParent && (
              <div className="flex items-center gap-2 text-[11px] sans" style={{ color: 'var(--muted-foreground)' }}>
                Assigning under: <span className="font-medium" style={{ color: 'var(--foreground)' }}>
                  {allNodes.find(n => n.personId === activeParent.personId)?.name || 'Selected'}
                </span>
                <button onClick={() => setActiveParent(null)} className="text-xs" style={{ color: 'var(--danger, #9b3a3a)' }}>×</button>
              </div>
            )}
          </div>

          {/* Panel body — horizontal scroll of tree-matching cards */}
          {!panelCollapsed && (
            <div className="px-4 py-3 overflow-x-auto" style={{ scrollbarWidth: 'thin' }}>
              {/* Staff (Shepherd Team) tab */}
              {unassignedTab === 'staff' && (
                <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
                  {unconnectedStaff.length === 0 && (
                    <span className="text-xs sans whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>All shepherd team members are connected.</span>
                  )}
                  {unconnectedStaff.map(s => {
                    const initials = s.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                    return (
                      <button key={s.id}
                        onClick={async () => {
                          if (!activeParent) return
                          setSaving(true)
                          try {
                            await fetch('/api/tree', {
                              method: 'POST', headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                action: 'save_assignment', person_id: s.id,
                                layer_id: assignmentsMap[s.id]?.layerId,
                                supervisor_person_id: activeParent.personId,
                                oversight: oversightMap[s.id]?.map(o => ({ context_type: o.contextType, context_id: o.contextId })) || [],
                                is_lead_pastor: false,
                              }),
                            })
                            await fetchTree()
                          } finally { setSaving(false) }
                        }}
                        disabled={!activeParent || saving}
                        className="shrink-0 relative text-left border rounded-[10px] transition-all disabled:opacity-40 hover:shadow-md"
                        style={{ width: 220, height: 72, borderColor: activeParent ? '#3b6ea5' : 'var(--border)', background: 'white', overflow: 'hidden' }}>
                        <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[10px]" style={{ background: '#3b6ea5' }} />
                        <div className="flex items-center h-full pl-3 pr-2">
                          <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold sans shrink-0"
                            style={{ background: '#3b6ea518', color: '#3b6ea5' }}>{initials}</div>
                          <div className="ml-2.5 min-w-0">
                            <div className="text-[12px] font-semibold truncate" style={{ fontFamily: 'Georgia, serif', color: 'var(--foreground)' }}>{s.name}</div>
                            <div className="text-[10px] sans truncate" style={{ color: 'var(--muted-foreground)' }}>{s.layerName}</div>
                          </div>
                        </div>
                      </button>
                    )
                  })}
                </div>
              )}

              {/* Types tab */}
              {unassignedTab === 'types' && (
                <div className="flex gap-3" style={{ minWidth: 'min-content' }}>
                  {unlinkedGroupTypes.length === 0 && unlinkedServiceTypes.length === 0 && (
                    <span className="text-xs sans whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>All types are connected to a staff overseer.</span>
                  )}
                  {unlinkedGroupTypes.map(gt => (
                    <button key={`gt-${gt.id}`}
                      onClick={async () => {
                        if (!activeParent) return
                        setSaving(true)
                        try {
                          const existing = oversightMap[activeParent.personId] || []
                          const entries = [...existing.map(o => ({ context_type: o.contextType, context_id: o.contextId })), { context_type: 'group_type', context_id: gt.id }]
                          await fetch('/api/tree', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'save_assignment', person_id: activeParent.personId,
                              layer_id: assignmentsMap[activeParent.personId]?.layerId,
                              supervisor_person_id: assignmentsMap[activeParent.personId]?.supervisorPersonId || null,
                              oversight: entries,
                              is_lead_pastor: allNodes.find(n => n.personId === activeParent.personId)?.isLeadPastor || false,
                            }),
                          })
                          await fetchTree()
                        } finally { setSaving(false) }
                      }}
                      disabled={!activeParent || saving}
                      className="shrink-0 relative text-left border rounded-[10px] transition-all disabled:opacity-40 hover:shadow-md"
                      style={{ width: 220, height: 72, borderColor: activeParent ? '#4a7c59' : 'var(--border)', background: 'white', overflow: 'hidden' }}>
                      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[10px]" style={{ background: '#4a7c59' }} />
                      <div className="flex items-center h-full pl-3 pr-2">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: '#4a7c5918' }}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#4a7c59' }} />
                        </div>
                        <div className="ml-2.5 min-w-0">
                          <div className="text-[12px] font-semibold truncate" style={{ fontFamily: 'Georgia, serif', color: 'var(--foreground)' }}>{gt.name}</div>
                          <div className="text-[10px] sans truncate" style={{ color: '#4a7c59' }}>Group Type</div>
                        </div>
                      </div>
                    </button>
                  ))}
                  {unlinkedServiceTypes.map(st => (
                    <button key={`st-${st.id}`}
                      onClick={async () => {
                        if (!activeParent) return
                        setSaving(true)
                        try {
                          const existing = oversightMap[activeParent.personId] || []
                          const entries = [...existing.map(o => ({ context_type: o.contextType, context_id: o.contextId })), { context_type: 'service_type', context_id: st.id }]
                          await fetch('/api/tree', {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              action: 'save_assignment', person_id: activeParent.personId,
                              layer_id: assignmentsMap[activeParent.personId]?.layerId,
                              supervisor_person_id: assignmentsMap[activeParent.personId]?.supervisorPersonId || null,
                              oversight: entries,
                              is_lead_pastor: allNodes.find(n => n.personId === activeParent.personId)?.isLeadPastor || false,
                            }),
                          })
                          await fetchTree()
                        } finally { setSaving(false) }
                      }}
                      disabled={!activeParent || saving}
                      className="shrink-0 relative text-left border rounded-[10px] transition-all disabled:opacity-40 hover:shadow-md"
                      style={{ width: 220, height: 72, borderColor: activeParent ? '#3b6ea5' : 'var(--border)', background: 'white', overflow: 'hidden' }}>
                      <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[10px]" style={{ background: '#3b6ea5' }} />
                      <div className="flex items-center h-full pl-3 pr-2">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                          style={{ background: '#3b6ea518' }}>
                          <span className="w-2.5 h-2.5 rounded-full" style={{ background: '#3b6ea5' }} />
                        </div>
                        <div className="ml-2.5 min-w-0">
                          <div className="text-[12px] font-semibold truncate" style={{ fontFamily: 'Georgia, serif', color: 'var(--foreground)' }}>{st.name}</div>
                          <div className="text-[10px] sans truncate" style={{ color: '#3b6ea5' }}>Service Type</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Volunteers tab */}
              {unassignedTab === 'volunteers' && (
                <div>
                  {/* Filter */}
                  <div className="flex items-center gap-2 mb-2">
                    <select value={volunteerFilter} onChange={e => setVolunteerFilter(e.target.value)}
                      className="px-2 py-1 rounded-lg border text-[11px] sans"
                      style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                      <option value="all">All types</option>
                      {groupTypes.filter(gt => gt.is_tracked).map(gt => (
                        <option key={`gf-${gt.id}`} value={`gt-${gt.id}`}>{gt.name}</option>
                      ))}
                      {serviceTypes.map(st => (
                        <option key={`sf-${st.id}`} value={`st-${st.id}`}>{st.name}</option>
                      ))}
                    </select>
                    <span className="text-[10px] sans" style={{ color: 'var(--muted-foreground)' }}>
                      {(() => {
                        const filtered = volunteerFilter === 'all' ? unconnectedVolunteers
                          : volunteerFilter.startsWith('gt-') ? unconnectedVolunteers.filter(v => v.groupTypeId === volunteerFilter.slice(3))
                          : unconnectedVolunteers.filter(v => v.serviceTypeId === volunteerFilter.slice(3))
                        return `${filtered.length} unconnected`
                      })()}
                    </span>
                  </div>
                  <div className="flex gap-3" style={{ minWidth: 'min-content', overflowX: 'auto' }}>
                    {(() => {
                      const filtered = volunteerFilter === 'all' ? unconnectedVolunteers
                        : volunteerFilter.startsWith('gt-') ? unconnectedVolunteers.filter(v => v.groupTypeId === volunteerFilter.slice(3))
                        : unconnectedVolunteers.filter(v => v.serviceTypeId === volunteerFilter.slice(3))
                      if (filtered.length === 0) return (
                        <span className="text-xs sans whitespace-nowrap" style={{ color: 'var(--muted-foreground)' }}>All volunteers are connected.</span>
                      )
                      return filtered.map(v => {
                        const initials = v.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
                        return (
                          <button key={v.id}
                            onClick={async () => {
                              if (!activeParent) return
                              setSaving(true)
                              try {
                                const existing = assignmentsMap[v.id]
                                await fetch('/api/tree', {
                                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                                  body: JSON.stringify({
                                    action: 'save_assignment', person_id: v.id,
                                    layer_id: existing?.layerId || activeParent.layerId,
                                    supervisor_person_id: activeParent.personId,
                                    oversight: oversightMap[v.id]?.map(o => ({ context_type: o.contextType, context_id: o.contextId })) || [],
                                    is_lead_pastor: false,
                                  }),
                                })
                                await fetchTree()
                              } finally { setSaving(false) }
                            }}
                            disabled={!activeParent || saving}
                            className="shrink-0 relative text-left border rounded-[10px] transition-all disabled:opacity-40 hover:shadow-md"
                            style={{ width: 220, height: 72, borderColor: activeParent ? '#6b7280' : 'var(--border)', background: 'white', overflow: 'hidden' }}>
                            <div className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[10px]" style={{ background: '#6b7280' }} />
                            <div className="flex items-center h-full pl-3 pr-2">
                              <div className="w-9 h-9 rounded-full flex items-center justify-center text-[11px] font-semibold sans shrink-0"
                                style={{ background: '#6b728018', color: '#6b7280' }}>{initials}</div>
                              <div className="ml-2.5 min-w-0">
                                <div className="text-[12px] font-semibold truncate" style={{ fontFamily: 'Georgia, serif', color: 'var(--foreground)' }}>{v.name}</div>
                                <div className="text-[10px] sans truncate" style={{ color: 'var(--muted-foreground)' }}>Volunteer</div>
                              </div>
                            </div>
                          </button>
                        )
                      })
                    })()}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
