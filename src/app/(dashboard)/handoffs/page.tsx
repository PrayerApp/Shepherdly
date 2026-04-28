'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { HandoffSankey, type SankeyNodeIn, type SankeyLinkIn } from '@/components/charts/HandoffSankey'

interface HandoffPayload {
  window: '3m' | '6m' | '12m'
  windowDays: number
  generatedAt: string
  entry: { nodes: SankeyNodeIn[]; links: SankeyLinkIn[] }
  exit: { nodes: SankeyNodeIn[]; links: SankeyLinkIn[] }
}

const WINDOW_OPTIONS: { key: HandoffPayload['window']; label: string }[] = [
  { key: '3m', label: 'Last 3 months' },
  { key: '6m', label: 'Last 6 months' },
  { key: '12m', label: 'Last 12 months' },
]

export default function HandoffsPage() {
  const [data, setData] = useState<HandoffPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [windowKey, setWindowKey] = useState<HandoffPayload['window']>('12m')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    fetch(`/api/handoffs?window=${windowKey}`)
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(d => { if (!cancelled) setData(d) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [windowKey])

  return (
    <div className="p-8 max-w-6xl">
      <header className="mb-8">
        <h1 className="font-serif text-3xl text-neutral-900">Handoffs</h1>
        <p className="mt-1.5 text-sm text-neutral-600 max-w-2xl">
          Where people enter your contexts, and where they go from there. Built from
          PCO form submissions, registrations, and group/team membership timestamps.
          Counts are unique people per arrow.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-2">
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
        <div className="ml-auto text-xs text-neutral-500">
          {data?.generatedAt && (
            <>Generated {new Date(data.generatedAt).toLocaleString()}</>
          )}
        </div>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-card border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-700">
          Failed to load: {error}
        </div>
      )}

      <Section
        title="Entry — How people arrive"
        description="The most recent input signal (form, signup) within 60 days before each new group or team membership. People with no traceable input land in “No prior signal.”"
        loading={loading}
        nodes={data?.entry.nodes ?? []}
        links={data?.entry.links ?? []}
        emptyMessage="No new memberships in this window."
      />

      <Section
        title="Exit — Where people go next"
        description="For each membership that ended in this window, the next group or team they joined within 6 months. Memberships with no follow-up land in “Inactive.”"
        loading={loading}
        nodes={data?.exit.nodes ?? []}
        links={data?.exit.links ?? []}
        emptyMessage="No membership exits detected in this window."
      />

      <DataNotes />
    </div>
  )
}

function Section({
  title, description, loading, nodes, links, emptyMessage,
}: {
  title: string
  description: string
  loading: boolean
  nodes: SankeyNodeIn[]
  links: SankeyLinkIn[]
  emptyMessage: string
}) {
  return (
    <section className="mb-10">
      <header className="mb-3">
        <h2 className="font-serif text-xl text-neutral-900">{title}</h2>
        <p className="mt-0.5 text-sm text-neutral-500 max-w-2xl">{description}</p>
      </header>
      {loading ? (
        <div className="flex h-[360px] items-center justify-center rounded-card border border-neutral-200 bg-white">
          <Loader2 className="size-5 animate-spin text-neutral-400" aria-hidden />
        </div>
      ) : (
        <HandoffSankey
          nodes={nodes}
          links={links}
          height={Math.max(360, 36 + nodes.length * 18)}
          emptyMessage={emptyMessage}
        />
      )}
      <div className="mt-2 flex items-center gap-4 text-xs text-neutral-500">
        <Legend color="var(--color-gold-500)" label="Input signal" />
        <Legend color="var(--color-green-700)" label="Group" />
        <Legend color="var(--color-role-staff)" label="Team" />
        <Legend color="var(--color-red-500)" label="Inactive" />
      </div>
    </section>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="size-2.5 rounded-sm" style={{ background: color }} aria-hidden />
      {label}
    </span>
  )
}

function DataNotes() {
  return (
    <details className="rounded-card border border-neutral-200 bg-neutral-50/40 p-4 text-sm">
      <summary className="cursor-pointer font-medium text-neutral-800">What's measured, what's missing</summary>
      <div className="mt-3 space-y-2 text-neutral-600">
        <p>
          <strong>What feeds the entry chart:</strong> form submissions whose
          form is configured in <code className="text-xs">pco_form_sync_config</code>{' '}
          (with optional <code className="text-xs">purpose</code> tag), and
          signup attendances (active or waitlisted, not canceled). Both are
          looked up within 60 days before each new group or team join.
        </p>
        <p>
          <strong>What feeds the exit chart:</strong> memberships with a
          <code className="text-xs"> left_at</code> date inside the window.
          PCO doesn't expose left_at directly — ours is inferred when a
          membership stops appearing in nightly syncs, so a person who leaves
          today will show up here a day later at most.
        </p>
        <p>
          <strong>What's not yet captured:</strong> PCO Workflows
          (workflow_cards + workflow_card_activities) would give us explicit
          stage transitions instead of time-correlated guesses. Notes,
          messages, and check-ins as input signals. RSVPs and group
          enrollment status as filtering signals on the entry side. These
          are tracked in the followup queue.
        </p>
      </div>
    </details>
  )
}
