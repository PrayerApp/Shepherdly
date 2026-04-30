'use client'

/*
 * Shepherd Over modal.
 *
 * Lets the user create persistent "shepherd over" rules that auto-
 * generate connections whenever mappings or sync data change. Five
 * tabs: specific groups, specific teams, all groups of a type, all
 * teams of a type, or every active person on a downstream layer.
 *
 * Selections produce ShepherdOverRule rows; preview shows the people
 * that the rule currently resolves to so the user knows what they're
 * about to commit.
 */

import { useState } from 'react'
import type {
  LayerItem,
  GroupLite,
  TeamLite,
  MappingLayerPerson,
  ShepherdOverRule,
  Card,
} from './types'

export function ShepherdOverModal({
  parentName, parentPersonId, parentLayerId, layers, groupsList, teamsList,
  mappingLayerPeople, peopleByLayer, busy, existingRules, onApply, onDeleteRule, onClose,
}: {
  parentName: string
  parentPersonId: string
  parentLayerId: string
  layers: LayerItem[]
  groupsList: GroupLite[]
  teamsList: TeamLite[]
  mappingLayerPeople: MappingLayerPerson[]
  peopleByLayer: Map<string, Card[]>
  busy: boolean
  existingRules: ShepherdOverRule[]
  onApply: (ruleType: string, ruleValues: string[]) => void
  onDeleteRule: (ruleId: string) => void
  onClose: () => void
}) {
  const [tab, setTab] = useState<'groups' | 'teams' | 'group_type' | 'team_type' | 'layer'>('groups')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')

  const toggle = (id: string) => {
    const next = new Set(selectedIds)
    if (next.has(id)) next.delete(id); else next.add(id)
    setSelectedIds(next)
  }

  // Reset selection when switching tabs
  const switchTab = (t: typeof tab) => { setTab(t); setSelectedIds(new Set()); setSearch('') }

  // Get unique types
  const groupTypes = [...new Set(groupsList.map(g => g.groupTypeName || 'Other'))].sort()
  const teamTypes = [...new Set(teamsList.map(t => t.serviceTypeName || 'Other'))].sort()

  // Filter out selections that already have a rule
  const newSelections = [...selectedIds].filter(id =>
    !existingRules.some(r => r.ruleType === tab && r.ruleValue === id)
  )
  const allAlreadyExist = selectedIds.size > 0 && newSelections.length === 0

  // Resolve targets (preview) from current selection
  const resolvedTargets = (() => {
    if (selectedIds.size === 0) return []
    const leaderRe = /leader|co.?leader/i
    const targets: { personId: string; layerId: string; name: string }[] = []
    const seen = new Set<string>()
    const add = (personId: string, layerId: string, name: string) => {
      if (personId === parentPersonId && layerId === parentLayerId) return
      const k = `${personId}|${layerId}`
      if (seen.has(k)) return
      seen.add(k)
      targets.push({ personId, layerId, name })
    }

    if (tab === 'groups') {
      for (const mp of mappingLayerPeople) {
        if (mp.contextKind !== 'group' || !selectedIds.has(mp.contextId)) continue
        if (!leaderRe.test(mp.role)) continue
        add(mp.personId, mp.layerId, mp.personName)
      }
    } else if (tab === 'teams') {
      for (const mp of mappingLayerPeople) {
        if (mp.contextKind !== 'team' || !selectedIds.has(mp.contextId)) continue
        if (!leaderRe.test(mp.role)) continue
        add(mp.personId, mp.layerId, mp.personName)
      }
    } else if (tab === 'group_type') {
      const groupIdsOfType = new Set(
        groupsList.filter(g => selectedIds.has(g.groupTypeName || 'Other')).map(g => g.id)
      )
      for (const mp of mappingLayerPeople) {
        if (mp.contextKind !== 'group' || !groupIdsOfType.has(mp.contextId)) continue
        if (!leaderRe.test(mp.role)) continue
        add(mp.personId, mp.layerId, mp.personName)
      }
    } else if (tab === 'team_type') {
      const teamIdsOfType = new Set(
        teamsList.filter(t => selectedIds.has(t.serviceTypeName || 'Other')).map(t => t.id)
      )
      for (const mp of mappingLayerPeople) {
        if (mp.contextKind !== 'team' || !teamIdsOfType.has(mp.contextId)) continue
        if (!leaderRe.test(mp.role)) continue
        add(mp.personId, mp.layerId, mp.personName)
      }
    } else if (tab === 'layer') {
      for (const lid of selectedIds) {
        for (const p of peopleByLayer.get(lid) || []) {
          if (!p.isExcluded) add(p.personId, lid, p.name)
        }
      }
    }
    return targets
  })()

  const parentLayerIdx = layers.findIndex(l => l.id === parentLayerId)
  const q = search.trim().toLowerCase()

  // Human-readable label for a rule
  const ruleLabel = (r: ShepherdOverRule) => {
    if (r.ruleType === 'group') {
      const g = groupsList.find(g => g.id === r.ruleValue)
      return `Group: ${g?.name || r.ruleValue}`
    }
    if (r.ruleType === 'team') {
      const t = teamsList.find(t => t.id === r.ruleValue)
      return `Team: ${t?.name || r.ruleValue}`
    }
    if (r.ruleType === 'group_type') return `Group type: ${r.ruleValue}`
    if (r.ruleType === 'team_type') return `Team type: ${r.ruleValue}`
    if (r.ruleType === 'layer') {
      const l = layers.find(l => l.id === r.ruleValue)
      return `Layer: ${l?.name || r.ruleValue}`
    }
    return r.ruleValue
  }

  // Render selectable items — multi-select (checkbox) for all tabs
  const renderItems = () => {
    const alreadyRuleIds = new Set(existingRules.filter(r => r.ruleType === tab).map(r => r.ruleValue))
    const check = (id: string, label: string) => {
      const isExisting = alreadyRuleIds.has(id)
      return (
        <label key={id} className="sans" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', fontSize: 12, borderTop: '1px solid rgba(0,0,0,0.04)', cursor: isExisting ? 'default' : 'pointer', background: selectedIds.has(id) ? 'rgba(45,96,71,0.06)' : isExisting ? 'rgba(0,0,0,0.02)' : 'white', opacity: isExisting ? 0.5 : 1 }}>
          <input type="checkbox" checked={selectedIds.has(id) || isExisting} disabled={isExisting} onChange={() => toggle(id)} style={{ margin: 0 }} />
          <span style={{ fontWeight: selectedIds.has(id) ? 600 : 400 }}>{label}</span>
          {isExisting && <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--muted-foreground)' }}>active</span>}
        </label>
      )
    }

    if (tab === 'groups') {
      const filtered = groupsList.filter(g => !q || g.name.toLowerCase().includes(q) || (g.groupTypeName || '').toLowerCase().includes(q))
      const byType = new Map<string, GroupLite[]>()
      for (const g of filtered) {
        const k = g.groupTypeName || 'Other'
        if (!byType.has(k)) byType.set(k, [])
        byType.get(k)!.push(g)
      }
      return [...byType.keys()].sort().map(type => (
        <div key={type}>
          <div className="sans" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--muted-foreground)', padding: '8px 10px 4px', background: 'rgba(0,0,0,0.02)', textTransform: 'uppercase' }}>
            {type}
          </div>
          {byType.get(type)!.map(g => check(g.id, g.name))}
        </div>
      ))
    }
    if (tab === 'teams') {
      const filtered = teamsList.filter(t => !q || t.name.toLowerCase().includes(q) || (t.serviceTypeName || '').toLowerCase().includes(q))
      const byType = new Map<string, TeamLite[]>()
      for (const t of filtered) {
        const k = t.serviceTypeName || 'Other'
        if (!byType.has(k)) byType.set(k, [])
        byType.get(k)!.push(t)
      }
      return [...byType.keys()].sort().map(type => (
        <div key={type}>
          <div className="sans" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--muted-foreground)', padding: '8px 10px 4px', background: 'rgba(0,0,0,0.02)', textTransform: 'uppercase' }}>
            {type}
          </div>
          {byType.get(type)!.map(t => check(t.id, t.name))}
        </div>
      ))
    }
    if (tab === 'group_type') return groupTypes.map(type => check(type, type))
    if (tab === 'team_type') return teamTypes.map(type => check(type, type))
    // tab === 'layer'
    return layers
      .filter((_, i) => i > parentLayerIdx)
      .map(l => check(l.id, l.name))
  }

  const tabs: { key: typeof tab; label: string }[] = [
    { key: 'groups', label: 'Group' },
    { key: 'teams', label: 'Team' },
    { key: 'group_type', label: 'Group type' },
    { key: 'team_type', label: 'Team type' },
    { key: 'layer', label: 'Layer' },
  ]

  return (
    <div
      style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 55, background: 'rgba(0,0,0,0.3)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div style={{
        background: 'white', borderRadius: 16,
        boxShadow: '0 8px 30px rgba(0,0,0,0.12)', border: '1px solid var(--border)',
        width: 'min(92vw, 520px)', maxHeight: 'min(85vh, 700px)',
        display: 'flex', flexDirection: 'column',
      }}>
        {/* Header */}
        <div style={{ padding: '16px 20px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h3 className="font-serif" style={{ fontSize: 14, color: 'var(--primary)', margin: 0 }}>
              {parentName} shepherds over…
            </h3>
            <button onClick={onClose} style={{ fontSize: 18, lineHeight: 1, color: 'var(--muted-foreground)', background: 'none', border: 'none', cursor: 'pointer' }}>×</button>
          </div>
          <div className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', marginTop: 4 }}>
            Rules auto-update when groups, teams, or mappings change.
          </div>
        </div>

        {/* Existing rules */}
        {existingRules.length > 0 && (
          <div style={{ padding: '10px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div className="sans" style={{ fontSize: 10, fontWeight: 700, letterSpacing: 1, color: 'var(--muted-foreground)', marginBottom: 6, textTransform: 'uppercase' }}>
              Active rules
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
              {existingRules.map(r => (
                <span key={r.id} className="sans" style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 11, padding: '3px 8px', borderRadius: 6,
                  background: 'rgba(45,96,71,0.08)', color: '#2a6a3a', fontWeight: 500,
                }}>
                  {ruleLabel(r)}
                  <button
                    onClick={(e) => { e.stopPropagation(); onDeleteRule(r.id) }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, lineHeight: 1, color: '#8a3a3a', padding: '2px 4px', marginLeft: 2, borderRadius: 4 }}
                    title="Remove rule"
                  >×</button>
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)', flexShrink: 0, overflowX: 'auto' }}>
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => switchTab(t.key)}
              className="sans"
              style={{
                flex: 1, fontSize: 11, fontWeight: tab === t.key ? 700 : 500,
                padding: '10px 8px', border: 'none', borderBottom: tab === t.key ? '2px solid var(--primary)' : '2px solid transparent',
                background: 'none', color: tab === t.key ? 'var(--primary)' : 'var(--muted-foreground)',
                cursor: 'pointer', whiteSpace: 'nowrap',
              }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Search (for groups/teams tabs) */}
        {(tab === 'groups' || tab === 'teams') && (
          <div style={{ padding: '10px 20px 0', flexShrink: 0 }}>
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder={`Search ${tab}…`}
              className="sans"
              style={{ width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', fontSize: 12, boxSizing: 'border-box' }}
            />
          </div>
        )}

        {/* Items */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '8px 20px' }}>
          <div style={{ border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
            {renderItems()}
          </div>
        </div>

        {/* Preview + Apply */}
        <div style={{ padding: '12px 20px', borderTop: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="sans" style={{ fontSize: 11, color: 'var(--muted-foreground)', marginBottom: 8 }}>
            {selectedIds.size === 0
              ? 'Select items above to create rules.'
              : allAlreadyExist
                ? 'All selected rules already exist.'
                : resolvedTargets.length === 0
                  ? `${newSelections.length} new ${newSelections.length === 1 ? 'rule' : 'rules'} — will connect to leaders when data becomes available.`
                  : `${newSelections.length} new ${newSelections.length === 1 ? 'rule' : 'rules'}, currently matching ${resolvedTargets.length} ${resolvedTargets.length === 1 ? 'person' : 'people'}`}
          </div>
          {resolvedTargets.length > 0 && resolvedTargets.length <= 12 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
              {resolvedTargets.map(t => (
                <span key={`${t.personId}-${t.layerId}`} className="sans" style={{
                  fontSize: 10, padding: '3px 8px', borderRadius: 6,
                  background: 'rgba(45,96,71,0.08)', color: '#2a6a3a', fontWeight: 500,
                }}>{t.name}</span>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button onClick={onClose} className="sans"
              style={{ fontSize: 12, fontWeight: 500, padding: '8px 16px', borderRadius: 8, border: '1px solid var(--border)', background: 'white', color: 'var(--muted-foreground)', cursor: 'pointer' }}>
              Cancel
            </button>
            <button
              onClick={() => { if (newSelections.length > 0) onApply(tab, newSelections) }}
              disabled={newSelections.length === 0 || busy}
              className="sans"
              style={{
                fontSize: 12, fontWeight: 600, padding: '8px 16px', borderRadius: 8,
                border: '1px solid #2a6a3a', background: '#2a6a3a', color: 'white',
                cursor: newSelections.length === 0 || busy ? 'not-allowed' : 'pointer',
                opacity: newSelections.length === 0 || busy ? 0.5 : 1,
              }}>
              {busy ? 'Saving…' : allAlreadyExist ? 'Already added' : `Save ${newSelections.length} ${newSelections.length === 1 ? 'rule' : 'rules'}${resolvedTargets.length > 0 ? ` (${resolvedTargets.length} now)` : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
