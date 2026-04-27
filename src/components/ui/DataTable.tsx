'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, ChevronsUpDown } from 'lucide-react'
import { cn } from './cn'

type SortDirection = 'asc' | 'desc' | null

export interface ColumnDef<T> {
  /* Stable id used for sort state and React keys. */
  id: string
  /* Header cell content. Plain string is rendered as-is. */
  header: ReactNode
  /* Cell renderer. */
  cell: (row: T) => ReactNode
  /*
   * Returns the value used for sorting. Required for sortable columns;
   * omit to make the column non-sortable.
   */
  sortValue?: (row: T) => string | number | null
  /* Right-align numeric columns. */
  align?: 'left' | 'right' | 'center'
  /*
   * Tight columns (e.g. role pill) shouldn't fight for space against
   * label columns. Set width to a Tailwind class like "w-24".
   */
  width?: string
  /* Optional sticky-column directive — useful for a leading "Type" column. */
  sticky?: boolean
  /*
   * Tooltip / longer description shown to screen readers. Use when the
   * visible header is an icon or short abbreviation.
   */
  ariaLabel?: string
}

export interface DataTableProps<T> {
  rows: T[]
  columns: ColumnDef<T>[]
  /* Stable row key. */
  rowKey: (row: T, index: number) => string
  /*
   * Optional caption shown to screen readers (visually hidden) describing
   * what the table contains. Always provide for accessibility.
   */
  caption: string
  /*
   * Optional initial sort state — column id + direction.
   */
  initialSort?: { columnId: string; direction: SortDirection }
  /* Optional totals row rendered with a sticky background. */
  totalsRow?: ReactNode
  /* Optional empty-state content when rows is []. */
  emptyState?: ReactNode
  /* Smaller cell padding for dense tables. */
  dense?: boolean
  className?: string
}

export function DataTable<T>({
  rows,
  columns,
  rowKey,
  caption,
  initialSort,
  totalsRow,
  emptyState,
  dense = false,
  className,
}: DataTableProps<T>) {
  const [sortColumn, setSortColumn] = useState<string | null>(initialSort?.columnId ?? null)
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    initialSort?.direction ?? null,
  )

  const sortedRows = useMemo(() => {
    if (!sortColumn || !sortDirection) return rows
    const col = columns.find(c => c.id === sortColumn)
    if (!col?.sortValue) return rows
    const sorted = [...rows].sort((a, b) => {
      const av = col.sortValue!(a)
      const bv = col.sortValue!(b)
      if (av === bv) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'number' && typeof bv === 'number') return av - bv
      return String(av).localeCompare(String(bv))
    })
    return sortDirection === 'desc' ? sorted.reverse() : sorted
  }, [rows, columns, sortColumn, sortDirection])

  const onSort = (columnId: string) => {
    if (sortColumn !== columnId) {
      setSortColumn(columnId)
      setSortDirection('asc')
      return
    }
    if (sortDirection === 'asc') setSortDirection('desc')
    else if (sortDirection === 'desc') {
      setSortColumn(null)
      setSortDirection(null)
    } else {
      setSortDirection('asc')
    }
  }

  if (rows.length === 0 && emptyState) {
    return <div className="p-6 text-center text-sm text-neutral-500">{emptyState}</div>
  }

  return (
    <div className={cn('overflow-x-auto rounded-card border border-neutral-200', className)}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-neutral-200 bg-neutral-50">
            {columns.map(col => {
              const sortable = !!col.sortValue
              const isSorted = sortColumn === col.id
              const ariaSort = isSorted
                ? sortDirection === 'asc'
                  ? 'ascending'
                  : sortDirection === 'desc'
                    ? 'descending'
                    : 'none'
                : 'none'
              return (
                <th
                  key={col.id}
                  scope="col"
                  aria-sort={sortable ? ariaSort : undefined}
                  aria-label={col.ariaLabel}
                  className={cn(
                    'font-semibold text-neutral-700',
                    dense ? 'px-2 py-2' : 'px-3 py-3',
                    col.width,
                    col.align === 'right' && 'text-right',
                    col.align === 'center' && 'text-center',
                    col.sticky && 'sticky left-0 z-10 bg-neutral-50',
                  )}
                >
                  {sortable ? (
                    <button
                      type="button"
                      onClick={() => onSort(col.id)}
                      className={cn(
                        'inline-flex items-center gap-1 hover:text-neutral-900',
                        col.align === 'right' && 'flex-row-reverse',
                      )}
                    >
                      <span>{col.header}</span>
                      {!isSorted && (
                        <ChevronsUpDown className="size-3 text-neutral-400" aria-hidden />
                      )}
                      {isSorted && sortDirection === 'asc' && (
                        <ChevronUp className="size-3" aria-hidden />
                      )}
                      {isSorted && sortDirection === 'desc' && (
                        <ChevronDown className="size-3" aria-hidden />
                      )}
                    </button>
                  ) : (
                    col.header
                  )}
                </th>
              )
            })}
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((row, idx) => (
            <tr
              key={rowKey(row, idx)}
              className="border-b border-neutral-100 last:border-b-0 hover:bg-neutral-50/60"
            >
              {columns.map(col => (
                <td
                  key={col.id}
                  className={cn(
                    'text-neutral-800',
                    dense ? 'px-2 py-1.5' : 'px-3 py-2.5',
                    col.align === 'right' && 'text-right tabular-nums',
                    col.align === 'center' && 'text-center',
                    col.sticky && 'sticky left-0 bg-white',
                  )}
                >
                  {col.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        {totalsRow && (
          <tfoot>
            <tr className="border-t-2 border-neutral-200 bg-neutral-50 font-semibold">
              {totalsRow}
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  )
}
