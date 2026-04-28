'use client'

import { useMemo } from 'react'

/*
 * Per-person event timeline. Each row is one person; each dot is one
 * event placed at its date along a shared x-axis. Color encodes the
 * event type so users can quickly see the rhythm of someone's
 * involvement (greens = group, blues = team, gold = form, etc.).
 *
 * Renders pure SVG. No d3, no recharts — the data shape is small
 * (rows × events) and the layout is trivial: x = (at - windowStart) /
 * windowSpan * width, y = rowIndex * rowHeight.
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
  team_serve:        '#6b9bc9', // light steel blue, sits between staff and coach
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

const ROW_HEIGHT = 28
const NAME_WIDTH = 180
const MARGIN = { top: 28, right: 16, bottom: 24, left: NAME_WIDTH + 12 }

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

  const height = MARGIN.top + filtered.length * ROW_HEIGHT + MARGIN.bottom
  const plotWidth = width - MARGIN.left - MARGIN.right

  const xFor = (atIso: string): number => {
    const t = Date.parse(atIso)
    const ratio = (t - startMs) / Math.max(1, endMs - startMs)
    return Math.max(0, Math.min(1, ratio)) * plotWidth
  }

  // Month tick marks across the window.
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
      <svg width={width} height={height} role="img" aria-label="Per-person event timeline">
        {/* Axis */}
        <g transform={`translate(${MARGIN.left}, ${MARGIN.top - 14})`}>
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

        {/* Rows */}
        {filtered.map((p, rowIdx) => {
          const y = MARGIN.top + rowIdx * ROW_HEIGHT + ROW_HEIGHT / 2
          return (
            <g key={p.personId}>
              {/* Row stripe (alternating zebra) */}
              {rowIdx % 2 === 1 && (
                <rect
                  x={0}
                  y={MARGIN.top + rowIdx * ROW_HEIGHT}
                  width={width}
                  height={ROW_HEIGHT}
                  fill="var(--color-neutral-50)"
                />
              )}
              {/* Name */}
              <text
                x={NAME_WIDTH}
                y={y}
                dy="0.32em"
                textAnchor="end"
                fontSize={12}
                fontFamily="var(--font-sans)"
                fill="var(--foreground)"
              >
                {truncate(p.personName, 24)}
                <tspan fill="var(--foreground-muted)" dx={6} fontSize={10}>{p.eventCount}</tspan>
              </text>
              {/* Row baseline */}
              <line
                x1={MARGIN.left}
                x2={MARGIN.left + plotWidth}
                y1={y}
                y2={y}
                stroke="var(--color-neutral-100)"
              />
              {/* Dots */}
              {p.events.map((e, i) => (
                <circle
                  key={i}
                  cx={MARGIN.left + xFor(e.at)}
                  cy={y}
                  r={4}
                  fill={TYPE_COLOR[e.type]}
                  fillOpacity={0.9}
                  stroke="white"
                  strokeWidth={1}
                >
                  <title>
                    {p.personName} — {TYPE_LABEL[e.type]} — {new Date(e.at).toLocaleDateString()}
                    {'\n'}{e.label}
                  </title>
                </circle>
              ))}
            </g>
          )
        })}
      </svg>
    </div>
  )
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

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export const JOURNEY_TYPE_COLOR = TYPE_COLOR
export const JOURNEY_TYPE_LABEL = TYPE_LABEL
