import { createAdminClient } from '@/lib/supabase/admin'
import { createPcoClient } from '@/lib/pco'
import { SYNC_RESOURCES, getResourceCount, fetchResourcePage } from '@/lib/pco-sync'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Vercel Cron endpoint for automated PCO sync.
 * Runs daily (or per configured frequency) to keep people/groups/teams in sync.
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel sets this header)
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const admin = createAdminClient()

  // Check if auto-sync is enabled
  const { data: settings } = await admin
    .from('app_settings')
    .select('key, value')
    .in('key', ['pco_sync_enabled'])

  const enabled = settings?.find(s => s.key === 'pco_sync_enabled')?.value === 'true'
  if (!enabled) {
    return NextResponse.json({ skipped: true, reason: 'Auto-sync disabled' })
  }

  // Get active credentials (first church — single-church app)
  const { data: credentials } = await admin
    .from('planning_center_credentials')
    .select('*')
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!credentials?.app_id || !credentials?.app_secret) {
    return NextResponse.json({ skipped: true, reason: 'No PCO credentials' })
  }

  const client = createPcoClient(credentials.app_id, credentials.app_secret)
  const churchId = credentials.church_id

  // Create sync log
  const { data: syncLog } = await admin
    .from('pco_sync_log')
    .insert({
      sync_type: 'auto',
      status: 'running',
      started_at: new Date().toISOString(),
      records_synced: 0,
      credential_id: credentials.id,
      church_id: churchId,
    })
    .select()
    .single()

  let totalSynced = 0

  try {
    for (const resource of SYNC_RESOURCES) {
      const pcoCount = await getResourceCount(client, resource)
      if (pcoCount === 0) continue

      // For replace strategy, delete existing first
      if (resource.syncStrategy === 'replace') {
        await admin.from(resource.table).delete().eq('church_id', churchId!)
      }

      // Paginate through all records
      let offset = 0
      let hasMore = true
      while (hasMore) {
        const { rows, hasMore: more } = await fetchResourcePage(client, resource, offset, 100)

        if (rows.length > 0) {
          const rowsWithChurch = rows.map(r => ({ ...r, church_id: churchId }))
          if (resource.syncStrategy === 'replace') {
            await admin.from(resource.table).insert(rowsWithChurch)
          } else {
            await admin.from(resource.table).upsert(rowsWithChurch, { onConflict: resource.onConflict })
          }
          totalSynced += rows.length
        }

        hasMore = more
        offset += 100
      }
    }

    // Post-sync hooks
    const thirtyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    await admin.rpc('update_attendance_counts', { since_date: thirtyDaysAgo })
    await admin.rpc('update_engagement_scores')

    // Mark success
    await admin.from('pco_sync_log').update({
      status: 'success',
      completed_at: new Date().toISOString(),
      records_synced: totalSynced,
    }).eq('id', syncLog!.id)

    await admin.from('planning_center_credentials').update({
      last_synced_at: new Date().toISOString(),
    }).eq('id', credentials.id)

    return NextResponse.json({ success: true, records: totalSynced })
  } catch (e: any) {
    await admin.from('pco_sync_log').update({
      status: 'failed',
      completed_at: new Date().toISOString(),
      records_synced: totalSynced,
      error_message: e.message,
    }).eq('id', syncLog!.id)

    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
