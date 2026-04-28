import { createClient } from '@/lib/supabase/server'
import { NextRequest, NextResponse } from 'next/server'

/*
 * Journey timeline data for /journeys.
 *
 * One row per person. Each row carries an array of dated events,
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
 * The page color-codes by `type`. Colors are chosen client-side so we
 * don't bake palette decisions into the API.
 *
 * Volume control: by default we return the top N=100 most-active people
 * in the window (most events). The page can ask for a specific person by
 * personId, in which case the cap doesn't apply and we return that one
 * timeline.
 */

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

const DEFAULT_LIMIT = 100
const MAX_LIMIT = 500

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
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(params.get('limit')) || DEFAULT_LIMIT))
  const search = params.get('search')?.trim() ?? ''
  const personId = params.get('personId')?.trim() ?? ''

  const now = Date.now()
  const windowStart = now - WINDOWS[windowKey] * 86400000
  const windowStartIso = new Date(windowStart).toISOString()

  /*
   * 1. Fetch raw events. Each query is bounded to the window. When
   *    personId or search is set we restrict the people set first to
   *    keep payloads manageable.
   */
  const peopleQuery = supabase
    .from('people')
    .select('id, name')
    .eq('church_id', churchId)
    .eq('status', 'active')
  const peopleScoped = personId
    ? peopleQuery.eq('id', personId)
    : search
      ? peopleQuery.ilike('name', `%${search}%`).limit(MAX_LIMIT)
      : peopleQuery.limit(2000)

  const [
    { data: peopleRows },
    { data: groupMemberships },
    { data: teamMemberships },
    { data: groupEvents },
    { data: groupEventAtts },
    { data: planTeamMembers },
    { data: servicePlans },
    { data: formSubmissions },
    { data: forms },
    { data: signupAttendees },
    { data: signups },
    { data: checkins },
    { data: groups },
    { data: teams },
  ] = await Promise.all([
    peopleScoped,
    supabase
      .from('group_memberships')
      .select('person_id, group_id, joined_at, left_at')
      .eq('church_id', churchId)
      .or(`joined_at.gte.${windowStartIso},left_at.gte.${windowStartIso}`),
    supabase
      .from('team_memberships')
      .select('person_id, team_id, joined_at, left_at')
      .eq('church_id', churchId)
      .or(`joined_at.gte.${windowStartIso},left_at.gte.${windowStartIso}`),
    supabase.from('group_events').select('id, group_id, starts_at').eq('church_id', churchId).gte('starts_at', windowStartIso),
    supabase.from('group_event_attendances').select('person_id, event_id').eq('church_id', churchId).eq('attended', true),
    supabase.from('plan_team_members').select('person_id, team_id, plan_id, status').eq('church_id', churchId).eq('status', 'C'),
    supabase.from('service_plans').select('id, sort_date').eq('church_id', churchId).gte('sort_date', windowStartIso),
    supabase.from('pco_form_submissions').select('person_id, form_pco_id, submitted_at').eq('church_id', churchId).gte('submitted_at', windowStartIso).not('person_id', 'is', null),
    supabase.from('pco_form_sync_config').select('form_pco_id, label, purpose').eq('church_id', churchId).eq('is_active', true),
    supabase.from('pco_signup_attendees').select('person_id, signup_id, registered_at, active, waitlisted, canceled').eq('church_id', churchId).gte('registered_at', windowStartIso).not('person_id', 'is', null),
    supabase.from('pco_signups').select('id, name'),
    supabase.from('attendance_records').select('person_id, checked_in_at, service_type').eq('church_id', churchId).gte('checked_in_at', windowStartIso).not('person_id', 'is', null).limit(50000),
    supabase.from('groups').select('id, name'),
    supabase.from('teams').select('id, name'),
  ])

  // 2. Lookup tables.
  const groupName = new Map<string, string>(((groups ?? []) as { id: string; name: string | null }[]).map(g => [g.id, g.name ?? 'Group']))
  const teamName = new Map<string, string>(((teams ?? []) as { id: string; name: string | null }[]).map(t => [t.id, t.name ?? 'Team']))
  const eventGroup = new Map<string, { groupId: string; startsAt: string }>(
    ((groupEvents ?? []) as { id: string; group_id: string; starts_at: string | null }[])
      .filter(e => e.starts_at)
      .map(e => [e.id, { groupId: e.group_id, startsAt: e.starts_at as string }]),
  )
  const planDate = new Map<string, string>(
    ((servicePlans ?? []) as { id: string; sort_date: string | null }[])
      .filter(p => p.sort_date)
      .map(p => [p.id, p.sort_date as string]),
  )
  const formLabel = new Map<string, string>(
    ((forms ?? []) as { form_pco_id: string; label: string; purpose: string | null }[])
      .map(f => [f.form_pco_id, f.purpose ? `Form: ${cap(f.purpose)}` : `Form: ${f.label}`]),
  )
  const signupNameMap = new Map<string, string>(
    ((signups ?? []) as { id: string; name: string | null }[]).map(s => [s.id, truncate(s.name ?? 'Unknown signup', 40)]),
  )

  // 3. Build per-person event lists.
  const personMap = new Map<string, PersonJourney>()
  for (const p of (peopleRows ?? []) as { id: string; name: string }[]) {
    personMap.set(p.id, { personId: p.id, personName: p.name, eventCount: 0, events: [] })
  }
  const push = (pid: string, ev: JourneyEvent) => {
    const j = personMap.get(pid)
    if (!j) return
    j.events.push(ev)
    j.eventCount++
  }

  for (const m of (groupMemberships ?? []) as { person_id: string; group_id: string; joined_at: string | null; left_at: string | null }[]) {
    if (m.joined_at && Date.parse(m.joined_at) >= windowStart) {
      push(m.person_id, { at: m.joined_at, type: 'group_join', label: `Joined ${groupName.get(m.group_id) ?? 'group'}` })
    }
    if (m.left_at && Date.parse(m.left_at) >= windowStart) {
      push(m.person_id, { at: m.left_at, type: 'group_leave', label: `Left ${groupName.get(m.group_id) ?? 'group'}` })
    }
  }
  for (const m of (teamMemberships ?? []) as { person_id: string; team_id: string; joined_at: string | null; left_at: string | null }[]) {
    if (m.joined_at && Date.parse(m.joined_at) >= windowStart) {
      push(m.person_id, { at: m.joined_at, type: 'team_join', label: `Joined ${teamName.get(m.team_id) ?? 'team'}` })
    }
    if (m.left_at && Date.parse(m.left_at) >= windowStart) {
      push(m.person_id, { at: m.left_at, type: 'team_leave', label: `Left ${teamName.get(m.team_id) ?? 'team'}` })
    }
  }
  for (const a of (groupEventAtts ?? []) as { person_id: string; event_id: string }[]) {
    const ev = eventGroup.get(a.event_id)
    if (!ev) continue
    if (Date.parse(ev.startsAt) < windowStart) continue
    push(a.person_id, { at: ev.startsAt, type: 'group_attendance', label: `Attended ${groupName.get(ev.groupId) ?? 'group'}` })
  }
  for (const ptm of (planTeamMembers ?? []) as { person_id: string; team_id: string; plan_id: string; status: string }[]) {
    const date = planDate.get(ptm.plan_id)
    if (!date) continue
    if (Date.parse(date) < windowStart) continue
    push(ptm.person_id, { at: date, type: 'team_serve', label: `Served on ${teamName.get(ptm.team_id) ?? 'team'}` })
  }
  for (const s of (formSubmissions ?? []) as { person_id: string; form_pco_id: string; submitted_at: string | null }[]) {
    if (!s.submitted_at) continue
    push(s.person_id, { at: s.submitted_at, type: 'form', label: formLabel.get(s.form_pco_id) ?? 'Form' })
  }
  for (const sa of (signupAttendees ?? []) as { person_id: string; signup_id: string; registered_at: string | null; active: boolean | null; waitlisted: boolean | null; canceled: boolean | null }[]) {
    if (!sa.registered_at) continue
    if (sa.canceled) continue
    if (!(sa.active || sa.waitlisted)) continue
    push(sa.person_id, { at: sa.registered_at, type: 'signup', label: `Signup: ${signupNameMap.get(sa.signup_id) ?? 'Unknown'}` })
  }
  for (const c of (checkins ?? []) as { person_id: string; checked_in_at: string | null; service_type: string | null }[]) {
    if (!c.checked_in_at) continue
    push(c.person_id, { at: c.checked_in_at, type: 'checkin', label: c.service_type ? `Check-in: ${c.service_type}` : 'Check-in' })
  }

  // 4. Sort each timeline ascending and rank by event count.
  for (const j of personMap.values()) {
    j.events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  }
  let people = Array.from(personMap.values()).filter(j => j.eventCount > 0)
  people.sort((a, b) => b.eventCount - a.eventCount)
  const totalWithEvents = people.length
  if (!personId) people = people.slice(0, limit)

  return NextResponse.json(
    {
      window: windowKey,
      windowDays: WINDOWS[windowKey],
      generatedAt: new Date().toISOString(),
      windowStart: new Date(windowStart).toISOString(),
      windowEnd: new Date(now).toISOString(),
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
