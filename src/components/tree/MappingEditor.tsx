'use client'

/*
 * Group/Team mapping editor.
 *
 * Lets the user define a "mapping": a named bundle of PCO groups or
 * teams whose leaders/members get auto-placed on tree layers, and
 * optionally auto-connected via tree edges. The parent component owns
 * the draft state — we just render and emit edits via setDraft.
 *
 * LayerSelect is the layer dropdown used by the Leaders/Members
 * pickers; kept in this file because it's only useful here.
 */

import type {
  LayerItem,
  GroupLite,
  TeamLite,
  MappingDraft,
} from './types'

export function MappingEditor({
  draft, setDraft, layers, groupsList, teamsList,
}: {
  draft: MappingDraft
  setDraft: (d: MappingDraft | null) => void
  layers: LayerItem[]
  groupsList: GroupLite[]
  teamsList: TeamLite[]
}) {
  const update = (patch: Partial<MappingDraft>) => setDraft({ ...draft, ...patch })

  // Source items for the current kind, optionally filtered by search
  const items = (draft.kind === 'groups' ? groupsList : teamsList) as (GroupLite | TeamLite)[]
  const typeKey = (it: GroupLite | TeamLite) =>
    (it as GroupLite).groupTypeName ?? (it as TeamLite).serviceTypeName ?? 'Other'

  const q = draft.search.trim().toLowerCase()
  const filtered = items.filter(it => {
    if (!q) return true
    return it.name.toLowerCase().includes(q) || (typeKey(it) || '').toLowerCase().includes(q)
  })
  // Group by type for readability
  const byType = new Map<string, typeof filtered>()
  for (const it of filtered) {
    const k = typeKey(it) || 'Other'
    if (!byType.has(k)) byType.set(k, [])
    byType.get(k)!.push(it)
  }
  const sortedTypes = [...byType.keys()].sort()

  const toggleItem = (id: string) => {
    const next = new Set(draft.itemIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    update({ itemIds: next })
  }

  const toggleType = (type: string) => {
    const typeItems = byType.get(type) || []
    const allSelected = typeItems.every(it => draft.itemIds.has(it.id))
    const next = new Set(draft.itemIds)
    for (const it of typeItems) {
      if (allSelected) next.delete(it.id); else next.add(it.id)
    }
    update({ itemIds: next })
  }

  const selectAllFiltered = () => {
    const next = new Set(draft.itemIds)
    for (const it of filtered) next.add(it.id)
    update({ itemIds: next })
  }
  const clearSelection = () => update({ itemIds: new Set() })

  return (
    <div>
      {/* Name */}
      <label className="sans" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 4 }}>
        Mapping name
      </label>
      <input
        type="text"
        value={draft.name}
        onChange={e => update({ name: e.target.value })}
        placeholder="e.g. Worship A TEAM"
        className="sans"
        style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 13, marginBottom: 14, boxSizing: 'border-box' }}
      />

      {/* Kind toggle */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {(['groups', 'teams'] as const).map(k => (
          <button
            key={k}
            onClick={() => update({ kind: k, itemIds: new Set() })}
            className="sans"
            style={{
              flex: 1, fontSize: 12, fontWeight: 600, padding: '8px 10px', borderRadius: 8,
              border: draft.kind === k ? '2px solid var(--primary)' : '1px solid var(--border)',
              background: draft.kind === k ? 'rgba(45, 96, 71, 0.06)' : 'white',
              color: draft.kind === k ? 'var(--primary)' : 'var(--foreground)',
              cursor: 'pointer',
            }}>
            PCO {k === 'groups' ? 'Groups' : 'Teams'}
          </button>
        ))}
      </div>

      {/* Layer pickers */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <LayerSelect
          label="Leaders layer"
          helper={`Leaders of selected ${draft.kind}`}
          value={draft.leaderLayerId}
          onChange={v => update({ leaderLayerId: v })}
          layers={layers}
        />
        <LayerSelect
          label="Members layer"
          helper={`Members of selected ${draft.kind}`}
          value={draft.memberLayerId}
          onChange={v => update({ memberLayerId: v })}
          layers={layers}
        />
      </div>

      {/* Auto-connect toggle */}
      <label
        className="sans"
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 8,
          padding: '10px 12px', marginBottom: 14, borderRadius: 8,
          border: '1px solid var(--border)',
          background: draft.autoConnect ? 'rgba(45,96,71,0.06)' : 'white',
          cursor: (draft.leaderLayerId && draft.memberLayerId) ? 'pointer' : 'default',
          opacity: (draft.leaderLayerId && draft.memberLayerId) ? 1 : 0.5,
        }}
      >
        <input
          type="checkbox"
          checked={draft.autoConnect}
          disabled={!draft.leaderLayerId || !draft.memberLayerId}
          onChange={e => update({ autoConnect: e.target.checked })}
          style={{ margin: '2px 0 0' }}
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--foreground)' }}>
            Auto-connect leaders → members
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 2, lineHeight: 1.3 }}>
            Automatically connect leaders to members for each selected {draft.kind === 'groups' ? 'group' : 'team'}. Refreshed on every save and PCO sync.
          </div>
        </div>
      </label>

      {/* Co-leader counting mode */}
      {draft.leaderLayerId && draft.memberLayerId && (
        <div style={{ marginBottom: 14 }}>
          <label className="sans" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 6 }}>
            Co-leader counting
          </label>
          <div style={{ display: 'flex', gap: 6 }}>
            {([
              { value: 'all' as const, label: 'Full count', desc: 'Each leader counts all members' },
              { value: 'split' as const, label: 'Split evenly', desc: 'Divide members across leaders' },
              { value: 'split_round' as const, label: 'Split (round up)', desc: 'Split and round up per leader' },
            ]).map(opt => (
              <button
                key={opt.value}
                onClick={() => update({ countMode: opt.value })}
                title={opt.desc}
                className="sans"
                style={{
                  flex: 1, fontSize: 11, fontWeight: draft.countMode === opt.value ? 600 : 400,
                  padding: '7px 6px', borderRadius: 8,
                  border: draft.countMode === opt.value ? '2px solid var(--primary)' : '1px solid var(--border)',
                  background: draft.countMode === opt.value ? 'rgba(45,96,71,0.06)' : 'white',
                  color: draft.countMode === opt.value ? 'var(--primary)' : 'var(--foreground)',
                  cursor: 'pointer', lineHeight: 1.2,
                }}>
                {opt.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Item picker */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <label className="sans" style={{ fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)' }}>
          {draft.kind === 'groups' ? 'Groups' : 'Teams'} to include
          <span style={{ marginLeft: 6, fontWeight: 400, color: 'var(--muted-foreground)' }}>({draft.itemIds.size} selected)</span>
        </label>
        <div style={{ display: 'flex', gap: 6 }}>
          <button onClick={selectAllFiltered} className="sans" style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'white', color: 'var(--foreground)', cursor: 'pointer' }}>
            Select all{q ? ' (filtered)' : ''}
          </button>
          <button onClick={clearSelection} className="sans" style={{ fontSize: 10, padding: '3px 8px', borderRadius: 6, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
            Clear
          </button>
        </div>
      </div>
      <input
        type="text"
        value={draft.search}
        onChange={e => update({ search: e.target.value })}
        placeholder={`Search ${draft.kind}…`}
        className="sans"
        style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, marginBottom: 8, boxSizing: 'border-box' }}
      />
      <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8 }}>
        {items.length === 0 ? (
          <p className="sans" style={{ padding: 12, fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
            No {draft.kind} found. Sync PCO first.
          </p>
        ) : filtered.length === 0 ? (
          <p className="sans" style={{ padding: 12, fontSize: 12, color: 'var(--muted-foreground)', margin: 0 }}>
            No matches.
          </p>
        ) : (
          sortedTypes.map(type => {
            const typeItems = byType.get(type) || []
            const allSel = typeItems.length > 0 && typeItems.every(it => draft.itemIds.has(it.id))
            return (
            <div key={type}>
              <div className="sans" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--muted-foreground)', padding: '8px 10px 4px', background: 'rgba(0,0,0,0.02)', textTransform: 'uppercase' }}>
                <span>{type}</span>
                <button
                  onClick={() => toggleType(type)}
                  className="sans"
                  style={{ fontSize: 9, fontWeight: 600, padding: '2px 6px', borderRadius: 4, border: '1px solid var(--border)', background: allSel ? 'rgba(45,96,71,0.08)' : 'white', color: allSel ? 'var(--primary)' : 'var(--muted-foreground)', cursor: 'pointer', textTransform: 'none', letterSpacing: 0 }}>
                  {allSel ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              {byType.get(type)!.map(it => {
                const selected = draft.itemIds.has(it.id)
                return (
                  <label
                    key={it.id}
                    className="sans"
                    style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '8px 10px', fontSize: 12,
                      borderTop: '1px solid rgba(0,0,0,0.04)',
                      cursor: 'pointer',
                      background: selected ? 'rgba(45, 96, 71, 0.06)' : 'white',
                    }}>
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleItem(it.id)}
                      style={{ margin: 0 }}
                    />
                    <span style={{ flex: 1, fontWeight: selected ? 600 : 400, color: 'var(--foreground)' }}>
                      {it.name}
                    </span>
                  </label>
                )
              })}
            </div>
          ) })
        )}
      </div>
    </div>
  )
}

export function LayerSelect({ label, helper, value, onChange, layers }: {
  label: string
  helper: string
  value: string | null
  onChange: (v: string | null) => void
  layers: LayerItem[]
}) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <label className="sans" style={{ display: 'block', fontSize: 11, fontWeight: 600, color: 'var(--muted-foreground)', marginBottom: 4 }}>
        {label}
      </label>
      <select
        value={value || ''}
        onChange={e => onChange(e.target.value || null)}
        className="sans"
        style={{ width: '100%', padding: '7px 8px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, background: 'white', color: 'var(--foreground)' }}
      >
        <option value="">— none —</option>
        {layers.map(l => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <div className="sans" style={{ fontSize: 10, color: 'var(--muted-foreground)', marginTop: 3 }}>{helper}</div>
    </div>
  )
}
