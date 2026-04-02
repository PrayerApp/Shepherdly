'use client'

import { useEffect, useRef, useState, useCallback } from 'react'

const ROLE_COLORS: Record<string, string> = {
  super_admin: '#6b4c2a',
  staff:       '#4a7c59',
  coach:       '#3a5f8a',
  leader:      '#7a4f9e',
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Admin',
  staff:       'Staff',
  coach:       'Coach',
  leader:      'Leader',
}

interface TreeNode {
  id: string
  name: string
  email: string
  role: string
  supervisorId: string | null
  flockCount: number
  lastCheckin: string | null
  isCurrentUser: boolean
}

interface LayoutNode extends TreeNode {
  x: number
  y: number
  children: LayoutNode[]
}

const NODE_W = 160
const NODE_H = 72
const H_GAP = 32
const V_GAP = 90

// Build tree layout using Reingold-Tilford-inspired algorithm
function buildLayout(nodes: TreeNode[]): { roots: LayoutNode[]; allNodes: LayoutNode[]; width: number; height: number } {
  const nodeMap = new Map<string, LayoutNode>()
  nodes.forEach(n => nodeMap.set(n.id, { ...n, x: 0, y: 0, children: [] }))

  const roots: LayoutNode[] = []
  nodeMap.forEach(n => {
    if (n.supervisorId && nodeMap.has(n.supervisorId)) {
      nodeMap.get(n.supervisorId)!.children.push(n)
    } else {
      roots.push(n)
    }
  })

  // Compute subtree widths bottom-up
  function subtreeWidth(node: LayoutNode): number {
    if (node.children.length === 0) return NODE_W
    const childTotal = node.children.reduce((sum, c) => sum + subtreeWidth(c) + H_GAP, -H_GAP)
    return Math.max(NODE_W, childTotal)
  }

  // Assign x,y positions
  function assignPos(node: LayoutNode, x: number, y: number) {
    node.y = y
    if (node.children.length === 0) {
      node.x = x
      return
    }
    const totalW = node.children.reduce((sum, c) => sum + subtreeWidth(c) + H_GAP, -H_GAP)
    node.x = x + totalW / 2 - NODE_W / 2
    let cx = x
    node.children.forEach(child => {
      const sw = subtreeWidth(child)
      assignPos(child, cx + sw / 2 - NODE_W / 2, y + NODE_H + V_GAP)
      cx += sw + H_GAP
    })
  }

  let offsetX = 0
  roots.forEach(root => {
    const sw = subtreeWidth(root)
    assignPos(root, offsetX, 0)
    offsetX += sw + H_GAP * 4
  })

  const allNodes = Array.from(nodeMap.values())
  const maxX = allNodes.reduce((m, n) => Math.max(m, n.x + NODE_W), 0)
  const maxY = allNodes.reduce((m, n) => Math.max(m, n.y + NODE_H), 0)

  return { roots, allNodes, width: maxX + 60, height: maxY + 60 }
}

// Collect all edges
function collectEdges(nodes: LayoutNode[]): { x1: number; y1: number; x2: number; y2: number; id: string }[] {
  const edges: { x1: number; y1: number; x2: number; y2: number; id: string }[] = []
  function traverse(node: LayoutNode) {
    node.children.forEach(child => {
      edges.push({
        x1: node.x + NODE_W / 2,
        y1: node.y + NODE_H,
        x2: child.x + NODE_W / 2,
        y2: child.y,
        id: `${node.id}-${child.id}`,
      })
      traverse(child)
    })
  }
  nodes.forEach(traverse)
  return edges
}

function healthColor(lastCheckin: string | null, flockCount: number): string {
  if (flockCount === 0) return '#94a3b8'
  if (!lastCheckin) return '#ef4444'
  const days = (Date.now() - new Date(lastCheckin).getTime()) / (1000 * 60 * 60 * 24)
  if (days <= 14) return '#4a7c59'
  if (days <= 30) return '#c17f3e'
  return '#ef4444'
}

function healthLabel(lastCheckin: string | null, flockCount: number): string {
  if (flockCount === 0) return 'No flock'
  if (!lastCheckin) return 'No check-ins'
  const days = Math.floor((Date.now() - new Date(lastCheckin).getTime()) / (1000 * 60 * 60 * 24))
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return `${days}d ago`
}

export default function ShepherdTree() {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const [nodes, setNodes] = useState<TreeNode[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<LayoutNode | null>(null)
  const [layout, setLayout] = useState<{ roots: LayoutNode[]; allNodes: LayoutNode[]; width: number; height: number } | null>(null)
  const [transform, setTransform] = useState({ x: 40, y: 40, scale: 1 })
  const [dragging, setDragging] = useState(false)
  const dragStart = useRef({ x: 0, y: 0, tx: 0, ty: 0 })
  const [searchTerm, setSearchTerm] = useState('')
  const [highlightedId, setHighlightedId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/tree')
      .then(r => r.json())
      .then(data => {
        setNodes(data.nodes || [])
        setLoading(false)
      })
  }, [])

  useEffect(() => {
    if (nodes.length > 0) {
      const l = buildLayout(nodes)
      setLayout(l)
      // Auto-center
      if (containerRef.current) {
        const cw = containerRef.current.clientWidth
        const scale = Math.min(1, (cw - 80) / l.width)
        setTransform({ x: (cw - l.width * scale) / 2, y: 40, scale })
      }
    }
  }, [nodes])

  // Pan
  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if ((e.target as Element).closest('.tree-node')) return
    setDragging(true)
    dragStart.current = { x: e.clientX, y: e.clientY, tx: transform.x, ty: transform.y }
  }, [transform])

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging) return
    setTransform(t => ({
      ...t,
      x: dragStart.current.tx + e.clientX - dragStart.current.x,
      y: dragStart.current.ty + e.clientY - dragStart.current.y,
    }))
  }, [dragging])

  const onMouseUp = useCallback(() => setDragging(false), [])

  // Zoom
  const onWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault()
    const factor = e.deltaY < 0 ? 1.1 : 0.9
    setTransform(t => {
      const newScale = Math.max(0.2, Math.min(2, t.scale * factor))
      // Zoom toward cursor
      const rect = containerRef.current!.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      return {
        scale: newScale,
        x: cx - (cx - t.x) * (newScale / t.scale),
        y: cy - (cy - t.y) * (newScale / t.scale),
      }
    })
  }, [])

  // Search highlight
  useEffect(() => {
    if (!searchTerm || !layout) { setHighlightedId(null); return }
    const match = layout.allNodes.find(n =>
      n.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      n.email.toLowerCase().includes(searchTerm.toLowerCase())
    )
    if (match) {
      setHighlightedId(match.id)
      // Pan to the matched node
      if (containerRef.current) {
        const cw = containerRef.current.clientWidth
        const ch = containerRef.current.clientHeight
        setTransform(t => ({
          ...t,
          x: cw / 2 - (match.x + NODE_W / 2) * t.scale,
          y: ch / 2 - (match.y + NODE_H / 2) * t.scale,
        }))
      }
    } else {
      setHighlightedId(null)
    }
  }, [searchTerm, layout])

  const edges = layout ? collectEdges(layout.roots) : []

  const zoomIn = () => setTransform(t => ({ ...t, scale: Math.min(2, t.scale * 1.2) }))
  const zoomOut = () => setTransform(t => ({ ...t, scale: Math.max(0.2, t.scale / 1.2) }))
  const resetView = () => {
    if (!layout || !containerRef.current) return
    const cw = containerRef.current.clientWidth
    const scale = Math.min(1, (cw - 80) / layout.width)
    setTransform({ x: (cw - layout.width * scale) / 2, y: 40, scale })
  }

  return (
    <div className="relative w-full h-full" style={{ background: 'var(--muted)' }}>
      {/* Toolbar */}
      <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
        <div className="bg-white rounded-xl border shadow-sm px-3 py-2 flex items-center gap-2"
          style={{ borderColor: 'var(--border)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--muted-foreground)" strokeWidth="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search people…"
            className="sans text-sm outline-none w-36"
            style={{ color: 'var(--foreground)', background: 'transparent' }}
          />
        </div>
      </div>

      {/* Zoom controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-1">
        {[
          { label: '+', action: zoomIn },
          { label: '−', action: zoomOut },
          { label: '⊙', action: resetView },
        ].map(btn => (
          <button key={btn.label} onClick={btn.action}
            className="w-9 h-9 bg-white rounded-lg border shadow-sm text-lg flex items-center justify-center sans font-medium transition-colors hover:bg-muted"
            style={{ borderColor: 'var(--border)', color: 'var(--primary)' }}>
            {btn.label}
          </button>
        ))}
      </div>

      {/* Legend */}
      <div className="absolute bottom-4 left-4 z-10 bg-white rounded-xl border shadow-sm px-4 py-3"
        style={{ borderColor: 'var(--border)' }}>
        <div className="text-xs font-semibold sans uppercase tracking-wide mb-2"
          style={{ color: 'var(--muted-foreground)' }}>Roles</div>
        <div className="space-y-1.5">
          {Object.entries(ROLE_LABELS).map(([role, label]) => (
            <div key={role} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-sm" style={{ background: ROLE_COLORS[role] }} />
              <span className="text-xs sans" style={{ color: 'var(--foreground)' }}>{label}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
          <div className="text-xs font-semibold sans uppercase tracking-wide mb-2"
            style={{ color: 'var(--muted-foreground)' }}>Last Check-in</div>
          {[['#4a7c59', '≤ 2 weeks'], ['#c17f3e', '≤ 30 days'], ['#ef4444', 'Overdue']].map(([color, label]) => (
            <div key={label} className="flex items-center gap-2 mt-1.5">
              <div className="w-3 h-3 rounded-full" style={{ background: color }} />
              <span className="text-xs sans" style={{ color: 'var(--foreground)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Stats */}
      {layout && (
        <div className="absolute bottom-4 right-4 z-10 bg-white rounded-xl border shadow-sm px-4 py-3"
          style={{ borderColor: 'var(--border)' }}>
          <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>
            <span className="font-semibold" style={{ color: 'var(--primary)' }}>{layout.allNodes.length}</span> leaders
          </div>
        </div>
      )}

      {/* Canvas */}
      <div
        ref={containerRef}
        className="w-full h-full overflow-hidden"
        style={{ cursor: dragging ? 'grabbing' : 'grab' }}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
        onWheel={onWheel}
      >
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="text-sm sans" style={{ color: 'var(--muted-foreground)' }}>Loading shepherd tree…</div>
          </div>
        )}

        {!loading && layout && (
          <svg
            ref={svgRef}
            style={{ width: '100%', height: '100%', userSelect: 'none' }}
          >
            <defs>
              <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#2c2416" floodOpacity="0.08"/>
              </filter>
              <filter id="shadow-selected" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="4" stdDeviation="8" floodColor="#c17f3e" floodOpacity="0.3"/>
              </filter>
            </defs>

            <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
              {/* Edges */}
              {edges.map(e => (
                <path
                  key={e.id}
                  d={`M ${e.x1} ${e.y1} C ${e.x1} ${e.y1 + V_GAP * 0.5} ${e.x2} ${e.y2 - V_GAP * 0.5} ${e.x2} ${e.y2}`}
                  fill="none"
                  stroke="var(--border)"
                  strokeWidth="1.5"
                  strokeDasharray="none"
                />
              ))}

              {/* Nodes */}
              {layout.allNodes.map(node => {
                const color = ROLE_COLORS[node.role] || '#666'
                const isSelected = selected?.id === node.id
                const isHighlighted = highlightedId === node.id
                const hColor = healthColor(node.lastCheckin, node.flockCount)
                const dimmed = highlightedId && !isHighlighted && !isSelected

                return (
                  <g
                    key={node.id}
                    className="tree-node"
                    transform={`translate(${node.x}, ${node.y})`}
                    style={{ cursor: 'pointer', opacity: dimmed ? 0.3 : 1, transition: 'opacity 0.2s' }}
                    onClick={() => setSelected(isSelected ? null : node)}
                  >
                    {/* Card background */}
                    <rect
                      width={NODE_W}
                      height={NODE_H}
                      rx="10"
                      fill="white"
                      stroke={isSelected ? '#c17f3e' : isHighlighted ? '#c17f3e' : color + '30'}
                      strokeWidth={isSelected || isHighlighted ? 2 : 1}
                      filter={isSelected ? 'url(#shadow-selected)' : 'url(#shadow)'}
                    />

                    {/* Role color bar on left */}
                    <rect x="0" y="0" width="4" height={NODE_H} rx="10" fill={color} />
                    <rect x="0" y="10" width="4" height={NODE_H - 20} fill={color} />

                    {/* Avatar circle */}
                    <circle cx="30" cy={NODE_H / 2} r="18" fill={color + '15'} />
                    <text x="30" y={NODE_H / 2 + 5} textAnchor="middle"
                      style={{ fontSize: '14px', fontFamily: 'Georgia, serif', fill: color, fontWeight: '600' }}>
                      {node.name.charAt(0).toUpperCase()}
                    </text>

                    {/* Name */}
                    <text x="56" y="26"
                      style={{ fontSize: '12px', fontFamily: 'system-ui, sans-serif', fill: '#2c2416', fontWeight: '600' }}>
                      {node.name.length > 16 ? node.name.slice(0, 15) + '…' : node.name}
                    </text>

                    {/* Role badge */}
                    <rect x="56" y="32" width={ROLE_LABELS[node.role]?.length * 6.5 + 10 || 50} height="14" rx="4" fill={color + '15'} />
                    <text x="61" y="43"
                      style={{ fontSize: '9px', fontFamily: 'system-ui, sans-serif', fill: color, fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      {ROLE_LABELS[node.role] || node.role}
                    </text>

                    {/* Health dot + last checkin */}
                    <circle cx="56" cy="58" r="4" fill={hColor} />
                    <text x="65" y="62"
                      style={{ fontSize: '10px', fontFamily: 'system-ui, sans-serif', fill: '#7a6650' }}>
                      {healthLabel(node.lastCheckin, node.flockCount)}
                    </text>

                    {/* Flock count */}
                    {node.flockCount > 0 && (
                      <>
                        <text x={NODE_W - 8} y="22" textAnchor="end"
                          style={{ fontSize: '15px', fontFamily: 'Georgia, serif', fill: color, fontWeight: '700' }}>
                          {node.flockCount}
                        </text>
                        <text x={NODE_W - 8} y="32" textAnchor="end"
                          style={{ fontSize: '8px', fontFamily: 'system-ui, sans-serif', fill: '#7a6650' }}>
                          sheep
                        </text>
                      </>
                    )}

                    {/* Current user indicator */}
                    {node.isCurrentUser && (
                      <circle cx={NODE_W - 10} cy={NODE_H - 10} r="5" fill="#c17f3e" />
                    )}
                  </g>
                )
              })}
            </g>
          </svg>
        )}

        {!loading && (!layout || layout.allNodes.length === 0) && (
          <div className="flex flex-col items-center justify-center h-full gap-3">
            <div className="text-4xl">🌱</div>
            <p className="font-serif text-lg" style={{ color: 'var(--primary)' }}>No leaders yet</p>
            <p className="text-sm sans" style={{ color: 'var(--muted-foreground)' }}>
              Invite leaders from Settings → Manage Users to build your shepherd tree.
            </p>
          </div>
        )}
      </div>

      {/* Selected node detail panel */}
      {selected && (
        <div
          className="absolute right-4 top-16 z-20 bg-white rounded-2xl border shadow-xl w-72 overflow-hidden"
          style={{ borderColor: 'var(--border)' }}>
          {/* Header */}
          <div className="px-5 py-4 flex items-center gap-3"
            style={{ background: ROLE_COLORS[selected.role] + '10', borderBottom: '1px solid var(--border)' }}>
            <div className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-serif shrink-0"
              style={{ background: ROLE_COLORS[selected.role] + '20', color: ROLE_COLORS[selected.role] }}>
              {selected.name.charAt(0)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-semibold sans text-sm truncate" style={{ color: 'var(--foreground)' }}>{selected.name}</div>
              <div className="text-xs sans truncate mt-0.5" style={{ color: 'var(--muted-foreground)' }}>{selected.email}</div>
              <span className="inline-block text-xs sans px-2 py-0.5 rounded-full mt-1 font-medium"
                style={{ background: ROLE_COLORS[selected.role] + '15', color: ROLE_COLORS[selected.role] }}>
                {ROLE_LABELS[selected.role] || selected.role}
              </span>
            </div>
            <button onClick={() => setSelected(null)}
              className="shrink-0 text-lg leading-none" style={{ color: 'var(--muted-foreground)' }}>×</button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-2 divide-x divide-y" style={{ borderColor: 'var(--border)' }}>
            <Stat label="Flock Size" value={selected.flockCount.toString()} />
            <Stat label="Last Check-in" value={healthLabel(selected.lastCheckin, selected.flockCount)} color={healthColor(selected.lastCheckin, selected.flockCount)} />
          </div>

          {/* Actions */}
          <div className="px-4 py-3 flex flex-col gap-2">
            <a href={`/people?shepherd=${selected.id}`}
              className="w-full py-2 text-center rounded-lg text-sm sans font-medium"
              style={{ background: 'var(--muted)', color: 'var(--primary)' }}>
              View Their Flock
            </a>
            <a href={`/checkins?shepherd=${selected.id}`}
              className="w-full py-2 text-center rounded-lg text-sm sans font-medium"
              style={{ background: 'var(--primary)', color: 'white' }}>
              Log Check-in
            </a>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-xs sans" style={{ color: 'var(--muted-foreground)' }}>{label}</div>
      <div className="text-lg font-serif mt-0.5" style={{ color: color || 'var(--primary)' }}>{value}</div>
    </div>
  )
}
