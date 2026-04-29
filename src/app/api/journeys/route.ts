import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/*
 * Journey timeline data for /journeys.
 *
 * One row per active person. Each row carries an array of dated events,
 * coalesced from every signal we currently sync:
 *
 *   group_join          gm.joined_at
 *   group_leave         gm.left_at
 *   group_attendance    group_event_attendances.attended=true (event date)
 *   team_join           tm.joined_at
 *   team_leave          tm.left_at
 *   team_serve          plan_team_members.status='C' (plan sort_date)
 *   form                pco_form_submissions.submitted_at
 *   signup              pco_signup_attendees.registered_at (active or waitlisted)
 *   checkin             attendance_records.checked_in_at
 *
 * Returns every active person (with eventCount=0 rows for those who have
 * no signals in the window — the page wants the full roster, not just
 * the active subset). Sorted most-active first.
 *
 * Pagination: PostgREST caps single responses at db-max-rows (1000 here),
 * regardless of .limit(). Every potentially-large query is fetched via
 * fetchAllPaged so we get the full result set. Without this the chart
 * would silently truncate to whichever 1000 rows came back first.
 *
 * For tables that have no date column to filter by directly
 * (group_event_attendances, plan_team_members) we use PostgREST nested
 * selects on their windowed parents (group_events, service_plans) — one
 * paginated stream pulls every parent in the window with its full set of
 * children embedded, which is dramatically faster than chunking .in().
 */

// Pagination round trips can stack up — give the function room to finish
// before Vercel's default 10s ceiling cuts us off.
export const maxDuration = 60

const PAGE = 1000

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchAllPaged<T>(buildQuery: (from: number, to: number) => any): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await buildQuery(from, from + PAGE - 1)
    if (error) throw error
    if (!data || data.length === 0) break
    out.push(...(data as T[]))
    if (data.length < PAGE) break
  }
  return out
}

const WINDOWS = {
  '3m': 90,
  '6m': 180,
  '12m': 365,
  'all': 9999,
} as const

type WindowKey = keyof typeof WINDOWS

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

interface JourneyEvent {
  at: string
  type: JourneyEventType
  label: string
}

interface PersonJourney {
  personId: string
  personName: string
  eventCount: number
  events: JourneyEvent[]
}

interface GroupEventWithAtts {
  id: string
  group_id: string
  starts_at: string | null
  group_event_attendances: { person_id: string; attended: boolean | null }[] | null
}

interface ServicePlanWithPtm {
  id: string
  sort_date: string | null
  plan_team_members: { person_id: string; team_id: string; status: string }[] | null
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

  const [
    peopleRows,
    groupMemberships,
    teamMemberships,
    groupEventsWithAtts,
    servicePlansWithPtm,
    formSubmissions,
    forms,
    signupAttendees,
    signups,
    checkins,
    groups,
    teams,
  ] = await Promise.all([
    fetchAllPaged<{ id: string; name: string }>((from, to) =>
      supabase.from('people')
        .select('id, name')
        .eq('church_id', churchId)
        .eq('status', 'active')
        .eq('is_calculated_active', true)
        .order('id').range(from, to),
    ),
    fetchAllPaged<{ person_id: string; group_id: string; joined_at: string | null; left_at: string | null }>((from, to) =>
      supabase.from('group_memberships')
        .select('person_id, group_id, joined_at, left_at')
        .eq('church_id', churchId)
        .or(`joined_at.gte.${windowStartIso},left_at.gte.${windowStartIso}`)
        .order('id').range(from, to),
    ),
    fetchAllPaged<{ person_id: string; team_id: string; joined_at: string | null; left_at: string | null }>((from, to) =>
      supabase.from('team_memberships')
        .select('person_id, team_id, joined_at, left_at')
        .eq('church_id', churchId)
        .or(`joined_at.gte.${windowStartIso},left_at.gte.${windowStartIso}`)
        .order('id').range(from, to),
    ),
    fetchAllPaged<GroupEventWithAtts>((from, to) =>
      supabase.from('group_events')
        .select('id, group_id, starts_at, group_event_attendances(person_id, attended)')
        .eq('church_id', churchId)
        .gte('starts_at', windowStartIso)
        .order('id').range(from, to),
    ),
    fetchAllPaged<ServicePlanWithPtm>((from, to) =>
      supabase.from('service_plans')
        .select('id, sort_date, plan_team_members(person_id, team_id, status)')
        .eq('church_id', churchId)
        .gte('sort_date', windowStartIso)
        .order('id').range(from, to),
    ),
    fetchAllPaged<{ person_id: string; form_pco_id: string; submitted_at: string | null }>((from, to) =>
      supabase.from('pco_form_submissions')
        .select('person_id, form_pco_id, submitted_at')
        .eq('church_id', churchId)
        .gte('submitted_at', windowStartIso)
        .not('person_id', 'is', null)
        .order('submitted_at').range(from, to),
    ),
    supabase.from('pco_form_sync_config')
      .select('form_pco_id, label, purpose')
      .eq('church_id', churchId).eq('is_active', true)
      .then(r => (r.data ?? []) as { form_pco_id: string; label: string; purpose: string | null }[]),
    fetchAllPaged<{ person_id: string; signup_id: string; registered_at: string | null; active: boolean | null; waitlisted: boolean | null; canceled: boolean | null }>((from, to) =>
      supabase.from('pco_signup_attendees')
        .select('person_id, signup_id, registered_at, active, waitlisted, canceled')
        .eq('church_id', churchId)
        .gte('registered_at', windowStartIso)
        .not('person_id', 'is', null)
        .order('registered_at').range(from, to),
    ),
    supabase.from('pco_signups').select('id, name')
      .then(r => (r.data ?? []) as { id: string; name: string | null }[]),
    fetchAllPaged<{ person_id: string; checked_in_at: string | null; service_type: string | null }>((from, to) =>
      supabase.from('attendance_records')
        .select('person_id, checked_in_at, service_type')
        .eq('church_id', churchId)
        .gte('checked_in_at', windowStartIso)
        .not('person_id', 'is', null)
        .order('checked_in_at').range(from, to),
    ),
    supabase.from('groups').select('id, name')
      .then(r => (r.data ?? []) as { id: string; name: string | null }[]),
    supabase.from('teams').select('id, name')
      .then(r => (r.data ?? []) as { id: string; name: string | null }[]),
  ])

  // Lookup tables for human-readable event labels.
  const groupName = new Map<string, string>(groups.map(g => [g.id, g.name ?? 'Group']))
  const teamName = new Map<string, string>(teams.map(t => [t.id, t.name ?? 'Team']))
  const formLabel = new Map<string, string>(
    forms.map(f => [f.form_pco_id, f.purpose ? `Form: ${cap(f.purpose)}` : `Form: ${f.label}`]),
  )
  const signupNameMap = new Map<string, string>(
    signups.map(s => [s.id, truncate(s.name ?? 'Unknown signup', 40)]),
  )

  // Build per-person event lists.
  const personMap = new Map<string, PersonJourney>()
  for (const p of peopleRows) {
    personMap.set(p.id, { personId: p.id, personName: p.name, eventCount: 0, events: [] })
  }
  const push = (pid: string, ev: JourneyEvent) => {
    const j = personMap.get(pid)
    if (!j) return
    j.events.push(ev)
    j.eventCount++
  }

  for (const m of groupMemberships) {
    if (m.joined_at && Date.parse(m.joined_at) >= windowStart) {
      push(m.person_id, { at: m.joined_at, type: 'group_join', label: `Joined ${groupName.get(m.group_id) ?? 'group'}` })
    }
    if (m.left_at && Date.parse(m.left_at) >= windowStart) {
      push(m.person_id, { at: m.left_at, type: 'group_leave', label: `Left ${groupName.get(m.group_id) ?? 'group'}` })
    }
  }
  for (const m of teamMemberships) {
    if (m.joined_at && Date.parse(m.joined_at) >= windowStart) {
      push(m.person_id, { at: m.joined_at, type: 'team_join', label: `Joined ${teamName.get(m.team_id) ?? 'team'}` })
    }
    if (m.left_at && Date.parse(m.left_at) >= windowStart) {
      push(m.person_id, { at: m.left_at, type: 'team_leave', label: `Left ${teamName.get(m.team_id) ?? 'team'}` })
    }
  }
  for (const ev of groupEventsWithAtts) {
    if (!ev.starts_at) continue
    if (Date.parse(ev.starts_at) < windowStart) continue
    for (const a of ev.group_event_attendances ?? []) {
      if (!a.attended) continue
      push(a.person_id, { at: ev.starts_at, type: 'group_attendance', label: `Attended ${groupName.get(ev.group_id) ?? 'group'}` })
    }
  }
  for (const sp of servicePlansWithPtm) {
    if (!sp.sort_date) continue
    if (Date.parse(sp.sort_date) < windowStart) continue
    for (const ptm of sp.plan_team_members ?? []) {
      if (ptm.status !== 'C') continue
      push(ptm.person_id, { at: sp.sort_date, type: 'team_serve', label: `Served on ${teamName.get(ptm.team_id) ?? 'team'}` })
    }
  }
  for (const s of formSubmissions) {
    if (!s.submitted_at) continue
    push(s.person_id, { at: s.submitted_at, type: 'form', label: formLabel.get(s.form_pco_id) ?? 'Form' })
  }
  for (const sa of signupAttendees) {
    if (!sa.registered_at) continue
    if (sa.canceled) continue
    if (!(sa.active || sa.waitlisted)) continue
    push(sa.person_id, { at: sa.registered_at, type: 'signup', label: `Signup: ${signupNameMap.get(sa.signup_id) ?? 'Unknown'}` })
  }
  for (const c of checkins) {
    if (!c.checked_in_at) continue
    push(c.person_id, { at: c.checked_in_at, type: 'checkin', label: c.service_type ? `Check-in: ${c.service_type}` : 'Check-in' })
  }

  // Sort each timeline ascending and rank by event count.
  for (const j of personMap.values()) {
    j.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  }
  // Return every active person, even those with no events in this window
  // — empty rows convey "no recorded activity" at a glance.
  const people = Array.from(personMap.values())
  people.sort((a, b) => b.eventCount - a.eventCount)
  const totalWithEvents = people.filter(p => p.eventCount > 0).length

  return NextResponse.json(
    {
      window: windowKey,
      windowDays: WINDOWS[windowKey],
      generatedAt: new Date().toISOString(),
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(now).toISOString(),
      total: people.length,
      totalWithEvents,
      returned: people.length,
      people,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=120, stale-while-revalidate=600',
      },
    },
  )
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}
