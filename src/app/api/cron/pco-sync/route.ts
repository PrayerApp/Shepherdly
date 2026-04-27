import { createAdminClient } from '@/lib/supabase/admin'
import { createPcoClient } from '@/lib/pco'
import {
  SYNC_RESOURCES,
  getResourceCount, fetchResourcePage,
  getNestedResourceInfo, fetchNestedPage,
  resolvePcoIds, linkForeignKeys,
  syncConfiguredForms,
  markDepartedMemberships,
} from '@/lib/pco-sync'
import { NextRequest, NextResponse } from 'next/server'

/**
 * Vercel Cron endpoint for automated PCO sync.
 * Runs daily at 6am UTC (configured in vercel.json).
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

  // Get active credentials
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

  // Track every pco_id we successfully pulled this run for tables
  // where "not seen" means "membership ended." Used below to close
  // out departures (see markDepartedMemberships).
  const seenPcoIdsByTable: Record<string, Set<string>> = {
    group_memberships: new Set(),
    team_memberships: new Set(),
  }
  const syncStartedAt = new Date().toISOString()

  /*
   * Per-resource log helper. One row per (run × resource) so we can see
   * timing and silent FK skips at a glance instead of just a single
   * top-line total. Keep the helper local — every call site is in this
   * function and inlining the insert calls would double the noise.
   */
  const startResourceLog = async (table: string) => {
    const startedAt = new Date().toISOString()
    const startTs = Date.now()
    const { data } = await admin
      .from('pco_sync_resource_log')
      .insert({
        sync_log_id: syncLog!.id,
        resource_table: table,
        started_at: startedAt,
        status: 'running',
        church_id: churchId,
      })
      .select('id')
      .single()
    return { id: data?.id as string | undefined, startedAt, startTs }
  }

  const finishResourceLog = async (
    logId: string | undefined,
    startTs: number,
    stats: { rowsSeen: number; rowsUpserted: number; rowsSkipped: number },
    error?: string,
  ) => {
    if (!logId) return
    if (stats.rowsSkipped > 0) {
      console.warn(
        `Cron: ${stats.rowsSkipped} row(s) dropped during sync due to unresolvable foreign keys (resource log ${logId})`
      )
    }
    await admin
      .from('pco_sync_resource_log')
      .update({
        finished_at: new Date().toISOString(),
        duration_ms: Date.now() - startTs,
        rows_seen: stats.rowsSeen,
        rows_upserted: stats.rowsUpserted,
        rows_skipped_unresolvable_fk: stats.rowsSkipped,
        status: error ? 'failed' : 'success',
        error_message: error ?? null,
      })
      .eq('id', logId)
  }

  try {
    for (const resource of SYNC_RESOURCES) {
      const log = await startResourceLog(resource.table)
      const stats = { rowsSeen: 0, rowsUpserted: 0, rowsSkipped: 0 }
      try {
        if (resource.isNested) {
          // ── Nested resources: iterate parents ──────────────────
          const { cursor } = await getNestedResourceInfo(client, resource, admin, churchId!)
          if (cursor.parents.length === 0) {
            await finishResourceLog(log.id, log.startTs, stats)
            continue
          }

          if (resource.syncStrategy === 'replace') {
            await admin.from(resource.table).delete().eq('church_id', churchId!)
          }

          let currentCursor = cursor
          while (true) {
            const { rows, hasMore, nextCursor } = await fetchNestedPage(
              client, resource, currentCursor, 100
            )
            stats.rowsSeen += rows.length

            if (rows.length > 0) {
              let resolvedRows = rows
              if (resource.idMappings && resource.idMappings.length > 0) {
                const result = await resolvePcoIds(admin, rows, resource.idMappings, churchId!)
                resolvedRows = result.resolved
                stats.rowsSkipped += result.skipped
              }

              const rowsWithChurch = resolvedRows.map(r => ({ ...r, church_id: churchId }))
              if (rowsWithChurch.length > 0) {
                if (resource.syncStrategy === 'replace') {
                  await admin.from(resource.table).insert(rowsWithChurch)
                } else {
                  await admin.from(resource.table).upsert(rowsWithChurch, { onConflict: resource.onConflict })
                }
                stats.rowsUpserted += rowsWithChurch.length
                totalSynced += rowsWithChurch.length
                const seen = seenPcoIdsByTable[resource.table]
                if (seen) {
                  for (const r of rowsWithChurch as Array<{ pco_id?: string }>) {
                    if (r.pco_id) seen.add(r.pco_id)
                  }
                }
              }
            }

            if (!hasMore || !nextCursor) break
            currentCursor = nextCursor
          }
        } else {
          // ── Flat resources ─────────────────────────────────────
          const pcoCount = await getResourceCount(client, resource)
          if (pcoCount === 0) {
            await finishResourceLog(log.id, log.startTs, stats)
            continue
          }

          if (resource.syncStrategy === 'replace') {
            await admin.from(resource.table).delete().eq('church_id', churchId!)
          }

          let offset = 0
          let hasMore = true
          while (hasMore) {
            const { rows, hasMore: more } = await fetchResourcePage(client, resource, offset, 100)
            stats.rowsSeen += rows.length

            if (rows.length > 0) {
              let resolvedRows = rows
              if (resource.idMappings && resource.idMappings.length > 0) {
                const result = await resolvePcoIds(admin, rows, resource.idMappings, churchId!)
                resolvedRows = result.resolved
                stats.rowsSkipped += result.skipped
              }

              const rowsWithChurch = resolvedRows.map(r => ({ ...r, church_id: churchId }))
              if (rowsWithChurch.length > 0) {
                if (resource.syncStrategy === 'replace') {
                  await admin.from(resource.table).insert(rowsWithChurch)
                } else {
                  await admin.from(resource.table).upsert(rowsWithChurch, { onConflict: resource.onConflict })
                }
                stats.rowsUpserted += rowsWithChurch.length
                totalSynced += rowsWithChurch.length
              }
            }

            hasMore = more
            offset += 100
          }
        }
        await finishResourceLog(log.id, log.startTs, stats)
      } catch (err: any) {
        await finishResourceLog(log.id, log.startTs, stats, err?.message?.substring(0, 500) ?? String(err).substring(0, 500))
        throw err
      }
    }

    // Post-sync: close out any group/team memberships that disappeared
    // from PCO this run. PCO doesn't expose a left_at attribute, so
    // "not returned in this sync" is the signal. Skip if we saw zero
    // memberships total — that's a sync failure, not an empty church.
    try {
      for (const table of ['group_memberships', 'team_memberships'] as const) {
        const seen = seenPcoIdsByTable[table]
        if (seen.size === 0) continue
        await markDepartedMemberships(admin, table, churchId!, seen, syncStartedAt)
      }
    } catch (e) {
      console.error('Cron: orphan membership cleanup failed:', e)
    }

    // Post-sync: link FK columns
    try {
      await linkForeignKeys(admin, churchId!)
    } catch (e) {
      console.error('Cron: FK linking failed:', e)
    }

    // Post-sync: refresh analytics
    try {
      await admin.rpc('refresh_person_analytics')
    } catch (e) {
      console.error('Cron: analytics refresh failed:', e)
    }

    // Post-sync: regenerate auto-connect tree edges
    try {
      const { regenerateAutoConnectEdgesForChurch } = await import('@/lib/tree-auto-connect')
      await regenerateAutoConnectEdgesForChurch(admin, churchId!)
    } catch (e) {
      console.error('Cron: auto-connect refresh failed:', e)
    }

    // Post-sync: regenerate shepherd-over rule edges
    try {
      const { regenerateShepherdOverEdges } = await import('@/lib/shepherd-over-rules')
      await regenerateShepherdOverEdges(admin, churchId!)
    } catch (e) {
      console.error('Cron: shepherd-over rules refresh failed:', e)
    }

    // Post-sync: pull configured PCO form submissions. Separate from
    // SYNC_RESOURCES because forms are config-driven (pco_form_sync_config)
    // and their answer extraction is form-specific.
    try {
      const formCount = await syncConfiguredForms(admin, client, churchId!, credentials.last_synced_at)
      totalSynced += formCount
    } catch (e) {
      console.error('Cron: form submissions sync failed:', e)
    }

    // Post-sync: refresh materialized analytics views. Cheap because the
    // view definitions are aggregations over already-loaded tables; doing
    // it here means the dashboard reads from prebuilt rows.
    try {
      await admin.rpc('refresh_analytics_views')
    } catch (e) {
      console.error('Cron: analytics view refresh failed:', e)
    }

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
