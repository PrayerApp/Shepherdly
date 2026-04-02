export type UserRole = 'lead_pastor' | 'admin' | 'staff' | 'coach' | 'leader'
export type InteractionType = 'in_person' | 'phone_call' | 'text' | 'email' | 'video_call' | 'other'
export type SurveyStatus = 'pending' | 'completed' | 'skipped'
export type HealthStatus = 'thriving' | 'growing' | 'concerning' | 'unknown'

export interface AppUser {
  id: string
  person_id?: string
  email: string
  first_name: string
  last_name: string
  role: UserRole
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Person {
  id: string
  pco_id: string
  first_name: string
  last_name: string
  pco_created_at?: string
  pco_updated_at?: string
  last_synced_at: string
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ShepherdAssignment {
  id: string
  shepherd_id: string
  person_id: string
  assigned_at: string
  assigned_by?: string
  source: 'manual' | 'pco_group' | 'pco_team'
  pco_group_id?: string
  pco_team_id?: string
  is_active: boolean
  person?: Person
  shepherd?: AppUser
}

export interface LeadershipHierarchy {
  id: string
  supervisor_id: string
  subordinate_id: string
  created_at: string
  supervisor?: AppUser
  subordinate?: AppUser
}

export interface Checkin {
  id: string
  shepherd_id: string
  person_id: string
  interaction_type: InteractionType
  health_status: HealthStatus
  notes?: string
  contacted_at: string
  created_at: string
  updated_at: string
  person?: Person
  shepherd?: AppUser
}

export interface Survey {
  id: string
  title: string
  description?: string
  questions: SurveyQuestion[]
  target_roles: UserRole[]
  is_active: boolean
  due_date?: string
  created_by?: string
  created_at: string
}

export interface SurveyQuestion {
  id: string
  text: string
  type: 'text' | 'rating' | 'boolean' | 'select'
  options?: string[]
  required: boolean
}

export interface SurveyResponse {
  id: string
  survey_id: string
  shepherd_id: string
  person_id?: string
  answers: Record<string, unknown>
  status: SurveyStatus
  submitted_at?: string
  created_at: string
}

export interface PCOSyncLog {
  id: string
  sync_type: string
  started_at: string
  completed_at?: string
  records_synced: number
  records_added: number
  records_updated: number
  errors: unknown[]
  status: 'running' | 'success' | 'failed'
}

export interface TreeNode {
  id: string
  name: string
  role: UserRole
  flock_size: number
  health_score?: number
  children: TreeNode[]
  shepherd_id?: string
  is_current_user?: boolean
}

export const ROLE_LABELS: Record<UserRole, string> = {
  lead_pastor: 'Lead Pastor',
  admin: 'Admin',
  staff: 'Staff',
  coach: 'Coach',
  leader: 'Leader',
}

export const ROLE_HIERARCHY: Record<UserRole, number> = {
  lead_pastor: 5,
  admin: 4,
  staff: 3,
  coach: 2,
  leader: 1,
}

export const HEALTH_COLORS: Record<HealthStatus, string> = {
  thriving: '#4ade80',
  growing: '#facc15',
  concerning: '#f87171',
  unknown: '#94a3b8',
}
