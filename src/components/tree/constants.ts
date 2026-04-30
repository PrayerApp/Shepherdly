// Layout constants and small helpers for the Shepherd Tree views.
//
// Pulled out of ShepherdTreeV2.tsx so the layout engine and any future
// sub-views can share them without going through the root component.

// ── Layer color palette — each layer gets its own unique color ───
export const COLOR_PALETTE = [
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

// ── Layout dimensions ───────────────────────────────────────────
// Band height is computed at runtime from viewport height / layer count.
// Fallback used during SSR / pre-mount.
export const BAND_HEIGHT_FALLBACK = 120
export const BAND_HEIGHT_MIN = 110
export const TOOLBAR_H = 56 // approximate sticky toolbar height (~48) + small buffer

// Card gap needs to exceed 2 * BOX_PAD (see clusterBoxes in main) so that
// when two adjacent people both belong to co-leader clusters, their
// bounding boxes don't collide. 20 - 2*6 = 8px breathing room.
export const CARD_WIDTH = 190
export const CARD_HEIGHT = 86
export const CARD_GAP = 20
export const UNIT = CARD_WIDTH + CARD_GAP

// Reserves a narrow column on the left of each band for the vertical
// multiline layer label; cards start after this padding.
export const BAND_PADDING_LEFT = 62

export const LINE_COLOR = 'rgba(0,0,0,0.25)'
export const LINE_COLOR_HOVER = '#7a5a00'
export const SELECT_OUTLINE = '#e6b800' // warm yellow

// ── Default layer presets ───────────────────────────────────────
export const DEFAULT_LAYER_NAMES = [
  { name: 'Elder',        category: 'elder' },
  { name: 'Staff',        category: 'staff' },
  { name: 'Volunteer',    category: 'volunteer' },
  { name: 'Congregation', category: 'people' },
]

// ── Small helpers ──────────────────────────────────────────────
export function colorForIndex(i: number) {
  return COLOR_PALETTE[i % COLOR_PALETTE.length]
}

// Extract last name for sorting. Ignores common suffixes (Jr., Sr., II, III, IV, V).
export function lastName(full: string): string {
  const parts = (full || '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return ''
  const suffixes = /^(jr\.?|sr\.?|ii|iii|iv|v)$/i
  let i = parts.length - 1
  while (i > 0 && suffixes.test(parts[i])) i--
  return parts[i]
}
