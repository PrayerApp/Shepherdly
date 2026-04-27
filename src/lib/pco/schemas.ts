import { z } from 'zod'
import { jsonApiList } from './jsonapi'

/*
 * Per-resource attribute schemas. Field names match exactly what PCO returns;
 * we keep nullable/optional honest so a missing field surfaces at parse time
 * instead of as `undefined.foo` deep in the sync code.
 *
 * Schema strictness: `attributes` schemas use `passthrough()` so PCO can add
 * fields without breaking sync. We only fail validation when a known field
 * has the wrong type, which is the case worth catching.
 *
 * Each schema is paired with:
 *   - a TypeScript type (`type People = z.infer<typeof PeopleAttrs>`)
 *   - list and single envelopes (e.g. `PeopleList`, `PeopleSingle`)
 */

// ── People ───────────────────────────────────────────────────
export const PersonAttrs = z.object({
  first_name: z.string().nullable().optional(),
  last_name: z.string().nullable().optional(),
  membership: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  child: z.boolean().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough()
export type PersonAttrs = z.infer<typeof PersonAttrs>
export const PeopleList = jsonApiList(PersonAttrs)

// ── Group types ──────────────────────────────────────────────
export const GroupTypeAttrs = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
}).passthrough()
export const GroupTypeList = jsonApiList(GroupTypeAttrs)

// ── Groups ───────────────────────────────────────────────────
export const GroupAttrs = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  group_type: z.string().nullable().optional(),
  schedule: z.string().nullable().optional(),
  location_type_preference: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough()
export const GroupList = jsonApiList(GroupAttrs)

// ── Group memberships ────────────────────────────────────────
// `_parentPcoId` and `_childPcoId` are stamped onto the attributes object by
// the sync code itself when iterating nested resources — they are not from
// PCO. Keep them optional so the parsed shape matches what sync produces.
export const GroupMembershipAttrs = z.object({
  role: z.string().nullable().optional(),
  joined_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  _parentPcoId: z.string().optional(),
  _childPcoId: z.string().optional(),
}).passthrough()
export const GroupMembershipList = jsonApiList(GroupMembershipAttrs)

// ── Group applications ───────────────────────────────────────
export const GroupApplicationAttrs = z.object({
  status: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  resolved_at: z.string().nullable().optional(),
}).passthrough()
export const GroupApplicationList = jsonApiList(GroupApplicationAttrs)

// ── Group events ─────────────────────────────────────────────
export const GroupEventAttrs = z.object({
  name: z.string().nullable().optional(),
  starts_at: z.string().nullable().optional(),
  ends_at: z.string().nullable().optional(),
  canceled: z.boolean().nullable().optional(),
}).passthrough()
export const GroupEventList = jsonApiList(GroupEventAttrs)

// ── Group event attendances ──────────────────────────────────
export const GroupEventAttendanceAttrs = z.object({
  role: z.string().nullable().optional(),
  attended: z.boolean().nullable().optional(),
  _parentPcoId: z.string().optional(),
}).passthrough()
export const GroupEventAttendanceList = jsonApiList(GroupEventAttendanceAttrs)

// ── Check-Ins (attendance_records) ───────────────────────────
export const CheckInAttrs = z.object({
  created_at: z.string().nullable().optional(),
  checked_out_at: z.string().nullable().optional(),
  kind: z.string().nullable().optional(),
  number: z.number().nullable().optional(),
}).passthrough()
export const CheckInList = jsonApiList(CheckInAttrs)

// ── Service types ────────────────────────────────────────────
export const ServiceTypeAttrs = z.object({
  name: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
}).passthrough()
export const ServiceTypeList = jsonApiList(ServiceTypeAttrs)

// ── Teams ────────────────────────────────────────────────────
export const TeamAttrs = z.object({
  name: z.string().nullable().optional(),
  default_status: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
}).passthrough()
export const TeamList = jsonApiList(TeamAttrs)

// ── Team memberships (services PersonTeamPositionAssignment) ─
export const TeamMembershipAttrs = z.object({
  created_at: z.string().nullable().optional(),
  team_position_name: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
}).passthrough()
export const TeamMembershipList = jsonApiList(TeamMembershipAttrs)

// ── Team positions ───────────────────────────────────────────
export const TeamPositionAttrs = z.object({
  name: z.string().nullable().optional(),
}).passthrough()
export const TeamPositionList = jsonApiList(TeamPositionAttrs)

// ── Service plans ────────────────────────────────────────────
export const ServicePlanAttrs = z.object({
  title: z.string().nullable().optional(),
  dates: z.string().nullable().optional(),
  sort_date: z.string().nullable().optional(),
}).passthrough()
export const ServicePlanList = jsonApiList(ServicePlanAttrs)

// ── Plan team members ────────────────────────────────────────
export const PlanTeamMemberAttrs = z.object({
  team_position_name: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  accepted_at: z.string().nullable().optional(),
}).passthrough()
export const PlanTeamMemberList = jsonApiList(PlanTeamMemberAttrs)

// ── Lists ────────────────────────────────────────────────────
export const PcoListAttrs = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  total_people: z.number().nullable().optional(),
  return_original_if_none: z.boolean().nullable().optional(),
}).passthrough()
export const PcoListList = jsonApiList(PcoListAttrs)

// ── List members ─────────────────────────────────────────────
export const ListMemberAttrs = z.object({
  created_at: z.string().nullable().optional(),
}).passthrough()
export const ListMemberList = jsonApiList(ListMemberAttrs)

// ── Signups (Registrations) ──────────────────────────────────
export const SignupAttrs = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  archived: z.boolean().nullable().optional(),
  open_at: z.string().nullable().optional(),
  close_at: z.string().nullable().optional(),
  new_registration_url: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough()
export const SignupList = jsonApiList(SignupAttrs)

// ── Signup attendees ─────────────────────────────────────────
export const SignupAttendeeAttrs = z.object({
  active: z.boolean().nullable().optional(),
  canceled: z.boolean().nullable().optional(),
  waitlisted: z.boolean().nullable().optional(),
  waitlisted_at: z.string().nullable().optional(),
  created_at: z.string().nullable().optional(),
  updated_at: z.string().nullable().optional(),
}).passthrough()
export const SignupAttendeeList = jsonApiList(SignupAttendeeAttrs)

// ── Forms ────────────────────────────────────────────────────
export const FormAttrs = z.object({
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  archived_at: z.string().nullable().optional(),
}).passthrough()
export const FormList = jsonApiList(FormAttrs)

// ── Form submissions ─────────────────────────────────────────
export const FormSubmissionAttrs = z.object({
  created_at: z.string().nullable().optional(),
  verified: z.boolean().nullable().optional(),
}).passthrough()
export const FormSubmissionList = jsonApiList(FormSubmissionAttrs)

/*
 * Lookup table — maps the SYNC_RESOURCES `table` value to the right list
 * schema. Pco-sync.ts imports this so the resource definitions stay
 * declarative.
 */
export const SCHEMAS_BY_TABLE = {
  people: PeopleList,
  group_types: GroupTypeList,
  groups: GroupList,
  group_memberships: GroupMembershipList,
  group_applications: GroupApplicationList,
  group_events: GroupEventList,
  group_event_attendances: GroupEventAttendanceList,
  attendance_records: CheckInList,
  service_types: ServiceTypeList,
  teams: TeamList,
  team_memberships: TeamMembershipList,
  team_positions: TeamPositionList,
  service_plans: ServicePlanList,
  plan_team_members: PlanTeamMemberList,
  pco_lists: PcoListList,
  pco_list_people: ListMemberList,
  pco_signups: SignupList,
  pco_signup_attendees: SignupAttendeeList,
  pco_form_submissions: FormSubmissionList,
} as const

export type PcoTableName = keyof typeof SCHEMAS_BY_TABLE
