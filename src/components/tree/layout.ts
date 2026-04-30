// Tree layout engine.
//
// Pure function: takes the resolved card universe + tree connections,
// returns x-positions and co-leader clusters. Lifted out of
// ShepherdTreeV2.tsx so it can be reasoned about (and eventually
// tested) in isolation. The render code in the main component reads
// the returned `xUnit` map to position cards and the
// `coLeaderClusters` map to draw cluster bounding boxes.
//
// Algorithm summary:
//   1. Build a parent → children adjacency map from `connections`.
//   2. Detect co-leader clusters via union-find: two parents that
//      share a child *with the same context id* (group/team) get
//      merged. Shared children without a context (e.g. shepherd-over
//      rules) do NOT merge their parents.
//   3. Lay out connected subtrees bottom-up, centring each parent
//      over its children. Co-leaders are kept visually adjacent.
//   4. "Park" any unconnected cards to the right of the laid-out
//      forest, advancing per-layer so unconnected cards don't pile
//      vertically.

import { lastName } from './constants'
import type { Card, LayerItem, TreeConnection } from './types'

export interface LayoutResult {
  xUnit: Map<string, number>
  maxUnit: number
  inGraph: Set<string>
  coLeaderClusters: Map<string, string[]>
}

const CONTEXT_PRIMARY = 'primary'

const nodeKey = (personId: string, layerId: string, contextKey: string = CONTEXT_PRIMARY) =>
  `${personId}::${layerId}::${contextKey}`

export function computeTreeLayout(args: {
  connections: TreeConnection[]
  peopleByLayer: Map<string, Card[]>
  allLayers: LayerItem[]
  sortedLayers: LayerItem[]
}): LayoutResult {
  const { connections, peopleByLayer, allLayers, sortedLayers } = args

  const layerIndex = (layerId: string): number =>
    allLayers.findIndex(l => l.id === layerId)

  // Resolve the appropriate child cardKey for a given connection edge.
  // If the edge carries a context (auto-connect) and the child's layer
  // has a context-matched card, use that. Otherwise fall through to
  // primary.
  const resolveChildCardKey = (c: TreeConnection): string => {
    const cards = peopleByLayer.get(c.childLayerId) || []
    if (c.contextGroupId) {
      const k = nodeKey(c.childPersonId, c.childLayerId, `group-${c.contextGroupId}`)
      if (cards.some(card => card.key === k)) return k
    }
    if (c.contextTeamId) {
      const k = nodeKey(c.childPersonId, c.childLayerId, `team-${c.contextTeamId}`)
      if (cards.some(card => card.key === k)) return k
    }
    const any = cards.find(card => card.personId === c.childPersonId)
    return any?.key ?? nodeKey(c.childPersonId, c.childLayerId, CONTEXT_PRIMARY)
  }

  const resolveParentCardKey = (c: TreeConnection): string => {
    const cards = peopleByLayer.get(c.parentLayerId) || []
    if (c.contextGroupId) {
      const k = nodeKey(c.parentPersonId, c.parentLayerId, `group-${c.contextGroupId}`)
      if (cards.some(card => card.key === k)) return k
    }
    if (c.contextTeamId) {
      const k = nodeKey(c.parentPersonId, c.parentLayerId, `team-${c.contextTeamId}`)
      if (cards.some(card => card.key === k)) return k
    }
    const any = cards.find(card => card.personId === c.parentPersonId)
    return any?.key ?? nodeKey(c.parentPersonId, c.parentLayerId, CONTEXT_PRIMARY)
  }

  const childrenMap = new Map<string, string[]>()
  const parentsMap = new Map<string, string[]>()
  for (const c of connections) {
    const pk = resolveParentCardKey(c)
    const ck = resolveChildCardKey(c)
    if (!childrenMap.has(pk)) childrenMap.set(pk, [])
    childrenMap.get(pk)!.push(ck)
    if (!parentsMap.has(ck)) parentsMap.set(ck, [])
    parentsMap.get(ck)!.push(pk)
  }

  // renderable = all card keys (including hidden layers) for name
  // lookups. visibleRenderable = only visible-layer cards — used for
  // graph membership and layout so hidden layers don't create empty
  // gaps.
  const renderable = new Set<string>()
  const visibleRenderable = new Set<string>()
  for (const l of allLayers) {
    for (const p of peopleByLayer.get(l.id) || []) {
      renderable.add(p.key)
      if (!l.isHidden) visibleRenderable.add(p.key)
    }
  }

  // Build a key → name lookup so we can sort children alphabetically
  // (by last name) before laying them out. Keeps tree branches in a
  // predictable left-to-right order.
  const nameForKey = new Map<string, string>()
  for (const l of allLayers) {
    for (const p of peopleByLayer.get(l.id) || []) nameForKey.set(p.key, p.name)
  }

  // ── Co-leader clustering ──────────────────────────────────
  // Two leaders co-lead the same group/team when they both have
  // connections to the same child WITH THE SAME context (group or
  // team id). Connections with no context (e.g. shepherd-over rules)
  // do NOT establish co-leadership — a rule placing many people
  // under one shepherd shouldn't merge that shepherd with every
  // other shepherd who happens to share any of those people.
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    if (!parent.has(x)) parent.set(x, x)
    let p = parent.get(x)!
    while (p !== parent.get(p)!) {
      parent.set(p, parent.get(parent.get(p)!)!)
      p = parent.get(p)!
    }
    return p
  }
  const union = (a: string, b: string) => {
    const ra = find(a), rb = find(b)
    if (ra !== rb) parent.set(ra, rb)
  }
  const parentsByChildContext = new Map<string, Set<string>>()
  for (const c of connections) {
    const ctx = c.contextGroupId
      ? `g-${c.contextGroupId}`
      : c.contextTeamId
        ? `t-${c.contextTeamId}`
        : null
    if (!ctx) continue
    const pk = resolveParentCardKey(c)
    const ck = resolveChildCardKey(c)
    const key = `${ck}::${ctx}`
    if (!parentsByChildContext.has(key)) parentsByChildContext.set(key, new Set())
    parentsByChildContext.get(key)!.add(pk)
  }
  for (const parents of parentsByChildContext.values()) {
    if (parents.size < 2) continue
    const arr = [...parents]
    for (let i = 1; i < arr.length; i++) union(arr[0], arr[i])
  }

  // The cluster "anchor" is the alphabetically-first member of each
  // cluster. Clusters with only one member anchor to themselves, so
  // the sort falls through to pure alphabetical.
  const clusterAnchorCache = new Map<string, string>()
  const lastNameOf = (k: string) => lastName(nameForKey.get(k) || '')
  const nameOf = (k: string) => nameForKey.get(k) || ''
  const alphaCmp = (a: string, b: string) => {
    const c = lastNameOf(a).localeCompare(lastNameOf(b), undefined, { sensitivity: 'base' })
    if (c !== 0) return c
    return nameOf(a).localeCompare(nameOf(b), undefined, { sensitivity: 'base' })
  }
  // Pre-compute cluster members among all parents that exist in the graph.
  const coLeaderClusters = new Map<string, string[]>()
  {
    const allParents = new Set<string>()
    for (const [, ps] of parentsMap) for (const p of ps) allParents.add(p)
    for (const p of allParents) {
      const r = find(p)
      if (!coLeaderClusters.has(r)) coLeaderClusters.set(r, [])
      coLeaderClusters.get(r)!.push(p)
    }
    for (const [, ms] of coLeaderClusters) {
      ms.sort(alphaCmp)
      const anchor = ms[0]
      for (const m of ms) clusterAnchorCache.set(m, anchor)
    }
  }
  const clusterAnchorOf = (k: string): string => clusterAnchorCache.get(k) || k

  // Child order: higher layers first (lower index = higher in tree),
  // then group co-leaders together by cluster anchor, then alphabetical
  // within a cluster.
  const childSortCmp = (a: string, b: string) => {
    const la = layerIndex(a.split('::')[1])
    const lb = layerIndex(b.split('::')[1])
    if (la !== lb) return la - lb
    const ca = clusterAnchorOf(a)
    const cb = clusterAnchorOf(b)
    if (ca !== cb) return alphaCmp(ca, cb)
    return alphaCmp(a, b)
  }

  // Keep full childrenMap (including hidden-layer children) so co-leader
  // clustering can detect shared children. Build a visible-only version
  // for actual layout traversal.
  const visibleChildrenMap = new Map<string, string[]>()
  for (const [k, kids] of childrenMap) {
    const filtered = kids.filter(ck => visibleRenderable.has(ck))
    filtered.sort(childSortCmp)
    visibleChildrenMap.set(k, filtered)
  }

  const inGraph = new Set<string>()
  for (const c of connections) {
    const pk = resolveParentCardKey(c)
    const ck = resolveChildCardKey(c)
    if (visibleRenderable.has(pk)) inGraph.add(pk)
    if (visibleRenderable.has(ck)) inGraph.add(ck)
  }
  const roots = [...inGraph].filter(k =>
    !(parentsMap.get(k) || []).some(p => visibleRenderable.has(p))
  )

  const xUnit = new Map<string, number>()
  const visited = new Set<string>()
  let cursor = 0

  // Count of cluster peers (excluding k itself) that already have a
  // position. Used as the offset so the n-th co-leader lands adjacent
  // to the first — regardless of which layout path placed the first.
  const placedPeersOf = (k: string): number => {
    const mems = coLeaderClusters.get(find(k))
    if (!mems || mems.length < 2) return 0
    let n = 0
    for (const m of mems) if (m !== k && xUnit.has(m)) n++
    return n
  }

  const layoutNode = (k: string): number => {
    if (xUnit.has(k)) return xUnit.get(k)!
    if (visited.has(k)) return cursor
    visited.add(k)
    const visKids = visibleChildrenMap.get(k) || []
    const newKids = visKids.filter(ck => !visited.has(ck))

    // If a cluster peer was already placed, snap adjacent to it —
    // even if we have our own children to lay out. Keeping co-leaders
    // visually adjacent takes priority over centring over our own
    // subtree; otherwise two peers with different child sets end up
    // far apart with unrelated cards between them.
    const clusterMems = coLeaderClusters.get(find(k))
    if (clusterMems && clusterMems.length > 1) {
      const placedPeer = clusterMems.find(m => m !== k && xUnit.has(m))
      if (placedPeer) {
        for (const ck of newKids) layoutNode(ck)
        const baseX = xUnit.get(placedPeer)!
        const x = baseX + placedPeersOf(k)
        xUnit.set(k, x)
        if (x + 1 > cursor) cursor = Math.ceil(x + 1)
        return x
      }
    }

    if (newKids.length > 0) {
      // Normal subtree: lay out the unvisited children and centre
      // ourselves over their x-range.
      const childXs = newKids.map(ck => layoutNode(ck))
      const x = (childXs[0] + childXs[childXs.length - 1]) / 2
      xUnit.set(k, x)
      return x
    }

    // No new children to lay out. Check if our siblings' children
    // were already positioned (visible or hidden) so we can centre
    // over them.
    const allKids = childrenMap.get(k) || []
    if (allKids.length > 0) {
      const knownXs = allKids
        .map(ck => xUnit.get(ck))
        .filter((x): x is number => x !== undefined)
      if (knownXs.length > 0) {
        const center = (Math.min(...knownXs) + Math.max(...knownXs)) / 2
        const x = center + placedPeersOf(k)
        xUnit.set(k, x)
        if (x + 1 > cursor) cursor = Math.ceil(x + 1)
        return x
      }
    }

    // True leaf or first cluster member placed. Reserve cursor space
    // for the other cluster members so later cards don't overlap.
    const x = cursor
    const clusterSize = clusterMems ? clusterMems.length : 1
    cursor += clusterSize
    xUnit.set(k, x)
    return x
  }

  // Roots: sort so co-leaders of the same cluster appear consecutively
  // (same anchor) and the anchor lands first.
  const sortedRoots = [...roots].sort((a, b) => {
    const la = layerIndex(a.split('::')[1])
    const lb = layerIndex(b.split('::')[1])
    if (la !== lb) return la - lb
    return childSortCmp(a, b)
  })
  for (const r of sortedRoots) layoutNode(r)

  const parkingStart = cursor
  const layerCursor = new Map<string, number>()
  for (const l of sortedLayers) layerCursor.set(l.id, parkingStart)
  for (const l of sortedLayers) {
    for (const p of peopleByLayer.get(l.id) || []) {
      if (xUnit.has(p.key)) continue
      const c = layerCursor.get(l.id)!
      xUnit.set(p.key, c)
      layerCursor.set(l.id, c + 1)
    }
  }

  const maxUnit = Math.max(
    0,
    ...[...layerCursor.values()].map(v => v - 1),
    ...[...xUnit.values()],
  )
  // Only keep clusters with 2+ members for visual grouping.
  const multiClusters = new Map<string, string[]>()
  for (const [anchor, members] of coLeaderClusters) {
    if (members.length >= 2) multiClusters.set(anchor, members)
  }
  return { xUnit, maxUnit, inGraph, coLeaderClusters: multiClusters }
}
