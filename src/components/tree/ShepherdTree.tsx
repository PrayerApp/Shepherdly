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
  contextLabel: string | null
  warning: string | null
  groupTypeId?: string | null
  serviceTypeId?: string | null
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
const CO_LEADER_GAP = 12 // tight gap between co-leaders

interface CoLeaderLink { from: string; to: string }
interface GroupTypeOption { id: string; name: string; is_tracked: boolean }
interface ServiceTypeOption { id: string; name: string }

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

/** Post-process layout: pull co-leaders close together and compute midpoints */
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

    // Calculate how far apart they are and how much to close the gap
    const currentGap = toNode.x - fromNode.x
    const desiredGap = NODE_W + CO_LEADER_GAP
    if (Math.abs(currentGap) <= desiredGap) {
      // Already close enough
      const mx = (fromNode.x + toNode.x) / 2
      const my = fromNode.y + NODE_H
      midpoints.set(link.from, { mx, my })
      continue
    }

    const shift = (Math.abs(currentGap) - desiredGap) / 2
    const sign = currentGap > 0 ? 1 : -1

    // Collect all descendants of a node
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

    // Shift from-node and descendants towards to-node
    const fromDescendants = getDescendants(fromNode)
    fromNode.x += shift * sign
    for (const d of fromDescendants) d.x += shift * sign

    // Shift to-node and descendants towards from-node
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

  // Search-to-navigate
  const [treeSearch, setTreeSearch] = useState('')
  const [treeSearchResults, setTreeSearchResults] = useState<LayoutNode[]>([])
  const [highlightedNodeId, setHighlightedNodeId] = useState<string | null>(null)

  // Filter — persisted in localStorage
  const [filterOpen, setFilterOpen] = useState(false)
  const [filterTab, setFilterTab] = useState<'groups' | 'services'>('groups')
  const [hiddenGroupTypes, setHiddenGroupTypes] = useState<Set<string>>(new Set())
  const [hiddenServiceTypes, setHiddenServiceTypes] = useState<Set<string>>(new Set())
  const [filterLoaded, setFilterLoaded] = useState(false)

  // Modal state
  type ModalMode =
    | { type: 'add_to_flock'; personId: string; personName: string }
    | { type: 'assign_shepherd'; personId: string; personName: string }
    | { type: 'add_person' }
  const [modal, setModal] = useState<ModalMode | null>(null)
  const [searchTerm, setSearchTerm] = useState('')
  const [addSearch, setAddSearch] = useState('')
  const [addResults, setAddResults] = useState<{ id: string; name: string; pco_id: string | null }[]>([])
  const [assignTab, setAssignTab] = useState<'person' | 'group_type' | 'service_type'>('person')
  const [addPlacement, setAddPlacement] = useState<'root' | 'under_shepherd' | 'over_group_type' | 'over_service_type'>('root')
  const [bulkAssigning, setBulkAssigning] = useState(false)

  // Pan & zoom
  const [transform, setTransform] = useState({ x: 0, y: 60, scale: 1 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })

  const closeModal = () => {
    setModal(null)
    setSearchTerm('')
    setAddSearch('')
    setAddResults([])
    setAssignTab('person')
    setAddPlacement('root')
  }

  // Load filter from localStorage on mount
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

  // Save filter to localStorage when it changes (after initial load)
  useEffect(() => {
    if (!filterLoaded) return
    try {
      localStorage.setItem('shepherdly-tree-filter', JSON.stringify({
        hiddenGroupTypes: [...hiddenGroupTypes],
        hiddenServiceTypes: [...hiddenServiceTypes],
      }))
    } catch { /* ignore */ }
  }, [hiddenGroupTypes, hiddenServiceTypes, filterLoaded])

  // Save/load default filter
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
        // No default saved — show everything
        setHiddenGroupTypes(new Set())
        setHiddenServiceTypes(new Set())
      }
    } catch {
      setHiddenGroupTypes(new Set())
      setHiddenServiceTypes(new Set())
    }
  }
  const hasDefaultFilter = typeof window !== 'undefined' && !!localStorage.getItem('shepherdly-tree-filter-default')

  // Search-to-navigate
  useEffect(() => {
    if (treeSearch.length < 2) { setTreeSearchResults([]); return }
    const q = treeSearch.toLowerCase()
    const matches = nodes.filter(n => n.name.toLowerCase().includes(q))
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

  // Apply filter to raw nodes before building tree
  const filteredNodes = useMemo(() => {
    if (hiddenGroupTypes.size === 0 && hiddenServiceTypes.size === 0) return allNodes
    return allNodes.filter(n => {
      if (n.groupTypeId && hiddenGroupTypes.has(n.groupTypeId)) return false
      if (n.serviceTypeId && hiddenServiceTypes.has(n.serviceTypeId)) return false
      return true
    })
  }, [allNodes, hiddenGroupTypes, hiddenServiceTypes])

  // Rebuild tree when filtered nodes or co-leader links change
  useEffect(() => {
    if (filteredNodes.length === 0) { setNodes([]); setEdges([]); return }
    const laid = buildTree(filteredNodes)
    const midpoints = applyCoLeaderLayout(laid, coLeaderLinks)
    setCoLeaderMidpoints(midpoints)
    setNodes(laid)
    setEdges(getAllEdges(laid))
  }, [filteredNodes, coLeaderLinks])

  const fetchTree = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/tree')
    const data = await res.json()
    if (data.error) { setError(data.error); setLoading(false); return }

    setAllNodes(data.nodes || [])
    setCoLeaderLinks(data.coLeaderLinks || [])
    setCurrentUserRole(data.currentUserRole || null)
    setGroupTypes(data.groupTypes || [])
    setServiceTypes(data.serviceTypes || [])

    // Initial transform: center tree
    const laid = buildTree(data.nodes || [])
    const midpoints = applyCoLeaderLayout(laid, data.coLeaderLinks || [])
    setCoLeaderMidpoints(midpoints)
    setNodes(laid)
    setEdges(getAllEdges(laid))

    if (laid.length > 0) {
      const minX = Math.min(...laid.map(n => n.x)) - NODE_W / 2
      const maxX = Math.max(...laid.map(n => n.x)) + NODE_W / 2
      const treeW = maxX - minX
      setTransform({ x: -minX - treeW / 2, y: 60, scale: 1 })
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchTree() }, [fetchTree])

  // People search for add-person modal
  useEffect(() => {
    if (addSearch.length < 2) { setAddResults([]); return }
    const t = setTimeout(async () => {
      const res = await fetch(`/api/people?search=${encodeURIComponent(addSearch)}&all=true`)
      const data = await res.json()
      setAddResults((data.people || []).slice(0, 12).map((p: any) => ({
        id: p.id, name: p.name, pco_id: p.pco_id,
      })))
    }, 300)
    return () => clearTimeout(t)
  }, [addSearch])

  const realId = (node: TreeNode) => node.personId || node.id

  // ── Actions ──────────────────────────────────────────────────

  const assignShepherd = async (personId: string, shepherdId: string) => {
    const pid = personId.split('::')[0]
    const sid = shepherdId.split('::')[0]
    await fetch(`/api/people/${pid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_shepherd', shepherd_id: sid, context_type: 'manual' }),
    })
    closeModal()
    fetchTree()
  }

  const removeFromTree = async (personId: string, personName: string) => {
    if (!confirm(`Remove ${personName} from the tree? This removes manual assignments and leader status. PCO group/team memberships are not affected.`)) return
    await fetch('/api/tree', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ person_id: personId }),
    })
    setSelected(null)
    fetchTree()
  }

  const addAsRoot = async (personId: string) => {
    await fetch(`/api/people/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_leader: true }),
    })
    closeModal()
    fetchTree()
  }

  const addUnderShepherd = async (personId: string, shepherdId: string) => {
    await fetch(`/api/people/${personId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_shepherd', shepherd_id: shepherdId, context_type: 'manual' }),
    })
    closeModal()
    fetchTree()
  }

  const bulkAssignShepherd = async (shepherdId: string, typeKey: 'group_type_id' | 'service_type_id', typeId: string, typeName: string) => {
    setBulkAssigning(true)
    try {
      const res = await fetch('/api/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'bulk_assign',
          shepherd_id: shepherdId,
          [typeKey]: typeId,
        }),
      })
      const data = await res.json()
      if (data.error) { alert('Error: ' + data.error); return }
      alert(`Assigned as shepherd over "${typeName}"`)
      closeModal()
      fetchTree()
    } finally {
      setBulkAssigning(false)
    }
  }

  // ── Zoom helpers ────────────────────────────────────────────

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
    setTransform({
      x: -minX - treeW / 2,
      y: -minY + 20 / scale,
      scale,
    })
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
        // Pinch / ctrl+scroll = zoom
        const sensitivity = 0.01
        const delta = 1 - e.deltaY * sensitivity
        setTransform(t => ({ ...t, scale: Math.min(3, Math.max(0.05, t.scale * delta)) }))
      } else {
        // Regular scroll = pan
        setTransform(t => ({
          ...t,
          x: t.x - e.deltaX / t.scale,
          y: t.y - e.deltaY / t.scale,
        }))
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

  // Close filter dropdown when clicking outside
  useEffect(() => {
    if (!filterOpen) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Element
      if (!target.closest('.filter-dropdown')) setFilterOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [filterOpen])

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
        <p className="font-serif text-2xl mb-2" style={{ color: 'var(--primary)' }}>No leaders found</p>
        <p className="sans text-sm mb-4" style={{ color: 'var(--muted-foreground)' }}>
          Sync your groups and teams from PCO, then add people to the tree.
        </p>
        {['super_admin', 'staff'].includes(currentUserRole || '') && (
          <button onClick={() => setModal({ type: 'add_person' })}
            className="text-xs sans px-4 py-2 rounded-lg font-medium"
            style={{ background: 'var(--primary)', color: 'white' }}>
            + Add Person
          </button>
        )}
      </div>
    </div>
  )

  // Build set of primary co-leader IDs (the "from" in each link) for edge origin override
  const primaryCoLeaderIds = new Set(coLeaderLinks.map(l => l.from))

  // Deduplicated shepherd list for dropdowns
  const shepherdOptions = allNodes
    .filter(n => n.role === 'shepherd')
    .filter((n, i, arr) => arr.findIndex(x => realId(x) === realId(n)) === i)
    .sort((a, b) => a.name.localeCompare(b.name))

  // Tracked types for filter
  const trackedGroupTypes = groupTypes.filter(gt => gt.is_tracked)
  const trackedServiceTypes = serviceTypes

  const activeFilterCount = hiddenGroupTypes.size + hiddenServiceTypes.size

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: 'var(--border)', background: 'white' }}>
        <div className="shrink-0">
          <h1 className="font-serif text-lg" style={{ color: 'var(--primary)' }}>Shepherd Tree</h1>
          <p className="sans text-[11px] mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
            {new Set(nodes.filter(n => n.role === 'shepherd').map(n => n.personId || n.id)).size} shepherds · {nodes.length} people · scroll to pan, ctrl+scroll to zoom
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

          {/* Health legend - hidden on small screens */}
          <div className="hidden lg:flex items-center gap-2.5 text-[11px] sans mr-1" style={{ color: 'var(--muted-foreground)' }}>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#4a7c59' }} />Healthy</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#c17f3e' }} />Attention</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#9b3a3a' }} />At risk</span>
          </div>

          {['super_admin', 'staff'].includes(currentUserRole || '') && (
            <button onClick={() => setModal({ type: 'add_person' })}
              className="text-xs sans px-3 py-1.5 rounded-lg font-medium"
              style={{ background: 'var(--primary)', color: 'white' }}>
              + Add Person
            </button>
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
            {/* Edges — use co-leader midpoint as origin when applicable */}
            {edges.map(({ from, to }) => {
              let fx = from.x, fy = from.y + NODE_H
              // If parent is a primary co-leader, draw edge from midpoint instead
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
                  {/* Horizontal bar between cards */}
                  <line x1={x1} y1={y} x2={x2} y2={y}
                    stroke="#4a7c59" strokeWidth="2" strokeDasharray="6 3" />
                  {/* Junction dot at bottom center — edge origin for children */}
                  <circle cx={midX} cy={midY} r={5} fill="#4a7c59" opacity="0.7" />
                </g>
              )
            })}

            {/* Nodes */}
            {nodes.map(node => {
              const isShepherd = node.role === 'shepherd'
              const color = isShepherd ? '#4a7c59' : '#6b7280'
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

                  {isShepherd && !node.warning && <circle cx={NODE_W - 10} cy={10} r={4} fill={health} />}
                  {node.warning && (
                    <g transform={`translate(${NODE_W - 16}, 4)`}>
                      <polygon points="6,0 12,11 0,11" fill="#c17f3e" />
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

        {/* ── Floating controls (right side, map-style stacked circles) ── */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 flex flex-col items-center gap-2.5 z-40 filter-dropdown">
          {/* Filter button */}
          <button onClick={() => setFilterOpen(!filterOpen)}
            className="w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-gray-50 transition-colors relative"
            style={{ borderColor: 'var(--border)' }}
            title="Filter">
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

          {/* Zoom in */}
          <button onClick={zoomIn}
            className="w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-gray-50 transition-colors text-lg font-bold"
            style={{ borderColor: 'var(--border)', color: '#6b7280' }}
            title="Zoom in">+</button>

          {/* Zoom out */}
          <button onClick={zoomOut}
            className="w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-gray-50 transition-colors text-lg font-bold"
            style={{ borderColor: 'var(--border)', color: '#6b7280' }}
            title="Zoom out">-</button>

          {/* Fit all */}
          <button onClick={fitAll}
            className="w-11 h-11 rounded-full bg-white shadow-lg border flex items-center justify-center hover:bg-gray-50 transition-colors"
            style={{ borderColor: 'var(--border)' }}
            title="Fit all">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#6b7280" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
            </svg>
          </button>

          {/* Zoom level indicator */}
          <span className="text-[10px] sans font-medium" style={{ color: 'var(--muted-foreground)' }}>
            {Math.round(transform.scale * 100)}%
          </span>
        </div>

        {/* ── Filter panel (opens from floating button) ── */}
        {filterOpen && (
          <div className="absolute right-[72px] top-1/2 -translate-y-1/2 w-72 bg-white rounded-2xl shadow-2xl border z-50 filter-dropdown overflow-hidden"
            style={{ borderColor: 'var(--border)' }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-4 pb-2">
              <span className="font-serif text-sm" style={{ color: 'var(--primary)' }}>Filter Tree</span>
              <button onClick={() => setFilterOpen(false)}
                className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
            </div>

            {/* Tabs */}
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

            {/* Checkbox list */}
            <div className="px-4 pb-2 max-h-56 overflow-y-auto">
              {filterTab === 'groups' && (
                <>
                  {/* Select All */}
                  {trackedGroupTypes.length > 0 && (
                    <label className="flex items-center gap-2.5 px-1 py-1.5 cursor-pointer hover:bg-gray-50 rounded border-b mb-1 pb-2" style={{ borderColor: 'var(--border)' }}>
                      <input type="checkbox"
                        checked={hiddenGroupTypes.size === 0}
                        ref={el => { if (el) el.indeterminate = hiddenGroupTypes.size > 0 && hiddenGroupTypes.size < trackedGroupTypes.length }}
                        onChange={() => {
                          if (hiddenGroupTypes.size === 0) {
                            setHiddenGroupTypes(new Set(trackedGroupTypes.map(gt => gt.id)))
                          } else {
                            setHiddenGroupTypes(new Set())
                          }
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
                          if (hiddenServiceTypes.size === 0) {
                            setHiddenServiceTypes(new Set(trackedServiceTypes.map(st => st.id)))
                          } else {
                            setHiddenServiceTypes(new Set())
                          }
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

            {/* Footer actions */}
            <div className="px-4 py-3 border-t flex items-center justify-between" style={{ borderColor: 'var(--border)', background: 'var(--muted)' }}>
              <div className="flex items-center gap-2">
                <button onClick={resetToDefault}
                  className="text-[11px] sans font-medium px-2.5 py-1 rounded-lg border hover:bg-white transition-colors"
                  style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
                  {hasDefaultFilter ? 'Reset to Default' : 'Show All'}
                </button>
              </div>
              <button onClick={() => { saveDefaultFilter(); setFilterOpen(false) }}
                className="text-[11px] sans font-medium px-2.5 py-1 rounded-lg transition-colors"
                style={{ background: 'var(--primary)', color: 'white' }}>
                Set as Default
              </button>
            </div>
          </div>
        )}

        {/* ── Detail panel (right side) ── */}
        {selected && (() => {
          const isShepherd = selected.role === 'shepherd'
          const detailColor = isShepherd ? '#4a7c59' : '#6b7280'
          const initials = selected.name.split(' ').map((p: string) => p[0]).join('').slice(0, 2).toUpperCase()
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

              <div className="flex items-center gap-2 mb-3">
                <span className="inline-block text-xs sans px-2.5 py-1 rounded-full font-medium"
                  style={{ background: detailColor + '15', color: detailColor }}>
                  {isShepherd ? 'Shepherd' : 'Member'}
                </span>
                {selected.warning && (
                  <span className="inline-block text-xs sans px-2.5 py-1 rounded-full font-medium"
                    style={{ background: '#fef3cd', color: '#856404' }}>{selected.warning}</span>
                )}
              </div>

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
                <button
                  onClick={() => setModal({ type: 'add_to_flock', personId: realId(selected), personName: selected.name })}
                  className="w-full text-center text-xs sans py-2 rounded-lg font-medium"
                  style={{ background: 'var(--primary)', color: 'white' }}>
                  Add Sheep to Flock
                </button>
                <button
                  onClick={() => setModal({ type: 'assign_shepherd', personId: realId(selected), personName: selected.name })}
                  className="w-full text-center text-xs sans py-2 rounded-lg font-medium border"
                  style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>
                  Assign Shepherd Above
                </button>
                {isShepherd && (
                  <a href={`/checkins?shepherd=${realId(selected)}`}
                    className="w-full text-center text-xs sans py-2 rounded-lg font-medium border"
                    style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}>
                    View Check-ins
                  </a>
                )}
                {['super_admin', 'staff'].includes(currentUserRole || '') && (
                  <button
                    onClick={() => removeFromTree(realId(selected), selected.name)}
                    className="w-full text-center text-xs sans py-2 rounded-lg font-medium border mt-1"
                    style={{ borderColor: 'var(--danger, #9b3a3a)', color: 'var(--danger, #9b3a3a)' }}>
                    Remove from Tree
                  </button>
                )}
              </div>
            </div>
          )
        })()}

        {/* ══════════════════════════════════════════════════════
            MODAL: Add to Flock
           ══════════════════════════════════════════════════════ */}
        {modal?.type === 'add_to_flock' && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="w-[440px] bg-white rounded-2xl shadow-xl border p-5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-serif text-base" style={{ color: 'var(--primary)' }}>
                  Add sheep under {modal.personName}
                </h3>
                <button onClick={closeModal} className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
              </div>

              <div className="flex rounded-lg overflow-hidden border mb-3" style={{ borderColor: 'var(--border)' }}>
                {([
                  { key: 'person' as const, label: 'Person' },
                  { key: 'group_type' as const, label: 'Group Type' },
                  { key: 'service_type' as const, label: 'Service Type' },
                ]).map(tab => (
                  <button key={tab.key} onClick={() => setAssignTab(tab.key)}
                    className="flex-1 px-2 py-1.5 text-xs font-medium sans transition-colors"
                    style={{ background: assignTab === tab.key ? 'var(--primary)' : 'white', color: assignTab === tab.key ? 'white' : 'var(--muted-foreground)' }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {assignTab === 'person' && (
                <>
                  <input type="text" placeholder="Search by name..." value={searchTerm}
                    onChange={e => setSearchTerm(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg border text-sm sans mb-3"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }} autoFocus />
                  <div className="max-h-56 overflow-y-auto space-y-1">
                    {allNodes
                      .filter(n => searchTerm && n.name.toLowerCase().includes(searchTerm.toLowerCase()) && realId(n) !== modal.personId)
                      .filter((n, i, arr) => arr.findIndex(x => realId(x) === realId(n)) === i)
                      .slice(0, 10)
                      .map(n => (
                        <button key={n.id} onClick={() => assignShepherd(realId(n), modal.personId)}
                          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors">
                          <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium sans shrink-0"
                            style={{ background: '#6b728018', color: '#6b7280' }}>
                            {n.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm sans font-medium" style={{ color: 'var(--foreground)' }}>{n.name}</div>
                            <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>{n.contextLabel || 'Person'}</div>
                          </div>
                        </button>
                      ))}
                    {!searchTerm && <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>Type a name to search</p>}
                    {searchTerm && allNodes.filter(n => n.name.toLowerCase().includes(searchTerm.toLowerCase()) && realId(n) !== modal.personId).length === 0 && (
                      <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>No matches found</p>
                    )}
                  </div>
                </>
              )}

              {assignTab === 'group_type' && (
                <div className="max-h-64 overflow-y-auto space-y-1">
                  <p className="text-xs sans mb-2" style={{ color: 'var(--muted-foreground)' }}>
                    Make {modal.personName} the shepherd over all members of a group type
                  </p>
                  {groupTypes.map(gt => (
                    <button key={gt.id} disabled={bulkAssigning}
                      onClick={() => bulkAssignShepherd(modal.personId, 'group_type_id', gt.id, gt.name)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-50 transition-colors">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold sans shrink-0"
                        style={{ background: '#4a7c5918', color: '#4a7c59' }}>G</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm sans font-medium truncate" style={{ color: 'var(--foreground)' }}>{gt.name}</div>
                        <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>{gt.is_tracked ? 'Tracked' : 'Not tracked'}</div>
                      </div>
                      {bulkAssigning && <span className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Assigning...</span>}
                    </button>
                  ))}
                </div>
              )}

              {assignTab === 'service_type' && (
                <div className="max-h-64 overflow-y-auto space-y-1">
                  <p className="text-xs sans mb-2" style={{ color: 'var(--muted-foreground)' }}>
                    Make {modal.personName} the shepherd over all members of a service type
                  </p>
                  {serviceTypes.map(st => (
                    <button key={st.id} disabled={bulkAssigning}
                      onClick={() => bulkAssignShepherd(modal.personId, 'service_type_id', st.id, st.name)}
                      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left hover:bg-gray-50 transition-colors">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-bold sans shrink-0"
                        style={{ background: '#3b6ea518', color: '#3b6ea5' }}>S</div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm sans font-medium truncate" style={{ color: 'var(--foreground)' }}>{st.name}</div>
                        <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Service Type</div>
                      </div>
                      {bulkAssigning && <span className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Assigning...</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            MODAL: Assign Shepherd Above
           ══════════════════════════════════════════════════════ */}
        {modal?.type === 'assign_shepherd' && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="w-[440px] bg-white rounded-2xl shadow-xl border p-5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-serif text-base" style={{ color: 'var(--primary)' }}>
                  Assign shepherd over {modal.personName}
                </h3>
                <button onClick={closeModal} className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
              </div>
              <input type="text" placeholder="Search for a shepherd..." value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm sans mb-3"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }} autoFocus />
              <div className="max-h-56 overflow-y-auto space-y-1">
                {allNodes
                  .filter(n => searchTerm && n.name.toLowerCase().includes(searchTerm.toLowerCase()) && realId(n) !== modal.personId)
                  .filter((n, i, arr) => arr.findIndex(x => realId(x) === realId(n)) === i)
                  .slice(0, 10)
                  .map(n => (
                    <button key={n.id} onClick={() => assignShepherd(modal.personId, realId(n))}
                      className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left hover:bg-gray-50 transition-colors">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium sans shrink-0"
                        style={{ background: n.role === 'shepherd' ? '#4a7c5918' : '#6b728018', color: n.role === 'shepherd' ? '#4a7c59' : '#6b7280' }}>
                        {n.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-sm sans font-medium" style={{ color: 'var(--foreground)' }}>{n.name}</div>
                        <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>
                          {n.contextLabel || (n.role === 'shepherd' ? 'Shepherd' : 'Person')}
                        </div>
                      </div>
                    </button>
                  ))}
                {!searchTerm && <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>Type a name to search</p>}
                {searchTerm && allNodes.filter(n => n.name.toLowerCase().includes(searchTerm.toLowerCase()) && realId(n) !== modal.personId).length === 0 && (
                  <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>No matches found</p>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ══════════════════════════════════════════════════════
            MODAL: Add Person to Tree
           ══════════════════════════════════════════════════════ */}
        {modal?.type === 'add_person' && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="w-[560px] bg-white rounded-2xl shadow-xl border p-5" style={{ borderColor: 'var(--border)' }}>
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-serif text-base" style={{ color: 'var(--primary)' }}>Add Person to Tree</h3>
                <button onClick={closeModal} className="text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
              </div>

              <p className="text-xs sans mb-3" style={{ color: 'var(--muted-foreground)' }}>
                Search for anyone, then choose how to place them in the tree.
              </p>
              <input type="text" placeholder="Search by name..." value={addSearch}
                onChange={e => setAddSearch(e.target.value)}
                className="w-full px-3 py-2 rounded-lg border text-sm sans mb-3"
                style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }} autoFocus />

              <div className="flex rounded-lg overflow-hidden border mb-3" style={{ borderColor: 'var(--border)' }}>
                {([
                  { key: 'root' as const, label: 'As Root' },
                  { key: 'under_shepherd' as const, label: 'Under Shepherd' },
                  { key: 'over_group_type' as const, label: 'Over Group Type' },
                  { key: 'over_service_type' as const, label: 'Over Service Type' },
                ]).map(tab => (
                  <button key={tab.key} onClick={() => setAddPlacement(tab.key)}
                    className="flex-1 px-1.5 py-1.5 text-[11px] font-medium sans transition-colors"
                    style={{ background: addPlacement === tab.key ? 'var(--primary)' : 'white', color: addPlacement === tab.key ? 'white' : 'var(--muted-foreground)' }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="max-h-64 overflow-y-auto space-y-1">
                {addResults.map(p => {
                  const alreadyInTree = allNodes.some(n => (n.personId || n.id) === p.id)
                  return (
                    <div key={p.id} className="flex items-center gap-3 px-3 py-2.5 rounded-lg"
                      style={{ background: alreadyInTree ? 'var(--muted)' : 'white' }}>
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium sans shrink-0"
                        style={{ background: '#4a7c5918', color: '#4a7c59' }}>
                        {p.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm sans font-medium" style={{ color: 'var(--foreground)' }}>{p.name}</div>
                        {alreadyInTree && <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>Already in tree</div>}
                      </div>

                      <div className="shrink-0">
                        {addPlacement === 'root' && (
                          <button onClick={() => addAsRoot(p.id)}
                            className="text-xs sans px-3 py-1.5 rounded font-medium"
                            style={{ background: 'var(--primary)', color: 'white' }}>
                            Add as Root
                          </button>
                        )}

                        {addPlacement === 'under_shepherd' && (
                          <select className="text-xs sans px-2 py-1.5 rounded border w-[200px]"
                            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                            defaultValue="" onChange={e => { if (e.target.value) addUnderShepherd(p.id, e.target.value) }}>
                            <option value="" disabled>Select shepherd...</option>
                            {shepherdOptions.map(n => (
                              <option key={realId(n)} value={realId(n)}>{n.name}</option>
                            ))}
                          </select>
                        )}

                        {addPlacement === 'over_group_type' && (
                          <select className="text-xs sans px-2 py-1.5 rounded border w-[200px]"
                            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                            defaultValue="" onChange={e => { if (e.target.value) bulkAssignShepherd(p.id, 'group_type_id', e.target.value, groupTypes.find(g => g.id === e.target.value)?.name || '') }}>
                            <option value="" disabled>Select group type...</option>
                            {groupTypes.map(gt => (
                              <option key={gt.id} value={gt.id}>{gt.name}</option>
                            ))}
                          </select>
                        )}

                        {addPlacement === 'over_service_type' && (
                          <select className="text-xs sans px-2 py-1.5 rounded border w-[200px]"
                            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                            defaultValue="" onChange={e => { if (e.target.value) bulkAssignShepherd(p.id, 'service_type_id', e.target.value, serviceTypes.find(s => s.id === e.target.value)?.name || '') }}>
                            <option value="" disabled>Select service type...</option>
                            {serviceTypes.map(st => (
                              <option key={st.id} value={st.id}>{st.name}</option>
                            ))}
                          </select>
                        )}
                      </div>
                    </div>
                  )
                })}
                {addSearch.length >= 2 && addResults.length === 0 && (
                  <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>No matches</p>
                )}
                {addSearch.length < 2 && (
                  <p className="text-xs sans text-center py-4" style={{ color: 'var(--muted-foreground)' }}>Type at least 2 characters to search</p>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
