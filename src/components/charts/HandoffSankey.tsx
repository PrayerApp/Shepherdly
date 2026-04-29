'use client'

import { useMemo, useState } from 'react'
import { sankey, sankeyLinkHorizontal, sankeyJustify, type SankeyExtraProperties } from 'd3-sankey'

/*
 * Handoff Sankey for /handoffs.
 *
 * Inputs are pre-aggregated (nodes + links with raw counts). We run
 * d3-sankey purely for layout — no visual tweaks beyond the standard
 * algorithm — and then render with native SVG so we can use the design
 * tokens for fill/stroke and Tailwind for layout.
 *
 * Color rules:
 *   input nodes        → gold-500
 *   group_type nodes   → green-700
 *   team_type nodes    → role-staff (blue)
 *   terminal nodes     → red-500 (an exit signal)
 * Link color is derived from the source node, with low alpha so multiple
 * overlapping links read as stacked rather than blocking.
 */

export interface SankeyNodeIn {
  id: string
  label: string
  kind: 'input' | 'group_type' | 'team_type' | 'terminal'
}

export interface SankeyLinkIn {
  source: string
  target: string
  value: number
}

interface NodeDatum extends SankeyExtraProperties {
  id: string
  label: string
  kind: SankeyNodeIn['kind']
}

interface LinkDatum extends SankeyExtraProperties {
  source: string | NodeDatum
  target: string | NodeDatum
  value: number
}

/*
 * d3-sankey throws "circular link" if the link graph isn't a DAG. The
 * server keeps source and target ids in disjoint namespaces so cycles
 * shouldn't reach us, but a stale browser cache or unforeseen data
 * shape can still produce one. Walk the graph DFS, drop any back-edge
 * that would close a cycle, and warn — better a slightly-incomplete
 * diagram than a hard render crash.
 */
function dropCycles(nodes: SankeyNodeIn[], links: SankeyLinkIn[]): SankeyLinkIn[] {
  const adj = new Map<string, { target: string; key: string }[]>()
  for (const l of links) {
    const key = `${l.source}>>${l.target}`
    if (!adj.has(l.source)) adj.set(l.source, [])
    adj.get(l.source)!.push({ target: l.target, key })
  }
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  for (const n of nodes) color.set(n.id, WHITE)
  const dropped = new Set<string>()
  const visit = (u: string) => {
    color.set(u, GRAY)
    for (const { target, key } of adj.get(u) ?? []) {
      const c = color.get(target) ?? WHITE
      if (c === GRAY) dropped.add(key)
      else if (c === WHITE) visit(target)
    }
    color.set(u, BLACK)
  }
  for (const n of nodes) {
    if ((color.get(n.id) ?? WHITE) === WHITE) visit(n.id)
  }
  if (dropped.size > 0) {
    console.warn(`HandoffSankey: dropped ${dropped.size} cyclic link(s)`)
  }
  return links.filter(l => !dropped.has(`${l.source}>>${l.target}`))
}

const KIND_COLOR: Record<SankeyNodeIn['kind'], string> = {
  input: 'var(--color-gold-500)',
  group_type: 'var(--color-green-700)',
  team_type: 'var(--color-role-staff)',
  terminal: 'var(--color-red-500)',
}

export function HandoffSankey({
  nodes,
  links,
  height = 360,
  emptyMessage = 'No handoffs in this window.',
}: {
  nodes: SankeyNodeIn[]
  links: SankeyLinkIn[]
  height?: number
  emptyMessage?: string
}) {
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null)
  const [hoverLinkKey, setHoverLinkKey] = useState<string | null>(null)
  const [width, setWidth] = useState(800)

  const safeLinks = useMemo(() => dropCycles(nodes, links), [nodes, links])

  const layout = useMemo(() => {
    if (nodes.length === 0 || safeLinks.length === 0) return null
    const generator = sankey<NodeDatum, LinkDatum>()
      .nodeId(d => d.id)
      .nodeAlign(sankeyJustify)
      .nodeWidth(14)
      .nodePadding(12)
      .extent([[8, 8], [width - 8, height - 8]])
    const graph = generator({
      nodes: nodes.map(n => ({ ...n })),
      links: safeLinks.map(l => ({ ...l })),
    })
    return graph
  }, [nodes, safeLinks, width, height])

  if (!layout) {
    return (
      <div
        className="flex items-center justify-center rounded-card border border-neutral-200 bg-white text-sm text-neutral-500"
        style={{ height }}
      >
        {emptyMessage}
      </div>
    )
  }

  return (
    <div
      className="relative w-full overflow-hidden rounded-card border border-neutral-200 bg-white"
      ref={el => {
        if (el && el.clientWidth > 0 && Math.abs(el.clientWidth - width) > 4) {
          setWidth(el.clientWidth)
        }
      }}
    >
      <svg width="100%" height={height} role="img" aria-label="Handoff flow diagram">
        {/* Links — drawn first so nodes sit on top. */}
        <g fill="none" strokeOpacity={0.35}>
          {layout.links.map(link => {
            const path = sankeyLinkHorizontal<NodeDatum, LinkDatum>()(link as never)
            const sourceNode = link.source as NodeDatum
            const key = `${sourceNode.id}>>${(link.target as NodeDatum).id}`
            const isHover = hoverLinkKey === key
              || hoverNodeId === sourceNode.id
              || hoverNodeId === (link.target as NodeDatum).id
            return (
              <path
                key={key}
                d={path ?? ''}
                stroke={KIND_COLOR[sourceNode.kind]}
                strokeWidth={Math.max(1, link.width ?? 1)}
                strokeOpacity={isHover ? 0.7 : 0.3}
                onMouseEnter={() => setHoverLinkKey(key)}
                onMouseLeave={() => setHoverLinkKey(null)}
              >
                <title>
                  {sourceNode.label} → {(link.target as NodeDatum).label}: {link.value}
                </title>
              </path>
            )
          })}
        </g>

        {/* Nodes */}
        <g>
          {layout.nodes.map(node => {
            const x0 = node.x0 ?? 0
            const x1 = node.x1 ?? 0
            const y0 = node.y0 ?? 0
            const y1 = node.y1 ?? 0
            const w = x1 - x0
            const h = Math.max(2, y1 - y0)
            const labelX = x1 < width / 2 ? x1 + 6 : x0 - 6
            const labelAnchor: 'start' | 'end' = x1 < width / 2 ? 'start' : 'end'
            const isHover = hoverNodeId === node.id
            return (
              <g
                key={node.id}
                onMouseEnter={() => setHoverNodeId(node.id)}
                onMouseLeave={() => setHoverNodeId(null)}
              >
                <rect
                  x={x0}
                  y={y0}
                  width={w}
                  height={h}
                  fill={KIND_COLOR[node.kind]}
                  opacity={isHover ? 1 : 0.9}
                />
                <text
                  x={labelX}
                  y={(y0 + y1) / 2}
                  dy="0.35em"
                  textAnchor={labelAnchor}
                  fontSize={11}
                  fontFamily="var(--font-sans)"
                  fill="var(--foreground)"
                  pointerEvents="none"
                >
                  {node.label}
                  <tspan
                    fill="var(--foreground-muted)"
                    fontSize={10}
                    dx={6}
                  >
                    {node.value ?? 0}
                  </tspan>
                </text>
              </g>
            )
          })}
        </g>
      </svg>
    </div>
  )
}
