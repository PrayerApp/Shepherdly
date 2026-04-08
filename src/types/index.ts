// ── Roles & Constants ────────────────────────────────────────

export type UserRole = 'super_admin' | 'staff' | 'coach' | 'leader'
export type SyncStatus = 'pending' | 'running' | 'success' | 'failed'
export type CheckInStatus = 'new' | 'reviewed' | 'resolved'

export const ROLE_LABELS: Record<UserRole, string> = {
  super_admin: 'Admin',
  staff: 'Staff',
  coach: 'Coach',
  leader: 'Leader',
}

export const ROLE_COLORS: Record<UserRole, string> = {
  super_admin: '#2d6047',
  staff: '#3a5f8a',
  coach: '#6b4c9e',
  leader: '#c17f3e',
}

export const ROLE_ORDER: UserRole[] = ['super_admin', 'staff', 'coach', 'leader']

// ── Core Tables ──────────────────────────────────────────────

/** `users` table — app users linked to auth.users */
export interface User {
  id: string
  user_id: string          // FK to auth.users
  church_id: string | null
  name: string | null
  email: string
  role: UserRole
  photo_url: string | null
  is_active: boolean
  created_at: string
  updated_at: string
}

/** `churches` table */
export interface Church {
  id: string
  name: string
  owner_user_id: string | null
  invite_code: string
  created_at: string
  updated_at: string
}

/** `people` table — congregation members synced from PCO */
export interface Person {
  id: string
  pco_id: string | null
  name: string
  email: string | null
  phone: string | null
  shepherd_id: string | null  // self-FK to people.id
  is_leader: boolean
  status: string
  membership_type: string
  engagement_score: number | null
  attendance_count_90d: number | null
  first_attended_at: string | null
  last_attended_at: string | null
  is_active: boolean
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `groups` table */
export interface Group {
  id: string
  pco_id: string | null
  name: string
  description: string | null
  group_type: string
  schedule: string | null
  location: string | null
  is_pco_synced: boolean
  is_active: boolean
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `group_memberships` table */
export interface GroupMembership {
  id: string
  person_id: string
  group_id: string
  role: string
  pco_id: string | null
  joined_at: string | null
  left_at: string | null
  is_active: boolean
  created_at: string
}

/** `teams` table */
export interface Team {
  id: string
  pco_id: string | null
  name: string
  description: string | null
  team_type: string
  is_pco_synced: boolean
  is_active: boolean
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `team_memberships` table */
export interface TeamMembership {
  id: string
  person_id: string
  team_id: string
  role: string
  position: string | null
  pco_id: string | null
  created_at: string
}

/** `shepherding_relationships` table */
export interface ShepherdingRelationship {
  id: string
  shepherd_id: string  // FK to people
  person_id: string    // FK to people
  type: string | null
  created_at: string
}

/** `attendance_records` table */
export interface AttendanceRecord {
  id: string
  person_id: string
  pco_person_id: string | null
  event_date: string | null
  service_type: string | null
  pco_event_id: string | null
  pco_event_period_id: string | null
  checked_in_at: string | null
  church_id: string | null
  created_at: string
}

/** `check_in_reports` table — leader reports about their flock */
export interface CheckInReport {
  id: string
  leader_id: string        // FK to people
  group_name: string | null
  going_well: string | null
  needs_attention: string | null
  prayer_requests: string | null
  is_urgent: boolean
  status: CheckInStatus
  context_type: string
  context_id: string | null
  respondent_id: string | null  // FK to users
  church_id: string | null
  report_date: string
  created_at: string
  updated_at: string
}

/** `surveys` table */
export interface Survey {
  id: string
  title: string
  questions: Record<string, unknown>[]
  target_role: string
  is_active: boolean
  created_by: string | null  // FK to users
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `survey_responses` table */
export interface SurveyResponse {
  id: string
  survey_id: string
  respondent_id: string | null  // FK to users
  target_person_id: string | null  // FK to people
  context_type: string | null
  context_id: string | null
  answers: Record<string, unknown>
  is_urgent: boolean
  church_id: string | null
  created_at: string
}

/** `ministry_impact_reports` table */
export interface MinistryImpactReport {
  id: string
  church_id: string | null
  title: string
  reporting_period_start: string | null
  reporting_period_end: string | null
  metrics: Record<string, string | number>
  narrative: string | null
  outcomes: string | null
  created_by: string | null
  status: 'draft' | 'submitted' | 'approved'
  created_at: string
  updated_at: string
}

/** `planning_center_credentials` table */
export interface PlanningCenterCredential {
  id: string
  user_id: string
  app_id: string | null
  app_secret: string | null
  is_active: boolean
  last_synced_at: string | null
  church_id: string | null
  created_at: string
  updated_at: string
}

/** `pco_sync_log` table */
export interface PcoSyncLog {
  id: string
  sync_type: string | null
  started_at: string | null
  completed_at: string | null
  records_synced: number
  status: SyncStatus
  error_message: string | null
  credential_id: string | null  // FK to planning_center_credentials
  church_id: string | null
  created_at: string
}

/** `resources` table */
export interface Resource {
  id: string
  title: string
  description: string | null
  type: string | null
  category: string | null
  author: string | null
  url: string | null
  image_url: string | null
  church_id: string | null
  created_at: string
  updated_at: string
}
