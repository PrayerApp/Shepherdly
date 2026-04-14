'use client'

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'

// ── Types ──────────────────────────────────────────────────────
interface Layer {
  id: string
  name: string
  category: 'elder' | 'staff' | 'volunteer'
  rank: number
}

interface TreeNode {
  id: string
  personId?: string
  name: string
  layerId: string
  layerCategory: string
  supervisorId: string | null
  isPlaceholder?: boolean
  contextLabel: string | null
  isLeadPastor?: boolean
  isStaff?: boolean
  warning?: string | null
}

interface LayoutNode extends TreeNode {
  x: number
  y: number
  children: LayoutNode[]
  depth: number
}

// ── Constants ──────────────────────────────────────────────────
const NODE_W = 220
const NODE_H = 72
const H_GAP = 40
const V_GAP = 100

const BAND_COLORS: Record<string, string> = {
  elder: 'rgba(234, 222, 140, 0.22)',
  staff: 'rgba(147, 180, 220, 0.22)',
  volunteer: 'rgba(140, 210, 160, 0.22)',
}
const BAND_LABEL_COLORS: Record<string, string> = {
  elder: '#8a7a20',
  staff: '#3b6ea5',
  volunteer: '#3a7a4a',
}
const NODE_COLORS: Record<string, string> = {
  elder: '#7c3aed',
  staff: '#3b6ea5',
  volunteer: '#4a7c59',
}

// ── Layout ─────────────────────────────────────────────────────
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
    return Math.max(NODE_W, childWidths.reduce((a, b) => a + b, 0) + H_GAP * (node.children.length - 1))
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

function getAllEdges(nodes: LayoutNode[]): { from: LayoutNode; to: LayoutNode }[] {
  const edges: { from: LayoutNode; to: LayoutNode }[] = []
  const map = new Map(nodes.map(n => [n.id, n]))
  for (const n of nodes) {
    if (n.supervisorId && map.has(n.supervisorId)) {
      edges.push({ from: map.get(n.supervisorId)!, to: n })
    }
  }
  return edges
}

// ── Component ──────────────────────────────────────────────────
export default function ShepherdTree() {
  // Data
  const [layers, setLayers] = useState<Layer[]>([])
  const [allNodes, setAllNodes] = useState<TreeNode[]>([])
  const [nodes, setNodes] = useState<LayoutNode[]>([])
  const [edges, setEdges] = useState<{ from: LayoutNode; to: LayoutNode }[]>([])
  const [currentUserRole, setCurrentUserRole] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // UI state
  const [selected, setSelected] = useState<LayoutNode | null>(null)
  const [activeParent, setActiveParent] = useState<{ personId: string; nodeId: string; layerId: string } | null>(null)
  const [panelCollapsed, setPanelCollapsed] = useState(true)

  // Pan & zoom
  const [transform, setTransform] = useState({ x: 0, y: 60, scale: 1 })
  const dragging = useRef(false)
  const lastPos = useRef({ x: 0, y: 0 })
  const initialLoadDone = useRef(false)
  const svgRef = useRef<SVGSVGElement>(null)

  const isAdmin = ['super_admin', 'staff'].includes(currentUserRole || '')
  const sortedLayers = useMemo(() => [...layers].sort((a, b) => a.rank - b.rank), [layers])

  // ── Fetch ────────────────────────────────────────────────────
  const fetchTree = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/tree')
      const data = await res.json()
      if (data.error) { setError(data.error); return }

      setLayers(data.layers || [])
      setAllNodes(data.nodes || [])
      setCurrentUserRole(data.currentUserRole || null)
    } catch (err) {
      setError('Failed to load tree')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchTree() }, [fetchTree])

  // ── Build layout from nodes ──────────────────────────────────
  useEffect(() => {
    if (allNodes.length === 0 && sortedLayers.length === 0) {
      setNodes([])
      setEdges([])
      return
    }

    // If we have real nodes from the API, use them
    let treeNodes: TreeNode[] = [...allNodes]

    // If there are no real nodes, create placeholder-only nodes from layers
    if (allNodes.length === 0 && sortedLayers.length > 0) {
      let prevPlaceholderId: string | null = null
      for (const layer of sortedLayers) {
        const phId = `placeholder-${layer.id}`
        treeNodes.push({
          id: phId,
          name: `+ ${layer.name}`,
          layerId: layer.id,
          layerCategory: layer.category,
          supervisorId: prevPlaceholderId,
          isPlaceholder: true,
          contextLabel: layer.name,
        })
        prevPlaceholderId = phId
      }
    }

    const laid = buildTree(treeNodes)
    setNodes(laid)
    setEdges(getAllEdges(laid))

    // Center on initial load
    if (laid.length > 0 && !initialLoadDone.current) {
      const minX = Math.min(...laid.map(n => n.x)) - NODE_W / 2
      const maxX = Math.max(...laid.map(n => n.x)) + NODE_W / 2
      const treeW = maxX - minX
      setTransform({ x: -minX - treeW / 2, y: 60, scale: 1 })
      initialLoadDone.current = true
    }
  }, [allNodes, sortedLayers])

  // ── Bands: compute from laid-out nodes ───────────────────────
  const layerBands = useMemo(() => {
    if (nodes.length === 0) return []

    const layerCatMap = new Map(sortedLayers.map(l => [l.id, l.category]))
    const layerNameMap = new Map(sortedLayers.map(l => [l.id, l.name]))

    // Group nodes by Y and determine category at each Y level
    const yInfo = new Map<number, { category: string; name: string }>()
    for (const n of nodes) {
      const cat = n.layerCategory || layerCatMap.get(n.layerId)
      if (!cat) continue
      if (!yInfo.has(n.y)) {
        yInfo.set(n.y, { category: cat, name: layerNameMap.get(n.layerId) || cat })
      }
    }

    if (yInfo.size === 0) return []

    // Tree X extent
    const allX = nodes.map(n => n.x)
    const minX = Math.min(...allX) - NODE_W * 2
    const maxX = Math.max(...allX) + NODE_W * 2
    const width = maxX - minX

    // Build bands from Y levels, merging same-category adjacents
    const yLevels = [...yInfo.entries()].sort((a, b) => a[0] - b[0])
    const PAD = V_GAP / 2

    const bands: { y: number; height: number; category: string; label: string; x: number; width: number }[] = []
    for (let i = 0; i < yLevels.length; i++) {
      const [y, { category, name }] = yLevels[i]
      const top = y - PAD
      const bottom = i < yLevels.length - 1
        ? y + (yLevels[i + 1][0] - y) / 2
        : y + NODE_H + PAD

      if (bands.length > 0 && bands[bands.length - 1].category === category) {
        // Merge with previous band of same category
        bands[bands.length - 1].height = bottom - bands[bands.length - 1].y
      } else {
        bands.push({ y: top, height: bottom - top, category, label: name, x: minX, width })
      }
    }
    return bands
  }, [nodes, sortedLayers])

  // ── Pan / zoom ───────────────────────────────────────────────
  const onMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return
    dragging.current = true
    lastPos.current = { x: e.clientX, y: e.clientY }
  }
  const onMouseMove = (e: React.MouseEvent) => {
    if (!dragging.current) return
    const dx = e.clientX - lastPos.current.x
    const dy = e.clientY - lastPos.current.y
    lastPos.current = { x: e.clientX, y: e.clientY }
    setTransform(t => ({ ...t, x: t.x + dx / t.scale, y: t.y + dy }))
  }
  const onMouseUp = () => { dragging.current = false }
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault()
    const delta = e.deltaY > 0 ? 0.92 : 1.08
    setTransform(t => ({ ...t, scale: Math.max(0.15, Math.min(3, t.scale * delta)) }))
  }, [])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onWheel])

  // ── Render ───────────────────────────────────────────────────

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
      <p className="text-sm sans" style={{ color: 'var(--danger, #9b3a3a)' }}>{error}</p>
    </div>
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="shrink-0 border-b px-4 py-2 flex items-center justify-between" style={{ borderColor: 'var(--border)', background: 'white' }}>
        <h2 className="font-serif text-base" style={{ color: 'var(--primary)' }}>Shepherd Tree</h2>
        <div className="flex items-center gap-2">
          {sortedLayers.length > 0 && (
            <div className="flex items-center gap-1.5 text-[10px] sans" style={{ color: 'var(--muted-foreground)' }}>
              {sortedLayers.map(l => (
                <span key={l.id} className="px-2 py-0.5 rounded-full"
                  style={{ background: BAND_COLORS[l.category], color: BAND_LABEL_COLORS[l.category], fontWeight: 600 }}>
                  {l.name}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Tree canvas ── */}
      <div className="flex-1 relative overflow-hidden" style={{ background: 'var(--muted)', touchAction: 'none' }}>
        <svg ref={svgRef}
          className="w-full h-full cursor-grab active:cursor-grabbing select-none"
          onMouseDown={onMouseDown} onMouseMove={onMouseMove} onMouseUp={onMouseUp} onMouseLeave={onMouseUp}>
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="var(--border)" strokeWidth="0.5" opacity="0.5" />
            </pattern>
            <filter id="shadow"><feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.08" /></filter>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          <g transform={`translate(${(svgRef.current?.clientWidth ?? 800) / 2 + transform.x * transform.scale}, ${transform.y}) scale(${transform.scale})`}>
            {/* Layer bands */}
            {layerBands.map((band, i) => (
              <g key={`band-${i}`}>
                <rect x={band.x} y={band.y} width={band.width} height={band.height}
                  fill={BAND_COLORS[band.category] || 'rgba(200,200,200,0.1)'} rx={12} />
                <text x={band.x + 16} y={band.y + 20}
                  fontSize={11} fontWeight="700" fontFamily="system-ui" letterSpacing="1"
                  fill={BAND_LABEL_COLORS[band.category] || '#888'} opacity="0.6">
                  {band.label.toUpperCase()}
                </text>
              </g>
            ))}

            {/* Edges */}
            {edges.map(({ from, to }) => {
              const fx = from.x, fy = from.y + NODE_H
              const tx = to.x, ty = to.y
              const my = (fy + ty) / 2
              return (
                <path key={`${from.id}-${to.id}`}
                  d={`M ${fx} ${fy} C ${fx} ${my}, ${tx} ${my}, ${tx} ${ty}`}
                  fill="none" stroke="var(--border)" strokeWidth="1.5" />
              )
            })}

            {/* Nodes */}
            {nodes.map(node => {
              const color = NODE_COLORS[node.layerCategory] || '#6b7280'

              // ── Placeholder ──
              if (node.isPlaceholder) {
                return (
                  <g key={node.id} className="tree-node"
                    transform={`translate(${node.x - NODE_W / 2}, ${node.y})`}
                    style={{ cursor: isAdmin ? 'pointer' : 'default' }}
                    onClick={() => {
                      if (!isAdmin) return
                      setActiveParent({
                        personId: '',
                        nodeId: node.id,
                        layerId: node.layerId || '',
                      })
                      setPanelCollapsed(false)
                    }}>
                    <rect x={0} y={0} width={NODE_W} height={NODE_H} rx={10}
                      fill="white" stroke={color} strokeWidth="1.5"
                      strokeDasharray="6 4" opacity="0.6" />
                    <text x={NODE_W / 2} y={NODE_H / 2 - 4} textAnchor="middle"
                      fontSize={18} fontWeight="300" fontFamily="system-ui" fill={color} opacity="0.7">
                      +
                    </text>
                    <text x={NODE_W / 2} y={NODE_H / 2 + 14} textAnchor="middle"
                      fontSize={10} fontFamily="system-ui" fill={color} opacity="0.6">
                      {node.contextLabel}
                    </text>
                  </g>
                )
              }

              // ── Regular node ──
              const initials = node.name.split(' ').map((w: string) => w[0]).join('').slice(0, 2).toUpperCase()
              const isSelected = selected?.id === node.id

              return (
                <g key={node.id} className="tree-node"
                  transform={`translate(${node.x - NODE_W / 2}, ${node.y})`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelected(isSelected ? null : node)}>
                  <rect x={0} y={0} width={NODE_W} height={NODE_H} rx={10}
                    fill="white"
                    stroke={isSelected ? color : 'var(--border)'}
                    strokeWidth={isSelected ? 2.5 : 1} filter="url(#shadow)" />
                  {/* Left color bar */}
                  <rect x={0} y={0} width={4} height={NODE_H} rx={2}
                    fill={color} style={{ clipPath: 'inset(0 0 0 0 round 10px 0 0 10px)' }} />

                  {/* Avatar */}
                  <circle cx={28} cy={NODE_H / 2} r={18} fill={color + '18'} />
                  <text x={28} y={NODE_H / 2 + 1} textAnchor="middle" dominantBaseline="middle"
                    fontSize={11} fontWeight="600" fontFamily="system-ui" fill={color}>
                    {initials}
                  </text>

                  {/* Name + context */}
                  <text x={52} y={NODE_H / 2 - 6}
                    fontSize={12} fontWeight="600" fontFamily="Georgia, serif"
                    fill="var(--foreground)">
                    {node.name.length > 22 ? node.name.slice(0, 22) + '…' : node.name}
                  </text>
                  <text x={52} y={NODE_H / 2 + 10}
                    fontSize={10} fontFamily="system-ui" fill="var(--muted-foreground)">
                    {node.contextLabel ? node.contextLabel.slice(0, 30) : ''}
                  </text>

                  {/* Lead Pastor badge */}
                  {node.isLeadPastor && (
                    <g transform={`translate(${NODE_W - 82}, ${NODE_H - 16})`}>
                      <rect x={0} y={0} width={74} height={14} rx={3} fill="#7c3aed" opacity="0.85" />
                      <text x={37} y={10} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="system-ui" fill="white">LEAD PASTOR</text>
                    </g>
                  )}

                  {/* Staff badge */}
                  {node.isStaff && !node.isLeadPastor && node.layerCategory === 'staff' && (
                    <g transform={`translate(${NODE_W - 44}, ${NODE_H - 16})`}>
                      <rect x={0} y={0} width={36} height={14} rx={3} fill="#3b6ea5" opacity="0.85" />
                      <text x={18} y={10} textAnchor="middle" fontSize={8} fontWeight="700" fontFamily="system-ui" fill="white">STAFF</text>
                    </g>
                  )}

                  {/* Warning triangle */}
                  {node.warning && (
                    <g transform={`translate(${NODE_W - 16}, 4)`}>
                      <polygon points="6,0 12,11 0,11" fill="#9b3a3a" />
                      <text x={6} y={9} textAnchor="middle" fontSize={8} fontWeight="700" fill="white">!</text>
                    </g>
                  )}
                </g>
              )
            })}
          </g>
        </svg>

        {/* Zoom controls */}
        <div className="absolute right-4 bottom-4 flex flex-col gap-1.5 z-40">
          <button onClick={() => setTransform(t => ({ ...t, scale: Math.min(3, t.scale * 1.2) }))}
            className="w-9 h-9 rounded-lg bg-white shadow border flex items-center justify-center text-sm font-bold"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>+</button>
          <button onClick={() => setTransform(t => ({ ...t, scale: Math.max(0.15, t.scale * 0.83) }))}
            className="w-9 h-9 rounded-lg bg-white shadow border flex items-center justify-center text-sm font-bold"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>−</button>
          <button onClick={() => {
            initialLoadDone.current = false
            const laid = buildTree(allNodes.length > 0 ? allNodes : [])
            if (laid.length > 0) {
              const minX = Math.min(...laid.map(n => n.x)) - NODE_W / 2
              const maxX = Math.max(...laid.map(n => n.x)) + NODE_W / 2
              const treeW = maxX - minX
              setTransform({ x: -minX - treeW / 2, y: 60, scale: 1 })
              initialLoadDone.current = true
            }
          }}
            className="w-9 h-9 rounded-lg bg-white shadow border flex items-center justify-center text-[10px] font-bold sans"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}>⌂</button>
        </div>
      </div>

      {/* ── Bottom Panel (placeholder for future) ── */}
      {isAdmin && (
        <div className="shrink-0 border-t bg-white" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center justify-between px-4 py-2">
            <button onClick={() => setPanelCollapsed(!panelCollapsed)}
              className="text-xs sans font-medium" style={{ color: 'var(--primary)' }}>
              {panelCollapsed ? '▸' : '▾'} Unassigned
            </button>
            {activeParent && (
              <div className="flex items-center gap-2 text-[11px] sans" style={{ color: 'var(--muted-foreground)' }}>
                Assigning to layer: <span className="font-semibold" style={{ color: 'var(--foreground)' }}>
                  {sortedLayers.find(l => l.id === activeParent.layerId)?.name || '—'}
                </span>
                <button onClick={() => setActiveParent(null)} className="text-xs" style={{ color: '#9b3a3a' }}>×</button>
              </div>
            )}
          </div>
          {!panelCollapsed && (
            <div className="px-4 py-3 overflow-x-auto" style={{ borderTop: '1px solid var(--border)' }}>
              <p className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>
                Click a placeholder in the tree to start assigning people.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
