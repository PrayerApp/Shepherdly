'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import {
  JourneyDotPlot,
  JOURNEY_TYPE_COLOR,
  JOURNEY_TYPE_LABEL,
  type PersonJourney,
  type JourneyEventType,
} from '@/components/charts/JourneyDotPlot'

interface Payload {
  window: '3m' | '6m' | '12m' | 'all'
  windowDays: number
  generatedAt: string
  windowStart: string
  windowEnd: string
  totalWithEvents: number
  returned: number
  people: PersonJourney[]
}

const WINDOW_OPTIONS: { key: Payload['window']; label: string }[] = [
  { key: '3m', label: 'Last 3 months' },
  { key: '6m', label: 'Last 6 months' },
  { key: '12m', label: 'Last 12 months' },
  { key: 'all', label: 'All time' },
]

const ALL_TYPES: JourneyEventType[] = [
  'group_join', 'group_leave', 'group_attendance',
  'team_join', 'team_leave', 'team_serve',
  'form', 'signup', 'checkin',
]

export default function JourneysPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowKey, setWindowKey] = useState<Payload['window']>('12m')
  const [searchInput, setSearchInput] = useState('')
  const [searchActive, setSearchActive] = useState('')
  const [selectedTypes, setSelectedTypes] = useState<Set<JourneyEventType>>(new Set(ALL_TYPES))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const params = new URLSearchParams({ window: windowKey })
    if (searchActive) params.set('search', searchActive)
    fetch(`/api/journeys?${params}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [windowKey, searchActive])

  const toggleType = (t: JourneyEventType) => {
    setSelectedTypes(prev => {
      const next = new Set(prev)
      if (next.has(t)) next.delete(t)
      else next.add(t)
      return next
    })
  }

  const onSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    setSearchActive(searchInput.trim())
  }

  const description = useMemo(() => {
    if (!data) return null
    const cap = searchActive
      ? `${data.returned} of ${data.totalWithEvents} matching “${searchActive}”`
      : `Top ${data.returned} most-active of ${data.totalWithEvents} people with events`
    return cap
  }, [data, searchActive])

  return (
    <div className="p-8 max-w-[1300px]">
      <header className="mb-6">
        <h1 className="font-serif text-3xl text-neutral-900">Journeys</h1>
        <p className="mt-1.5 text-sm text-neutral-600 max-w-2xl">
          One row per person, one dot per event. Color encodes event type — green for groups,
          blue for teams, gold for forms, amber for signups, purple for check-ins. Look for the
          rhythm of someone's involvement at a glance.
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {WINDOW_OPTIONS.map(opt => {
          const active = windowKey === opt.key
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setWindowKey(opt.key)}
              aria-pressed={active}
              className={
                'rounded-md border px-3 py-1.5 text-sm transition-colors ' +
                (active
                  ? 'bg-green-700 text-white border-green-700'
                  : 'bg-white text-neutral-700 border-neutral-200 hover:bg-neutral-50')
              }
            >
              {opt.label}
            </button>
          )
        })}
        <form onSubmit={onSubmitSearch} className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-4 -translate-y-1/2 text-neutral-400" aria-hidden />
            <input
              type="search"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Search by name…"
              className="rounded-md border border-neutral-200 bg-white pl-8 pr-3 py-1.5 text-sm w-64"
              aria-label="Search people by name"
            />
          </div>
          <button
            type="submit"
            className="rounded-md border border-neutral-200 bg-white px-3 py-1.5 text-sm hover:bg-neutral-50"
          >
            Search
          </button>
          {searchActive && (
            <button
              type="button"
              onClick={() => { setSearchInput(''); setSearchActive('') }}
              className="text-xs text-neutral-500 underline"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {ALL_TYPES.map(t => {
          const on = selectedTypes.has(t)
          return (
            <button
              key={t}
              type="button"
              onClick={() => toggleType(t)}
              aria-pressed={on}
              className={
                'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors ' +
                (on
                  ? 'border-neutral-300 bg-white text-neutral-800'
                  : 'border-neutral-200 bg-neutral-50 text-neutral-400 line-through')
              }
            >
              <span className="size-2 rounded-full" style={{ background: JOURNEY_TYPE_COLOR[t] }} aria-hidden />
              {JOURNEY_TYPE_LABEL[t]}
            </button>
          )
        })}
      </div>

      {description && (
        <p className="mb-3 text-xs text-neutral-500">{description}</p>
      )}

      {error && (
        <div role="alert" className="mb-6 rounded-card border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load: {error}
        </div>
      )}

      {loading || !data ? (
        <div className="flex h-64 items-center justify-center rounded-card border border-neutral-200 bg-white">
          <Loader2 className="size-5 animate-spin text-neutral-400" aria-hidden />
        </div>
      ) : (
        <JourneyDotPlot
          people={data.people}
          windowStart={data.windowStart}
          windowEnd={data.windowEnd}
          width={1280}
          selectedTypes={selectedTypes}
        />
      )}

      <details className="mt-6 rounded-card border border-neutral-200 bg-neutral-50/40 p-4 text-sm">
        <summary className="cursor-pointer font-medium text-neutral-800">What's measured</summary>
        <div className="mt-3 space-y-2 text-neutral-600">
          <p>
            Each row is one active person. Dots are placed by date along the
            shared timeline. Hover a dot for the event label and date.
          </p>
          <p>
            Sources: group_memberships (joined/left), team_memberships (joined/left),
            group_event_attendances (attended), plan_team_members (status='C' confirmed
            served), pco_form_submissions, pco_signup_attendees (active or waitlisted,
            not canceled), and attendance_records (PCO check-ins).
          </p>
          <p>
            Default view shows the 100 most-active people in the selected window.
            Use the search box to find someone specific; their full timeline appears
            without the cap.
          </p>
        </div>
      </details>
    </div>
  )
}
