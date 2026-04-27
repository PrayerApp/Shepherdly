'use client'

import type { ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { Card } from './Card'
import { cn } from './cn'

/*
 * Wrapper for every dashboard chart. Owns title, description, loading
 * skeleton, empty state, error state, and aria-label so individual
 * chart files (AttendanceTrend, EngagementDistribution, CareCoverage)
 * can stay focused on rendering data.
 *
 * Heights are exposed as `height` so callers control vertical real
 * estate but everything else stays consistent. Pass legend content via
 * `legend` so it sits inside the card with the chart, not as separate
 * sibling HTML below it.
 */

export interface ChartCardProps {
  title: ReactNode
  description?: ReactNode
  /* Pixel height for the chart body. Default 280. */
  height?: number
  /* Loading is a binary signal; chart components decide when their
   * data is ready and pass true while still fetching. */
  loading?: boolean
  /* If non-empty, render an empty state instead of children. */
  emptyMessage?: string | null
  /* If non-empty, render an error state instead of children. */
  errorMessage?: string | null
  /* Optional legend rendered below the chart. */
  legend?: ReactNode
  /* Used as the chart's accessible label since canvas/SVG content
   * isn't readable by screen readers. */
  ariaLabel: string
  children: ReactNode
  className?: string
}

export function ChartCard({
  title,
  description,
  height = 280,
  loading = false,
  emptyMessage,
  errorMessage,
  legend,
  ariaLabel,
  children,
  className,
}: ChartCardProps) {
  return (
    <Card className={cn('flex flex-col', className)} padded>
      <header className="mb-3">
        <h3 className="font-serif text-base leading-tight text-neutral-900">{title}</h3>
        {description && (
          <p className="mt-0.5 text-xs text-neutral-500">{description}</p>
        )}
      </header>
      <div
        role="img"
        aria-label={ariaLabel}
        aria-busy={loading || undefined}
        className="relative w-full"
        style={{ height }}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-neutral-400">
            <Loader2 className="size-5 animate-spin" aria-hidden />
          </div>
        ) : errorMessage ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-red-700">
            {errorMessage}
          </div>
        ) : emptyMessage ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-sm text-neutral-500">
            {emptyMessage}
          </div>
        ) : (
          children
        )}
      </div>
      {legend && !loading && !errorMessage && !emptyMessage && (
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
          {legend}
        </div>
      )}
    </Card>
  )
}
