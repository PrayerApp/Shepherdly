import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { encrypt, decrypt } from '@/lib/crypto'
import { PcoClient, createPcoClient } from '@/lib/pco'
import {
  SYNC_RESOURCES, SYNC_CATEGORIES, PCO_TABLES,
  getResourceCount, fetchResourcePage,
} from '@/lib/pco-sync'
import { NextRequest, NextResponse } from 'next/server'

/** Helper: require super_admin, return admin client + credentials + church */
async function requireAdmin() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('Unauthorized')

  const { data: appUser } = await supabase
    .from('users').select('id, role, church_id').eq('user_id', user.id).single()
  if (appUser?.role !== 'super_admin') throw new Error('Admin only')

  const admin = createAdminClient()

  // Get PCO credentials for this church
  const { data: credentials } = await admin
    .from('planning_center_credentials')
    .select('*')
    .eq('church_id', appUser.church_id!)
    .eq('is_active', true)
    .limit(1)
    .single()

  return { user, admin, appUser, credentials, churchId: appUser.church_id }
}

// ═══════════════════════════════════════════════════════════════
// GET /api/pco?action=validate|status|auto_sync_settings
// ═══════════════════════════════════════════════════════════════
export async function GET(request: NextRequest) {
  try {
    const { admin, credentials, churchId } = await requireAdmin()
    const action = request.nextUrl.searchParams.get('action') || 'status'

    if (action === 'validate') {
      if (!credentials?.app_id || !credentials?.app_secret) {
        return NextResponse.json({ valid: false, error: 'No credentials saved' })
      }
      const client = createPcoClient(credentials.app_id, credentials.app_secret)
      return NextResponse.json(await client.validate())
    }

    if (action === 'status') {
      const { data: lastSync } = await admin
        .from('pco_sync_log').select('*')
        .eq('church_id', churchId!)
        .order('started_at', { ascending: false }).limit(1).single()

      const counts: Record<string, number> = {}
      for (const res of SYNC_RESOURCES) {
        try {
          const { count } = await admin
            .from(res.table)
            .select('*', { count: 'exact', head: true })
            .eq('church_id', churchId!)
          counts[res.key] = count || 0
        } catch {
          counts[res.key] = 0
        }
      }

      return NextResponse.json({
        hasCredentials: !!(credentials?.app_id && credentials?.app_secret),
        lastSync: lastSync || null,
        counts,
        categories: SYNC_CATEGORIES,
        resources: SYNC_RESOURCES.map(r => ({ key: r.key, label: r.label, category: r.category })),
      })
    }

    if (action === 'auto_sync_settings') {
      const { data: settings } = await admin
        .from('app_settings')
        .select('key, value')
        .in('key', ['pco_sync_enabled', 'pco_sync_frequency'])

      const settingsMap = Object.fromEntries((settings || []).map(s => [s.key, s.value]))
      return NextResponse.json({
        enabled: settingsMap.pco_sync_enabled === 'true',
        frequency: settingsMap.pco_sync_frequency || 'daily',
      })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    const status = e.message === 'Unauthorized' ? 401 : e.message === 'Admin only' ? 403 : 500
    return NextResponse.json({ error: e.message }, { status })
  }
}

// ═══════════════════════════════════════════════════════════════
// POST /api/pco — save creds, auto-sync, start/page/finish sync, purge
// ═══════════════════════════════════════════════════════════════
export async function POST(request: NextRequest) {
  try {
    const { user, admin, appUser, credentials, churchId } = await requireAdmin()
    const body = await request.json()

    // ── Save credentials ───────────────────────────────────────
    if (body.action === 'save_credentials') {
      const { appId, appSecret } = body
      if (!appId?.trim()) return NextResponse.json({ error: 'App ID is required' }, { status: 400 })

      const testClient = new PcoClient({
        appId: appId.trim(),
        appSecret: appSecret?.trim() || tryDecrypt(credentials?.app_secret),
      })
      const validation = await testClient.validate()
      if (!validation.valid) {
        return NextResponse.json({ error: `Invalid credentials: ${validation.error}` }, { status: 400 })
      }

      const encAppId = encrypt(appId.trim())
      const encAppSecret = appSecret?.trim() ? encrypt(appSecret.trim()) : undefined

      if (credentials) {
        // Update existing
        const updates: Record<string, any> = { app_id: encAppId }
        if (encAppSecret) updates.app_secret = encAppSecret
        const { error } = await admin.from('planning_center_credentials').update(updates).eq('id', credentials.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      } else {
        // Create new
        const { error } = await admin.from('planning_center_credentials').insert({
          user_id: user.id,
          app_id: encAppId,
          app_secret: encAppSecret || '',
          church_id: churchId,
          is_active: true,
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
      return NextResponse.json({ success: true, orgName: validation.orgName })
    }

    // ── Save auto-sync settings ────────────────────────────────
    if (body.action === 'save_auto_sync') {
      await admin.from('app_settings').upsert(
        { key: 'pco_sync_enabled', value: String(!!body.enabled) },
        { onConflict: 'key' }
      )
      await admin.from('app_settings').upsert(
        { key: 'pco_sync_frequency', value: body.frequency || 'daily' },
        { onConflict: 'key' }
      )
      return NextResponse.json({ success: true })
    }

    // ── Start sync ─────────────────────────────────────────────
    if (body.action === 'sync_start') {
      if (!credentials?.app_id || !credentials?.app_secret) {
        return NextResponse.json({ error: 'No PCO credentials configured' }, { status: 400 })
      }

      const client = createPcoClient(credentials.app_id, credentials.app_secret)

      const resourceInfo: Record<string, {
        pcoCount: number
        dbCount: number
        toSync: number
        updatedSince: string | null
        isNested?: boolean
      }> = {}

      for (const res of SYNC_RESOURCES) {
        let dbCount = 0
        try {
          const { count } = await admin
            .from(res.table)
            .select('*', { count: 'exact', head: true })
            .eq('church_id', churchId!)
          dbCount = count || 0
        } catch { /* table might not exist */ }

        {
          const pcoCount = await getResourceCount(client, res)

          let toSync: number
          let updatedSince: string | null = null

          if (res.supportsUpdatedSince) {
            updatedSince = await getLastUpdated(admin, res.table, churchId!)
            toSync = updatedSince
              ? await getResourceCount(client, res, updatedSince)
              : pcoCount
          } else {
            toSync = pcoCount === dbCount ? 0 : pcoCount
          }

          resourceInfo[res.key] = {
            pcoCount, dbCount, toSync, updatedSince, isNested: false,
          }
        }
      }

      const { data: syncLog } = await admin
        .from('pco_sync_log')
        .insert({
          sync_type: 'manual',
          status: 'running',
          started_at: new Date().toISOString(),
          records_synced: 0,
          credential_id: credentials.id,
          church_id: churchId,
        })
        .select().single()

      return NextResponse.json({ syncLogId: syncLog!.id, resourceInfo })
    }

    // ── Sync one page ──────────────────────────────────────────
    if (body.action === 'sync_page') {
      const { resourceKey, offset = 0, syncLogId, updatedSince } = body
      const resource = SYNC_RESOURCES.find(r => r.key === resourceKey)
      if (!resource) return NextResponse.json({ error: 'Invalid resource' }, { status: 400 })
      if (!credentials?.app_id || !credentials?.app_secret) {
        return NextResponse.json({ error: 'No credentials' }, { status: 400 })
      }

      const client = createPcoClient(credentials.app_id, credentials.app_secret)

      // ── Replace strategy (memberships) ───────────────────────
      if (resource.syncStrategy === 'replace' && offset === 0) {
        await admin.from(resource.table).delete().eq('church_id', churchId!)
      }

      // ── Flat resources (offset-based) ────────────────────────
      const { rows, hasMore, totalCount } = await fetchResourcePage(
        client, resource, offset, 100, updatedSince,
      )

      let upserted = 0
      if (rows.length > 0) {
        // Resolve PCO IDs to UUIDs for membership tables
        let resolvedRows = rows
        if (resource.key === 'group_memberships') {
          resolvedRows = await resolveGroupMembershipIds(admin, rows, churchId!)
        }

        // Add church_id to all rows
        const rowsWithChurch = resolvedRows.map(r => ({ ...r, church_id: churchId }))

        if (resource.syncStrategy === 'replace') {
          const { error: insertErr } = await admin.from(resource.table).insert(rowsWithChurch)
          if (insertErr) {
            return NextResponse.json({
              error: `${resource.label} insert failed: ${insertErr.message}`,
            }, { status: 500 })
          }
        } else {
          const { error: upsertErr } = await admin
            .from(resource.table)
            .upsert(rowsWithChurch, { onConflict: resource.onConflict })
          if (upsertErr) {
            return NextResponse.json({
              error: `${resource.label} upsert failed: ${upsertErr.message}`,
            }, { status: 500 })
          }
        }
        upserted = rows.length
      }

      if (syncLogId && upserted > 0) {
        await incrementSyncLog(admin, syncLogId, upserted)
      }

      return NextResponse.json({
        upserted, hasMore, nextOffset: hasMore ? offset + 100 : null, totalCount,
      })
    }

    // ── Finish sync ────────────────────────────────────────────
    if (body.action === 'sync_finish') {
      const { syncLogId, totalRecords, status: syncStatus, error: syncError } = body
      if (syncLogId) {
        await admin.from('pco_sync_log').update({
          status: syncStatus || 'success',
          completed_at: new Date().toISOString(),
          records_synced: totalRecords || 0,
          error_message: syncError || null,
        }).eq('id', syncLogId)
      }
      if (syncStatus !== 'failed' && credentials) {
        await admin.from('planning_center_credentials').update({
          last_synced_at: new Date().toISOString(),
        }).eq('id', credentials.id)

        // Post-sync: recalculate attendance counts and engagement scores
        try {
          const thirtyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
            .toISOString().split('T')[0]
          await admin.rpc('update_attendance_counts', { since_date: thirtyDaysAgo })
          await admin.rpc('update_engagement_scores')
        } catch (e) {
          // Non-fatal — scores will be stale until next sync
          console.error('Post-sync score update failed:', e)
        }
      }
      return NextResponse.json({ success: true })
    }

    // ── Purge all PCO data ─────────────────────────────────────
    if (body.action === 'purge') {
      for (const table of PCO_TABLES) {
        try {
          await admin.from(table).delete().eq('church_id', churchId!)
        } catch { /* table might not exist */ }
      }
      if (credentials) {
        await admin.from('planning_center_credentials').update({
          last_synced_at: null,
        }).eq('id', credentials.id)
      }
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (e: any) {
    const status = e.message === 'Unauthorized' ? 401 : e.message === 'Admin only' ? 403 : 500
    return NextResponse.json({ error: e.message }, { status })
  }
}

async function getLastUpdated(admin: any, table: string, churchId: string): Promise<string | null> {
  const { data } = await admin
    .from(table).select('updated_at')
    .eq('church_id', churchId)
    .order('updated_at', { ascending: false }).limit(1).single()
  return data?.updated_at || null
}

async function incrementSyncLog(admin: any, syncLogId: string, count: number) {
  const { data: log } = await admin.from('pco_sync_log')
    .select('records_synced').eq('id', syncLogId).single()
  if (log) {
    await admin.from('pco_sync_log')
      .update({ records_synced: (log.records_synced || 0) + count })
      .eq('id', syncLogId)
  }
}

function tryDecrypt(value: string | null | undefined): string {
  if (!value) return ''
  try { return decrypt(value) } catch { return value }
}

/** Resolve PCO IDs to DB UUIDs for group membership rows */
async function resolveGroupMembershipIds(
  admin: any,
  rows: Record<string, any>[],
  churchId: string,
): Promise<Record<string, any>[]> {
  // Collect unique PCO IDs
  const personPcoIds = [...new Set(rows.map(r => r._person_pco_id).filter(Boolean))]
  const groupPcoIds = [...new Set(rows.map(r => r._group_pco_id).filter(Boolean))]

  // Batch lookup people
  const { data: people } = await admin
    .from('people')
    .select('id, pco_id')
    .eq('church_id', churchId)
    .in('pco_id', personPcoIds)

  const personMap = new Map((people || []).map((p: any) => [p.pco_id, p.id]))

  // Batch lookup groups
  const { data: groups } = await admin
    .from('groups')
    .select('id, pco_id')
    .eq('church_id', churchId)
    .in('pco_id', groupPcoIds)

  const groupMap = new Map((groups || []).map((g: any) => [g.pco_id, g.id]))

  // Map rows, skipping any where we can't resolve IDs
  return rows
    .map(r => {
      const personId = personMap.get(r._person_pco_id)
      const groupId = groupMap.get(r._group_pco_id)
      if (!personId || !groupId) return null

      const { _person_pco_id, _group_pco_id, ...rest } = r
      return { ...rest, person_id: personId, group_id: groupId }
    })
    .filter(Boolean) as Record<string, any>[]
}
