'use client'

/*
 * People picker modal.
 *
 * Triggered when a user clicks an empty placeholder slot on a tree
 * layer. Hits /api/people/search with a debounced query and presents
 * matches; clicking one calls onPick to add them to the layer. Already-
 * placed people are shown disabled.
 */

import { useEffect, useRef, useState } from 'react'
import type { PickerPerson } from './types'

export function PeoplePickerModal({
  layerName, layerColor, existingIds, onClose, onPick,
}: {
  layerName: string
  layerColor: string
  existingIds: Set<string>
  onClose: () => void
  onPick: (personId: string, personName: string) => void | Promise<void>
}) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<PickerPerson[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [adding, setAdding] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const reqIdRef = useRef(0)

  // Autofocus the input on open
  useEffect(() => { inputRef.current?.focus() }, [])

  // Escape closes
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // Debounced search
  useEffect(() => {
    const thisReq = ++reqIdRef.current
    const handle = setTimeout(async () => {
      setLoading(true)
      setErr(null)
      try {
        const res = await fetch(`/api/people/search?q=${encodeURIComponent(q)}&limit=25`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        // Drop stale responses
        if (thisReq !== reqIdRef.current) return
        setResults(data.people || [])
      } catch (e: unknown) {
        if (thisReq !== reqIdRef.current) return
        setErr(e instanceof Error ? e.message : 'Search failed')
        setResults([])
      } finally {
        if (thisReq === reqIdRef.current) setLoading(false)
      }
    }, q.trim() === '' ? 0 : 180)
    return () => clearTimeout(handle)
  }, [q])

  return (
    <div
      style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60, background: 'rgba(0,0,0,0.3)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'white', borderRadius: 16,
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)', border: '1px solid var(--border)',
        width: 'min(92vw, 480px)', maxHeight: 'min(85vh, 620px)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div>
            <h3 className="font-serif" style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>
              Add to layer
            </h3>
            <div className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2 }}>
              <span style={{ fontWeight: 600, color: layerColor }}>{layerName}</span>
            </div>
          </div>
          <button onClick={onClose}
            style={{ fontSize: 18, lineHeight: 1, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
        </div>

        {/* Search input */}
        <div style={{ padding: '12px 20px 6px', flexShrink: 0 }}>
          <input
            ref={inputRef}
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search people by name…"
            className="sans"
            style={{
              width: '100%', boxSizing: 'border-box',
              padding: '10px 12px', borderRadius: 8,
              border: '1px solid var(--border)', fontSize: 13,
            }}
          />
        </div>

        {/* Results */}
        <div style={{ overflowY: 'auto', padding: '4px 12px 12px', flex: 1 }}>
          {loading && (
            <p className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: '10px 12px' }}>
              Searching…
            </p>
          )}
          {!loading && err && (
            <p className="sans" style={{ fontSize: 12, color: '#c0392b', padding: '10px 12px' }}>{err}</p>
          )}
          {!loading && !err && results.length === 0 && (
            <p className="sans" style={{ fontSize: 12, color: 'var(--muted-foreground)', padding: '10px 12px' }}>
              {q.trim() ? 'No matches.' : 'Start typing to search…'}
            </p>
          )}
          {!loading && !err && results.map(p => {
            const already = existingIds.has(p.id)
            const isAdding = adding === p.id
            return (
              <button
                key={p.id}
                disabled={already || isAdding}
                onClick={async () => {
                  setAdding(p.id)
                  try { await onPick(p.id, p.name) } finally { setAdding(null) }
                }}
                className="sans"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
                  width: '100%', padding: '9px 12px', margin: '0 0 2px', borderRadius: 8,
                  border: '1px solid transparent',
                  background: already ? 'rgba(0,0,0,0.03)' : 'white',
                  cursor: already ? 'default' : 'pointer',
                  textAlign: 'left', fontSize: 12,
                  color: already ? 'var(--muted-foreground)' : 'var(--foreground)',
                  opacity: already ? 0.6 : 1,
                }}>
                <span style={{ fontWeight: 500 }}>{p.name}</span>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                  {p.isStaff && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: '#5a2e87', background: 'rgba(140,90,180,0.14)', padding: '2px 6px', borderRadius: 4 }}>STAFF</span>}
                  {p.isLeader && !p.isStaff && <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: 0.5, color: '#2b5a8a', background: 'rgba(80,130,190,0.14)', padding: '2px 6px', borderRadius: 4 }}>LEADER</span>}
                  {already && <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>already on layer</span>}
                  {isAdding && <span style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>adding…</span>}
                </span>
              </button>
            )
          })}
        </div>

        {/* Footer */}
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'var(--muted)', flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderRadius: '0 0 16px 16px' }}>
          <span className="sans" style={{ fontSize: 10, color: 'var(--muted-foreground)' }}>
            Showing {results.length} result{results.length === 1 ? '' : 's'}
          </span>
          <button onClick={onClose} className="sans"
            style={{ fontSize: 12, fontWeight: 500, padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
