// Shared types for the Shepherd Tree views.
//
// Originally defined inline at the top of ShepherdTreeV2.tsx; extracted
// here so the modal/editor sub-components can import them without
// pulling in the entire 3K-line root component.

export interface LayerItem {
  id: string
  name: string
  color: { bg: string; label: string }
  category?: string
  isLeader?: boolean
  isHidden?: boolean
}

export interface PcoList {
  id: string
  name: string
  totalPeople: number
}

export interface ListPerson {
  listId: string
  personId: string
  personName: string
}

export interface PersonCard {
  id: string
  name: string
}

export interface PersonStat {
  s: number // staff shepherded
  l: number // non-staff leaders shepherded
  p: number // congregation via groups/teams
  f: number // floaters (direct shepherding only)
  total: number
}

// Category colors for stat pills.
export const STAT_STYLES = {
  s: { bg: 'rgba(140, 90, 180, 0.14)', fg: '#5a2e87' },  // staff — purple
  l: { bg: 'rgba(80, 130, 190, 0.16)', fg: '#2b5a8a' },  // leaders — blue
  p: { bg: 'rgba(60, 160, 90, 0.16)',  fg: '#2a6a3a' },  // groups/teams — green
  f: { bg: 'rgba(200, 140, 60, 0.18)', fg: '#8a5a1a' },  // floaters — amber
}

export interface ListLayerLink {
  listId: string
  layerId: string
}

export interface LayerExclusion {
  personId: string
  layerId: string
}

export interface GtMapping {
  id: string
  name: string
  kind: 'groups' | 'teams'
  leaderLayerId: string | null
  memberLayerId: string | null
  autoConnect: boolean
  countMode: 'all' | 'split' | 'split_round'
  itemIds: string[]
}

// MappingEditor's working draft. Diverges from GtMapping in two places:
// no id (until saved) and itemIds is a Set for O(1) toggle.
export interface MappingDraft {
  id?: string
  name: string
  kind: 'groups' | 'teams'
  leaderLayerId: string | null
  memberLayerId: string | null
  autoConnect: boolean
  countMode: 'all' | 'split' | 'split_round'
  itemIds: Set<string>
  search: string
}

export interface MappingLayerPerson {
  layerId: string
  personId: string
  personName: string
  role: 'leader' | 'member'
  contextKind: 'group' | 'team'
  contextId: string
}

export interface LayerInclusion {
  personId: string
  layerId: string
  personName: string
}

export interface TreeConnection {
  id: string
  parentPersonId: string
  parentPersonName?: string
  parentLayerId: string
  childPersonId: string
  childLayerId: string
  childPersonName?: string
  contextGroupId?: string | null
  contextTeamId?: string | null
}

export interface ShepherdOverRule {
  id: string
  parentPersonId: string
  parentLayerId: string
  ruleType: 'group' | 'team' | 'group_type' | 'team_type' | 'layer'
  ruleValue: string
}

export interface MetricBucket {
  id: string
  label: string
  fullName: string
  color: string | null
  sortOrder: number
  layerIds: string[]
}

// Auto colors for buckets without an explicit color, ordered by sortOrder.
export const BUCKET_COLOR_PALETTE: { bg: string; fg: string }[] = [
  { bg: 'rgba(140, 90, 180, 0.14)', fg: '#5a2e87' },  // purple
  { bg: 'rgba(80, 130, 190, 0.16)', fg: '#2b5a8a' },  // blue
  { bg: 'rgba(60, 160, 90, 0.16)',  fg: '#2a6a3a' },  // green
  { bg: 'rgba(200, 140, 60, 0.18)', fg: '#8a5a1a' },  // amber
  { bg: 'rgba(190, 100, 100, 0.18)', fg: '#8a3a3a' }, // rose
  { bg: 'rgba(60, 160, 160, 0.18)', fg: '#2a7a7a' },  // teal
]

export function bucketColors(_b: MetricBucket, idx: number): { bg: string; fg: string } {
  // Colors are auto-assigned by position to keep the palette consistent.
  return BUCKET_COLOR_PALETTE[idx % BUCKET_COLOR_PALETTE.length]
}

export interface GroupLite {
  id: string
  name: string
  groupTypeName: string | null
}

export interface TeamLite {
  id: string
  name: string
  serviceTypeName: string | null
}

export interface PickerPerson {
  id: string
  name: string
  isStaff?: boolean
  isLeader?: boolean
}

// One rendered person card on the tree. Distinct from PersonCard above
// (which is just the people-table shape) — Card carries layout-relevant
// flags too.
export type Card = {
  key: string
  personId: string
  name: string
  isExcluded: boolean
  contextKey: string
}
