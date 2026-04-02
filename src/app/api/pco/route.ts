import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt, decrypt } from '@/lib/crypto'
import { PcoClient, createPcoClient } from '@/lib/pco'
import { NextRequest, NextResponse } from 'next/server'

// Increase timeout for long syncs
export const maxDuration = 60

/** GET /api/pco?action=validate|status */
export async function GET(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const action = request.nextUrl.searchParams.get('action') || 'status'
  const admin = createAdminClient()

  const { data: settings } = await admin.from('church_settings').select('*').single()
  if (!settings) return NextResponse.json({ error: 'No church settings found' }, { status: 404 })

  if (action === 'validate') {
    if (!settings.pco_app_id || !settings.pco_app_secret) {
      return NextResponse.json({ valid: false, error: 'No credentials saved' })
    }
    const client = createPcoClient(settings.pco_app_id, settings.pco_app_secret)
    const result = await client.validate()
    return NextResponse.json(result)
  }

  if (action === 'status') {
    // Return last sync info + counts
    const { data: lastSync } = await admin
      .from('sync_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .single()

    const { count: peopleCount } = await admin.from('pco_people').select('*', { count: 'exact', head: true })
    const { count: groupCount } = await admin.from('pco_groups').select('*', { count: 'exact', head: true })
    const { count: teamCount } = await admin.from('pco_teams').select('*', { count: 'exact', head: true })

    return NextResponse.json({
      hasCredentials: !!(settings.pco_app_id && settings.pco_app_secret),
      lastSync: lastSync || null,
      pcoLastSync: settings.pco_last_sync,
      counts: { people: peopleCount || 0, groups: groupCount || 0, teams: teamCount || 0 },
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/** POST /api/pco — save credentials or trigger sync */
export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: appUser } = await supabase
    .from('app_users').select('role').eq('id', user.id).single()
  if (appUser?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Admin only' }, { status: 403 })
  }

  const body = await request.json()
  const admin = createAdminClient()
  const { data: settings } = await admin.from('church_settings').select('*').single()
  if (!settings) return NextResponse.json({ error: 'No church settings' }, { status: 404 })

  // --- Save credentials ---
  if (body.action === 'save_credentials') {
    const { appId, appSecret } = body
    if (!appId?.trim()) return NextResponse.json({ error: 'App ID is required' }, { status: 400 })

    // Validate before saving
    const testClient = new PcoClient({
      appId: appId.trim(),
      appSecret: appSecret?.trim() || tryDecrypt(settings.pco_app_secret),
    })
    const validation = await testClient.validate()
    if (!validation.valid) {
      return NextResponse.json({ error: `Invalid credentials: ${validation.error}` }, { status: 400 })
    }

    // Encrypt and save
    const updates: Record<string, any> = {
      pco_app_id: encrypt(appId.trim()),
      updated_at: new Date().toISOString(),
    }
    if (appSecret?.trim()) {
      updates.pco_app_secret = encrypt(appSecret.trim())
    }

    const { error } = await admin
      .from('church_settings')
      .update(updates)
      .eq('id', settings.id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    return NextResponse.json({ success: true, orgName: validation.orgName })
  }

  // --- Trigger sync ---
  if (body.action === 'sync') {
    if (!settings.pco_app_id || !settings.pco_app_secret) {
      return NextResponse.json({ error: 'No PCO credentials configured' }, { status: 400 })
    }

    const client = createPcoClient(settings.pco_app_id, settings.pco_app_secret)

    // Create sync log entry
    const { data: syncLog } = await admin
      .from('sync_logs')
      .insert({
        status: 'running',
        triggered_by: user.id,
        started_at: new Date().toISOString(),
        records_synced: 0,
        details: {},
      })
      .select()
      .single()

    try {
      const details: Record<string, number> = {}

      // --- Sync People ---
      const lastPeopleSync = await getLastSyncTime(admin, 'pco_people')
      const peopleParams: Record<string, string> = { per_page: '100', order: 'updated_at' }
      if (lastPeopleSync) {
        peopleParams['where[updated_at][gte]'] = lastPeopleSync
      }

      details.people = await client.paginate('/people/v2/people', peopleParams, async (data) => {
        const rows = data.map((p: any) => ({
          pco_id: p.id,
          first_name: p.attributes.first_name || null,
          last_name: p.attributes.last_name || null,
          full_name: p.attributes.name || `${p.attributes.first_name || ''} ${p.attributes.last_name || ''}`.trim(),
          membership_type: p.attributes.membership || null,
          status: p.attributes.status || null,
          gender: p.attributes.gender || null,
          birthdate: p.attributes.birthdate || null,
          anniversary: p.attributes.anniversary || null,
          avatar_url: p.attributes.avatar || null,
          pco_created_at: p.attributes.created_at,
          pco_updated_at: p.attributes.updated_at,
          last_synced_at: new Date().toISOString(),
        }))

        await admin.from('pco_people').upsert(rows, { onConflict: 'pco_id' })
      })

      // --- Sync Groups ---
      const lastGroupSync = await getLastSyncTime(admin, 'pco_groups')
      const groupParams: Record<string, string> = { per_page: '100' }

      details.groups = await client.paginate('/groups/v2/groups', groupParams, async (data) => {
        const rows = data.map((g: any) => ({
          pco_id: g.id,
          name: g.attributes.name || 'Unnamed Group',
          group_type: g.attributes.group_type || null,
          description: g.attributes.description || null,
          member_count: g.attributes.memberships_count || 0,
          pco_updated_at: g.attributes.updated_at || null,
          last_synced_at: new Date().toISOString(),
        }))

        await admin.from('pco_groups').upsert(rows, { onConflict: 'pco_id' })
      })

      // --- Sync Teams (Services) ---
      details.teams = 0
      try {
        const teamsResult = await client.get('/services/v2/teams', { per_page: '100' })
        if (teamsResult.data?.length) {
          const rows = teamsResult.data.map((t: any) => ({
            pco_id: t.id,
            name: t.attributes.name || 'Unnamed Team',
            description: t.attributes.sequence || null,
            pco_updated_at: t.attributes.updated_at || null,
            last_synced_at: new Date().toISOString(),
          }))
          await admin.from('pco_teams').upsert(rows, { onConflict: 'pco_id' })
          details.teams = rows.length
        }
      } catch (e: any) {
        // Teams API might not be accessible — not critical
        details.teams_error = e.message?.substring(0, 100)
      }

      const totalSynced = (details.people || 0) + (details.groups || 0) + (details.teams || 0)

      // Update sync log
      await admin.from('sync_logs').update({
        status: 'success',
        completed_at: new Date().toISOString(),
        records_synced: totalSynced,
        details,
      }).eq('id', syncLog!.id)

      // Update last sync timestamp
      await admin.from('church_settings').update({
        pco_last_sync: new Date().toISOString(),
      }).eq('id', settings.id)

      return NextResponse.json({ success: true, records: totalSynced, details })

    } catch (e: any) {
      // Log failure
      await admin.from('sync_logs').update({
        status: 'failed',
        completed_at: new Date().toISOString(),
        error_message: e.message?.substring(0, 500),
      }).eq('id', syncLog!.id)

      return NextResponse.json({ error: e.message }, { status: 500 })
    }
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

/** Get the most recent pco_updated_at from a table for incremental sync */
async function getLastSyncTime(admin: any, table: string): Promise<string | null> {
  const { data } = await admin
    .from(table)
    .select('pco_updated_at')
    .order('pco_updated_at', { ascending: false })
    .limit(1)
    .single()
  return data?.pco_updated_at || null
}

/** Try to decrypt, fall back to returning as-is */
function tryDecrypt(value: string | null): string {
  if (!value) return ''
  try { return decrypt(value) } catch { return value }
}
