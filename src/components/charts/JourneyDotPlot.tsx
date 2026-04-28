'use client'

import { useEffect, useMemo, useRef } from 'react'

/*
 * Per-person event timeline. Each row is one person; each dot is one
 * event placed at its date along a shared x-axis. Color encodes the
 * event type so users can see the rhythm of involvement at a glance.
 *
 * Scale: this renders every active person who has ≥1 event in the
 * window — tens of thousands of rows. Two consequences shape the
 * implementation:
 *
 *   - Rows are 2px tall (no names, no per-row interactions). The
 *     visualization is a "skyline" of activity; identity is sacrificed
 *     for coverage.
 *   - Drawing happens in <canvas>, not SVG. SVG with hundreds of
 *     thousands of <circle> nodes would crater the browser.
 *   - Canvases are chunked into stacks of CHUNK_ROWS rows because
 *     browsers cap canvas height at 32767px; 33K × 2px would exceed it.
 */

export type JourneyEventType =
  | 'group_join'
  | 'group_leave'
  | 'group_attendance'
  | 'team_join'
  | 'team_leave'
  | 'team_serve'
  | 'form'
  | 'signup'
  | 'checkin'

export interface JourneyEvent {
  at: string
  type: JourneyEventType
  label: string
}

export interface PersonJourney {
  personId: string
  personName: string
  eventCount: number
  events: JourneyEvent[]
}

const TYPE_COLOR: Record<JourneyEventType, string> = {
  group_join:        'var(--color-green-700)',
  group_leave:       'var(--color-green-300)',
  group_attendance:  'var(--color-green-500)',
  team_join:         'var(--color-role-staff)',
  team_leave:        'var(--color-role-coach)',
  team_serve:        '#6b9bc9',
  form:              'var(--color-gold-500)',
  signup:            'var(--color-role-leader)',
  checkin:           'var(--color-role-coach)',
}

const TYPE_LABEL: Record<JourneyEventType, string> = {
  group_join:        'Group join',
  group_leave:       'Group leave',
  group_attendance:  'Group attendance',
  team_join:         'Team join',
  team_leave:        'Team leave',
  team_serve:        'Team serving',
  form:              'Form',
  signup:            'Signup',
  checkin:           'Check-in',
}

const ROW_HEIGHT = 2
const DOT_SIZE = 2
const AXIS_HEIGHT = 28
const MARGIN_X = 16
// Each canvas chunk renders CHUNK_ROWS rows; 8000 × 2px = 16000px,
// safely under the 32767px max canvas dimension on every browser.
const CHUNK_ROWS = 8000

export function JourneyDotPlot({
  people,
  windowStart,
  windowEnd,
  width = 1100,
  selectedTypes,
}: {
  people: PersonJourney[]
  windowStart: string
  windowEnd: string
  width?: number
  selectedTypes?: Set<JourneyEventType>
}) {
  const startMs = Date.parse(windowStart)
  const endMs = Date.parse(windowEnd)

  const filtered = useMemo(() => {
    if (!selectedTypes) return people
    return people.map(p => ({
      ...p,
      events: p.events.filter(e => selectedTypes.has(e.type)),
    })).filter(p => p.events.length > 0)
  }, [people, selectedTypes])

  const chunks = useMemo(() => {
    const out: PersonJourney[][] = []
    for (let i = 0; i < filtered.length; i += CHUNK_ROWS) {
      out.push(filtered.slice(i, i + CHUNK_ROWS))
    }
    return out
  }, [filtered])

  const plotWidth = width - 2 * MARGIN_X
  const ticks = useMemo(() => buildTicks(startMs, endMs), [startMs, endMs])

  if (filtered.length === 0) {
    return (
      <div className="flex h-40 items-center justify-center rounded-card border border-neutral-200 bg-white text-sm text-neutral-500">
        No events in this window for the people shown.
      </div>
    )
  }

  return (
    <div className="overflow-x-auto rounded-card border border-neutral-200 bg-white">
      <svg width={width} height={AXIS_HEIGHT} role="img" aria-label="Journey timeline axis" style={{ display: 'block' }}>
        <g transform={`translate(${MARGIN_X}, ${AXIS_HEIGHT - 14})`}>
          <line x1={0} x2={plotWidth} y1={0} y2={0} stroke="var(--color-neutral-200)" />
          {ticks.map((t, i) => (
            <g key={i} transform={`translate(${(t.at - startMs) / Math.max(1, endMs - startMs) * plotWidth}, 0)`}>
              <line y1={-4} y2={0} stroke="var(--color-neutral-300)" />
              <text y={-7} fontSize={10} textAnchor="middle" fill="var(--foreground-muted)" fontFamily="var(--font-sans)">
                {t.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {chunks.map((chunk, idx) => (
        <ChunkCanvas
          key={idx}
          rows={chunk}
          width={width}
          plotWidth={plotWidth}
          marginLeft={MARGIN_X}
          startMs={startMs}
          endMs={endMs}
        />
      ))}
    </div>
  )
}

function ChunkCanvas({
  rows,
  width,
  plotWidth,
  marginLeft,
  startMs,
  endMs,
}: {
  rows: PersonJourney[]
  width: number
  plotWidth: number
  marginLeft: number
  startMs: number
  endMs: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const height = rows.length * ROW_HEIGHT

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // 1x DPR keeps memory tractable when many chunks are mounted.
    canvas.width = width
    canvas.height = height
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    ctx.clearRect(0, 0, width, height)

    const colors = resolveColors()
    const span = Math.max(1, endMs - startMs)

    // Group draws by color so we minimize fillStyle changes.
    const byType: Partial<Record<JourneyEventType, [number, number][]>> = {}
    for (let r = 0; r < rows.length; r++) {
      const p = rows[r]
      const y = r * ROW_HEIGHT
      for (const e of p.events) {
        const t = Date.parse(e.at)
        const ratio = (t - startMs) / span
        if (ratio < 0 || ratio > 1) continue
        const x = marginLeft + ratio * plotWidth
        const arr = byType[e.type] ?? (byType[e.type] = [])
        arr.push([x, y])
      }
    }

    for (const type of Object.keys(byType) as JourneyEventType[]) {
      const points = byType[type]
      if (!points) continue
      ctx.fillStyle = colors[type]
      for (const [x, y] of points) {
        ctx.fillRect(x - DOT_SIZE / 2, y, DOT_SIZE, DOT_SIZE)
      }
    }
  }, [rows, width, plotWidth, marginLeft, startMs, endMs, height])

  return <canvas ref={canvasRef} style={{ display: 'block' }} />
}

function resolveColors(): Record<JourneyEventType, string> {
  const styles = getComputedStyle(document.documentElement)
  const out = {} as Record<JourneyEventType, string>
  for (const [k, v] of Object.entries(TYPE_COLOR) as [JourneyEventType, string][]) {
    const m = v.match(/var\((--[^)]+)\)/)
    out[k] = m ? (styles.getPropertyValue(m[1]).trim() || v) : v
  }
  return out
}

function buildTicks(startMs: number, endMs: number): { at: number; label: string }[] {
  const out: { at: number; label: string }[] = []
  const start = new Date(startMs)
  start.setDate(1)
  const cursor = new Date(start)
  while (cursor.getTime() <= endMs) {
    out.push({
      at: cursor.getTime(),
      label: cursor.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
    })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return out
}

export const JOURNEY_TYPE_COLOR = TYPE_COLOR
export const JOURNEY_TYPE_LABEL = TYPE_LABEL
