import { PcoClient } from './pco'

/**
 * PCO Sync resource definitions.
 * Each resource knows how to fetch from PCO and map to our DB schema.
 *
 * DB tables: people, groups, teams, group_memberships, team_memberships, attendance_records
 * (NOT pco_* prefixed tables — those don't exist)
 */

export interface SyncResource {
  key: string
  label: string
  category: string
  table: string           // actual supabase table name
  endpoint: string        // PCO API path
  supportsUpdatedSince: boolean
  syncStrategy: 'upsert' | 'replace'
  onConflict: string      // column(s) for upsert conflict resolution
  mapRow: (item: any) => Record<string, any>
}

export const SYNC_CATEGORIES = [
  { key: 'people', label: 'People' },
  { key: 'groups', label: 'Groups' },
  { key: 'teams', label: 'Teams' },
  { key: 'checkins', label: 'Attendance' },
] as const

export const SYNC_RESOURCES: SyncResource[] = [
  // ── People ─────────────────────────────────────────────────
  {
    key: 'people',
    label: 'People',
    category: 'people',
    table: 'people',
    endpoint: '/people/v2/people',
    supportsUpdatedSince: true,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    mapRow: (p) => ({
      pco_id: p.id,
      name: [p.attributes.first_name, p.attributes.last_name].filter(Boolean).join(' ') || 'Unknown',
      email: null, // emails come from a sub-resource; set null for now
      membership_type: p.attributes.membership || 'attender',
      status: p.attributes.status || 'active',
      is_active: p.attributes.status !== 'inactive',
      is_leader: false, // will be updated when we process group memberships
    }),
  },

  // ── Groups ─────────────────────────────────────────────────
  {
    key: 'groups',
    label: 'Groups',
    category: 'groups',
    table: 'groups',
    endpoint: '/groups/v2/groups',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    mapRow: (g) => ({
      pco_id: g.id,
      name: g.attributes.name || 'Unnamed Group',
      description: g.attributes.description_as_plain_text || null,
      group_type: 'small_group',
      schedule: g.attributes.schedule || null,
      is_pco_synced: true,
      is_active: !g.attributes.archived_at,
    }),
  },

  // ── Group Memberships ──────────────────────────────────────
  // These use PCO IDs for person/group — we resolve to UUIDs via a subquery
  {
    key: 'group_memberships',
    label: 'Group Members',
    category: 'groups',
    table: 'group_memberships',
    endpoint: '/groups/v2/memberships',
    supportsUpdatedSince: false,
    syncStrategy: 'replace', // delete all + re-insert since memberships change
    onConflict: 'pco_id',
    mapRow: (m) => ({
      pco_id: m.id,
      // These are PCO IDs — must be resolved to UUIDs before insert
      _person_pco_id: m.relationships?.person?.data?.id || null,
      _group_pco_id: m.relationships?.group?.data?.id || null,
      role: m.attributes.role || 'member',
      joined_at: m.attributes.joined_at || null,
      is_active: true,
    }),
  },

  // ── Teams (from Services API) ──────────────────────────────
  {
    key: 'teams',
    label: 'Teams',
    category: 'teams',
    table: 'teams',
    endpoint: '/services/v2/teams',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_id',
    mapRow: (t) => ({
      pco_id: t.id,
      name: t.attributes.name || 'Unnamed Team',
      description: t.attributes.default_status || null,
      team_type: 'general',
      is_pco_synced: true,
      is_active: !t.attributes.archived_at,
    }),
  },

  // ── Attendance (from Check-Ins API — kids check-ins with EventPeople) ──
  {
    key: 'attendance',
    label: 'Attendance',
    category: 'checkins',
    table: 'attendance_records',
    endpoint: '/check-ins/v2/check_ins',
    supportsUpdatedSince: false,
    syncStrategy: 'upsert',
    onConflict: 'pco_event_id',
    mapRow: (c) => ({
      pco_event_id: c.id,
      pco_person_id: c.relationships?.person?.data?.id || null,
      // person_id resolved after sync via pco_person_id -> people.pco_id
      event_date: c.attributes.created_at?.substring(0, 10) || null,
      service_type: null,
      checked_in_at: c.attributes.created_at || null,
    }),
  },
]

// ── Flat resource helpers ────────────────────────────────────

/** Get total count for a flat resource from PCO */
export async function getResourceCount(
  client: PcoClient,
  resource: SyncResource,
  updatedSince?: string | null,
): Promise<number> {
  try {
    const params: Record<string, string> = { per_page: '1' }
    if (updatedSince && resource.supportsUpdatedSince) {
      params['where[updated_at][gte]'] = updatedSince
      params['order'] = 'updated_at'
    }
    const result = await client.get(resource.endpoint, params)
    return result.meta?.total_count || 0
  } catch {
    return 0
  }
}

/** Fetch one page of a flat resource and return mapped rows */
export async function fetchResourcePage(
  client: PcoClient,
  resource: SyncResource,
  offset: number,
  perPage: number,
  updatedSince?: string | null,
): Promise<{ rows: Record<string, any>[]; hasMore: boolean; totalCount: number }> {
  const params: Record<string, string> = {
    per_page: String(perPage),
    offset: String(offset),
  }
  if (updatedSince && resource.supportsUpdatedSince) {
    params['where[updated_at][gte]'] = updatedSince
    params['order'] = 'updated_at'
  }

  const result = await client.get(resource.endpoint, params)
  const data = result.data || []
  const rows = data.map(resource.mapRow)

  return {
    rows,
    hasMore: !!result.links?.next,
    totalCount: result.meta?.total_count || 0,
  }
}

// ── Nested resource helpers (removed — no longer needed) ─────
// Service plans and plan people tables don't exist in the DB.
// If needed in the future, re-add nested resource support.

export interface NestedCursor {
  parentIdx: number
  offset: number
  parents: { id: string; childCount: number; serviceTypePcoId?: string }[]
}

export async function getNestedResourceInfo(
  _client: PcoClient,
  _resource: SyncResource,
  _admin: any,
): Promise<{ totalCount: number; cursor: NestedCursor }> {
  return { totalCount: 0, cursor: { parentIdx: 0, offset: 0, parents: [] } }
}

export async function fetchNestedPage(
  _client: PcoClient,
  _resource: SyncResource,
  _cursor: NestedCursor,
  _perPage: number,
): Promise<{
  rows: Record<string, any>[]
  hasMore: boolean
  nextCursor: NestedCursor | null
  upsertedEstimate: number
}> {
  return { rows: [], hasMore: false, nextCursor: null, upsertedEstimate: 0 }
}

/** All tables that hold PCO-synced data (for purge) */
export const PCO_TABLES = [
  'attendance_records',
  'team_memberships',
  'group_memberships',
  'teams',
  'groups',
  'people',
]
