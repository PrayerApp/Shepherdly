import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/*
 * Handoff data for the /handoffs page.
 *
 * Two Sankeys:
 *
 *   ENTRY — input signal → group/team type
 *     For each membership joined within the window, find the most recent
 *     input signal for the same person within INPUT_LOOKBACK_DAYS before
 *     the join. Inputs are: form submissions tagged by purpose, signup
 *     attendances grouped by signup name, and a generic "No prior signal"
 *     when nothing is found.
 *
 *   EXIT — group/team type → next context (or "Inactive")
 *     For each membership LEFT within the window, find the next group or
 *     team join AFTER the leave date (within EXIT_LOOKAHEAD_DAYS). The
 *     target is "Group: <type>", "Team: <type>", or "Inactive (no further
 *     engagement)".
 *
 * Implementation note: PCO does not expose a left_at on memberships;
 * ours is inferred by markDepartedMemberships during the cron sync. So
 * exit data is only meaningful for memberships that have actually been
 * seen-and-then-not-seen across at least one sync cycle.
 *
 * No materialized view yet — the JS aggregation runs ad-hoc on the route.
 * If this gets slow on large churches we'll move it into SQL alongside
 * the stats views.
 */

const WINDOWS = {
  '3m': 90,
  '6m': 180,
  '12m': 365,
} as const

type WindowKey = keyof typeof WINDOWS

const INPUT_LOOKBACK_DAYS = 60
const EXIT_LOOKAHEAD_DAYS = 180

interface SankeyNode {
  id: string
  label: string
  kind: 'input' | 'group_type' | 'team_type' | 'terminal'
}

interface SankeyLink {
  source: string
  target: string
  value: number
}

interface MembershipRow {
  person_id: string
  context_id: string
  context_kind: 'group' | 'team'
  joined_at: string | null
  left_at: string | null
  is_active: boolean
}

interface InputSignal {
  at: number /* ms since epoch */
  label: string
}

const NO_SIGNAL_NODE: SankeyNode = {
  id: 'input:no_signal',
  label: 'No prior signal',
  kind: 'input',
}
const INACTIVE_NODE: SankeyNode = {
  id: 'terminal:inactive',
  label: 'Inactive (no further engagement)',
  kind: 'terminal',
}

export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('users').select('church_id').eq('user_id', user.id).single()
  if (!appUser) return NextResponse.json({ error: 'No profile' }, { status: 403 })
  const churchId = appUser.church_id as string

  const params = request.nextUrl.searchParams
  const windowParam = params.get('window') as WindowKey | null
  const windowKey: WindowKey = windowParam && windowParam in WINDOWS ? windowParam : '12m'

  const now = Date.now()
  const windowStart = now - WINDOWS[windowKey] * 86400000
  const windowStartIso = new Date(windowStart).toISOString()
  const inputLookbackStartIso = new Date(windowStart - INPUT_LOOKBACK_DAYS * 86400000).toISOString()

  // 1. Fetch source data in parallel.
  // activePeopleRows is the calculated-active subset: anyone whose
  // person_id isn't here is excluded from every count below. This
  // matches the site-wide rule that shepherding stats only see active
  // people.
  const [
    { data: activePeopleRows },
    { data: groupMembershipsRaw },
    { data: teamMembershipsRaw },
    { data: groups },
    { data: teams },
    { data: groupTypes },
    { data: serviceTypes },
    { data: forms },
    { data: formSubmissions },
    { data: signups },
    { data: signupAttendees },
  ] = await Promise.all([
    supabase.from('people').select('id')
      .eq('church_id', churchId)
      .eq('is_calculated_active', true),
    supabase
      .from('group_memberships')
      .select('person_id, group_id, joined_at, left_at, is_active')
      .eq('church_id', churchId)
      .or(`joined_at.gte.${windowStartIso},left_at.gte.${windowStartIso}`),
    supabase
      .from('team_memberships')
      .select('person_id, team_id, joined_at, left_at, is_active')
      .eq('church_id', churchId)
      .or(`joined_at.gte.${windowStartIso},left_at.gte.${windowStartIso}`),
    supabase.from('groups').select('id, group_type_id').eq('church_id', churchId),
    supabase.from('teams').select('id, service_type_id').eq('church_id', churchId),
    supabase.from('group_types').select('id, name').eq('church_id', churchId).eq('is_tracked', true),
    supabase.from('service_types').select('id, name').eq('church_id', churchId).eq('is_tracked', true),
    supabase.from('pco_form_sync_config').select('form_pco_id, label, purpose').eq('church_id', churchId).eq('is_active', true),
    supabase.from('pco_form_submissions').select('person_id, form_pco_id, submitted_at')
      .eq('church_id', churchId)
      .gte('submitted_at', inputLookbackStartIso)
      .not('person_id', 'is', null),
    supabase.from('pco_signups').select('id, name'),
    supabase.from('pco_signup_attendees').select('person_id, signup_id, registered_at, active, waitlisted, canceled')
      .eq('church_id', churchId)
      .gte('registered_at', inputLookbackStartIso)
      .not('person_id', 'is', null),
  ])

  // Active-person gate. Membership rows for inactive people get
  // dropped before they can contribute to any sankey link.
  const activePersonIds = new Set<string>(((activePeopleRows ?? []) as { id: string }[]).map(p => p.id))

  // 2. Lookup tables.
  const groupTypeId = new Map<string, string>()
  for (const g of (groups ?? []) as { id: string; group_type_id: string | null }[]) {
    if (g.group_type_id) groupTypeId.set(g.id, g.group_type_id)
  }
  const teamTypeId = new Map<string, string>()
  for (const t of (teams ?? []) as { id: string; service_type_id: string | null }[]) {
    if (t.service_type_id) teamTypeId.set(t.id, t.service_type_id)
  }
  const groupTypeName = new Map<string, string>(
    ((groupTypes ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name]),
  )
  const teamTypeName = new Map<string, string>(
    ((serviceTypes ?? []) as { id: string; name: string }[]).map(t => [t.id, t.name]),
  )
  const formLabelByPcoId = new Map<string, string>(
    ((forms ?? []) as { form_pco_id: string; label: string; purpose: string | null }[])
      .map(f => [f.form_pco_id, f.purpose ? `Form: ${cap(f.purpose)}` : `Form: ${f.label}`]),
  )
  const signupName = new Map<string, string>(
    ((signups ?? []) as { id: string; name: string | null }[])
      .map(s => [s.id, s.name ?? 'Unknown signup']),
  )

  // 3. Per-person sorted input-signal lists. Inactive persons are
  // filtered up front so they can't contribute to entry/exit links.
  const inputsByPerson = new Map<string, InputSignal[]>()
  for (const s of (formSubmissions ?? []) as { person_id: string; form_pco_id: string; submitted_at: string | null }[]) {
    if (!s.submitted_at) continue
    if (!activePersonIds.has(s.person_id)) continue
    const label = formLabelByPcoId.get(s.form_pco_id) ?? 'Form: Other'
    pushInto(inputsByPerson, s.person_id, { at: Date.parse(s.submitted_at), label })
  }
  for (const a of (signupAttendees ?? []) as { person_id: string; signup_id: string; registered_at: string | null; active: boolean | null; waitlisted: boolean | null; canceled: boolean | null }[]) {
    if (!a.registered_at) continue
    if (a.canceled) continue
    if (!(a.active || a.waitlisted)) continue
    if (!activePersonIds.has(a.person_id)) continue
    const name = signupName.get(a.signup_id) ?? 'Unknown'
    pushInto(inputsByPerson, a.person_id, { at: Date.parse(a.registered_at), label: `Signup: ${truncate(name, 32)}` })
  }
  for (const list of inputsByPerson.values()) list.sort((x, y) => x.at - y.at)

  // 4. Combine memberships into a single per-person sorted list of joins.
  const allMemberships: MembershipRow[] = []
  for (const m of (groupMembershipsRaw ?? []) as { person_id: string; group_id: string; joined_at: string | null; left_at: string | null; is_active: boolean }[]) {
    if (!activePersonIds.has(m.person_id)) continue
    allMemberships.push({
      person_id: m.person_id,
      context_id: m.group_id,
      context_kind: 'group',
      joined_at: m.joined_at,
      left_at: m.left_at,
      is_active: m.is_active,
    })
  }
  for (const m of (teamMembershipsRaw ?? []) as { person_id: string; team_id: string; joined_at: string | null; left_at: string | null; is_active: boolean }[]) {
    if (!activePersonIds.has(m.person_id)) continue
    allMemberships.push({
      person_id: m.person_id,
      context_id: m.team_id,
      context_kind: 'team',
      joined_at: m.joined_at,
      left_at: m.left_at,
      is_active: m.is_active,
    })
  }

  const joinsByPerson = new Map<string, MembershipRow[]>()
  for (const m of allMemberships) {
    if (!m.joined_at) continue
    pushInto(joinsByPerson, m.person_id, m)
  }
  for (const list of joinsByPerson.values()) {
    list.sort((x, y) => Date.parse(x.joined_at!) - Date.parse(y.joined_at!))
  }

  // 5. Per-request node registry — keyed by id, holds label + kind.
  const nodeMeta = new Map<string, SankeyNode>()
  const registerNode = (n: SankeyNode) => {
    if (!nodeMeta.has(n.id)) nodeMeta.set(n.id, n)
  }
  registerNode(NO_SIGNAL_NODE)
  registerNode(INACTIVE_NODE)

  const labelForContext = (m: MembershipRow): SankeyNode | null => {
    if (m.context_kind === 'group') {
      const tid = groupTypeId.get(m.context_id)
      if (!tid) return null
      const name = groupTypeName.get(tid)
      if (!name) return null
      return { id: `group_type:${tid}`, label: `Group: ${name}`, kind: 'group_type' }
    }
    const stid = teamTypeId.get(m.context_id)
    if (!stid) return null
    const name = teamTypeName.get(stid)
    if (!name) return null
    return { id: `team_type:${stid}`, label: `Team: ${name}`, kind: 'team_type' }
  }

  // For the EXIT sankey only, the same group/team type can appear as
  // both a source (people leaving it) and a target (people landing in
  // it after leaving somewhere else). Without namespacing, that creates
  // a cycle and d3-sankey throws "circular link". Source-side and
  // target-side nodes share a label but get distinct ids, which is
  // standard bipartite-Sankey practice.
  const exitNodeAs = (m: MembershipRow, role: 'from' | 'to'): SankeyNode | null => {
    const base = labelForContext(m)
    if (!base) return null
    return { ...base, id: `exit_${role}:${base.id}` }
  }

  // 6. Build entry sankey.
  const entryLinks = new Map<string, number>()
  const entryNodeIds = new Set<string>()
  for (const m of allMemberships) {
    if (!m.joined_at) continue
    const joinedAt = Date.parse(m.joined_at)
    if (joinedAt < windowStart) continue
    const target = labelForContext(m)
    if (!target) continue
    registerNode(target)

    const inputs = inputsByPerson.get(m.person_id) ?? []
    let chosen: InputSignal | null = null
    for (let i = inputs.length - 1; i >= 0; i--) {
      const sig = inputs[i]
      if (sig.at >= joinedAt) continue
      if (joinedAt - sig.at > INPUT_LOOKBACK_DAYS * 86400000) break
      chosen = sig
      break
    }
    let source: SankeyNode
    if (chosen) {
      source = { id: `input:${slug(chosen.label)}`, label: chosen.label, kind: 'input' }
    } else {
      source = NO_SIGNAL_NODE
    }
    registerNode(source)
    entryNodeIds.add(source.id)
    entryNodeIds.add(target.id)
    entryLinks.set(`${source.id}>>${target.id}`, (entryLinks.get(`${source.id}>>${target.id}`) ?? 0) + 1)
  }

  // 7. Build exit sankey.
  const exitLinks = new Map<string, number>()
  const exitNodeIds = new Set<string>()
  for (const m of allMemberships) {
    if (!m.left_at) continue
    const leftAt = Date.parse(m.left_at)
    if (leftAt < windowStart) continue
    const source = exitNodeAs(m, 'from')
    if (!source) continue
    registerNode(source)

    const future = (joinsByPerson.get(m.person_id) ?? [])
      .filter(j => {
        if (!j.joined_at) return false
        const j_at = Date.parse(j.joined_at)
        return j_at > leftAt && j_at - leftAt <= EXIT_LOOKAHEAD_DAYS * 86400000
      })

    let target: SankeyNode | null = null
    if (future.length === 0) {
      target = INACTIVE_NODE
    } else {
      target = exitNodeAs(future[0], 'to')
    }
    if (!target) continue
    registerNode(target)
    exitNodeIds.add(source.id)
    exitNodeIds.add(target.id)
    exitLinks.set(`${source.id}>>${target.id}`, (exitLinks.get(`${source.id}>>${target.id}`) ?? 0) + 1)
  }

  return NextResponse.json(
    {
      window: windowKey,
      windowDays: WINDOWS[windowKey],
      generatedAt: new Date().toISOString(),
      entry: {
        nodes: collectNodes(entryNodeIds, nodeMeta),
        links: serializeLinks(entryLinks),
      },
      exit: {
        nodes: collectNodes(exitNodeIds, nodeMeta),
        links: serializeLinks(exitLinks),
      },
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=120, stale-while-revalidate=600',
      },
    },
  )
}

function collectNodes(ids: Set<string>, meta: Map<string, SankeyNode>): SankeyNode[] {
  const out: SankeyNode[] = []
  for (const id of ids) {
    const n = meta.get(id)
    if (n) out.push(n)
  }
  return out.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind) || a.label.localeCompare(b.label))
}

function serializeLinks(map: Map<string, number>): SankeyLink[] {
  return Array.from(map.entries())
    .map(([k, v]) => {
      const [source, target] = k.split('>>')
      return { source, target, value: v }
    })
    .sort((a, b) => b.value - a.value)
}

function kindOrder(k: SankeyNode['kind']): number {
  if (k === 'input') return 0
  if (k === 'group_type') return 1
  if (k === 'team_type') return 2
  return 3
}

function pushInto<K, V>(map: Map<K, V[]>, key: K, value: V) {
  const list = map.get(key)
  if (list) list.push(value)
  else map.set(key, [value])
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}
