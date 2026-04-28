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

  /*
   * Resource-level resumability. If the previous cron run's pco_sync_log
   * row is in 'running' or 'failed' state (i.e. crashed mid-sync), we
   * adopt that run instead of starting fresh and skip resources whose
   * pco_sync_resource_log row says 'success'.
   *
   * Mid-resource cursors aren't persisted — that's harder and the marginal
   * value is small for a daily cron. Resource-level skip alone means a
   * crash at "resource 8 of 16" means the next run does resources 9-16
   * instead of starting over.
   *
   * Stale 'running' rows older than 6 hours are treated as crashed.
   */
  const STALE_RUN_HOURS = 6
  const { data: prevRun } = await admin
    .from('pco_sync_log')
    .select('id, status, started_at')
    .eq('church_id', churchId)
    .in('status', ['running', 'failed'])
    .order('started_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const prevAge = prevRun?.started_at
    ? (Date.now() - new Date(prevRun.started_at).getTime()) / 3600000
    : Infinity
  const adoptPreviousRun = !!prevRun && prevAge < STALE_RUN_HOURS

  let syncLog: { id: string } | null = null
  const completedTables = new Set<string>()
  if (adoptPreviousRun && prevRun) {
    syncLog = { id: prevRun.id }
    const { data: priorResources } = await admin
      .from('pco_sync_resource_log')
      .select('resource_table, status')
      .eq('sync_log_id', prevRun.id)
      .eq('status', 'success')
    for (const r of (priorResources ?? []) as { resource_table: string }[]) {
      completedTables.add(r.resource_table)
    }
    console.log(
      `Cron: resuming previous sync run ${prevRun.id} (${completedTables.size} resource(s) already complete)`
    )
  } else {
    const { data: newLog } = await admin
      .from('pco_sync_log')
      .insert({
        sync_type: 'auto',
        status: 'running',
        started_at: new Date().toISOString(),
        records_synced: 0,
        credential_id: credentials.id,
        church_id: churchId,
      })
      .select('id')
      .single()
    syncLog = newLog
  }

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
      if (completedTables.has(resource.table)) {
        // Already finished in the run we're resuming.
        continue
      }
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
    //
    // On a resumed run we skip this entirely: the seen-set is local to
    // this cron invocation, so for membership tables that completed in
    // the prior run the seen-set is empty and we'd incorrectly mark
    // valid rows as departed. The next full run picks up real departures.
    if (!adoptPreviousRun) {
      try {
        for (const table of ['group_memberships', 'team_memberships'] as const) {
          const seen = seenPcoIdsByTable[table]
          if (seen.size === 0) continue
          await markDepartedMemberships(admin, table, churchId!, seen, syncStartedAt)
        }
      } catch (e) {
        console.error('Cron: orphan membership cleanup failed:', e)
      }
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

    /*
     * Post-sync: recompute last_activity_at for every membership and
     * mark stale ones inactive. PCO doesn't expose left_at on group
     * or team memberships, so a person who hasn't attended a group
     * meeting or accepted a serving slot in 6+ months stays "active"
     * in our mirror unless we close them out by recency. Resumed
     * runs skip this for the same reason markDepartedMemberships is
     * skipped — local seen-sets aren't authoritative across runs.
     */
    if (!adoptPreviousRun) {
      try {
        await admin.rpc('refresh_membership_activity')
        const { data: deactivated } = await admin.rpc('mark_inactive_by_activity', {
          p_inactive_days: 180,
          p_grace_days: 90,
        })
        for (const row of (deactivated ?? []) as { table_name: string; deactivated: number }[]) {
          if (row.deactivated > 0) {
            console.log(`Cron: marked ${row.deactivated} ${row.table_name} inactive (no activity in 180d)`)
          }
        }
      } catch (e) {
        console.error('Cron: activity-based inactive sweep failed:', e)
      }
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

    // Post-sync: pull configured PCO form submissions. Forms are
    // config-driven (pco_form_sync_config) and their answer extraction
    // is form-specific, so they don't fit the declarative SYNC_RESOURCES
    // shape — but we still log each form individually in
    // pco_sync_resource_log under "pco_form_submissions:<form_pco_id>"
    // so they show up alongside everything else and benefit from the
    // same resumability skip on the next run.
    try {
      const formStats = await syncConfiguredForms(
        admin,
        client,
        churchId!,
        credentials.last_synced_at,
        { skipForms: completedTables },
      )
      for (const fs of formStats) {
        const startedAt = new Date().toISOString()
        const { data: logRow } = await admin
          .from('pco_sync_resource_log')
          .insert({
            sync_log_id: syncLog!.id,
            resource_table: `pco_form_submissions:${fs.formPcoId}`,
            started_at: startedAt,
            status: 'running',
            church_id: churchId,
          })
          .select('id')
          .single()
        if (fs.rowsSkipped > 0) {
          console.warn(
            `Cron: ${fs.rowsSkipped} ${fs.formLabel} submission(s) dropped (PCO person not yet synced)`
          )
        }
        await admin
          .from('pco_sync_resource_log')
          .update({
            finished_at: new Date().toISOString(),
            duration_ms: 0,
            rows_seen: fs.rowsSeen,
            rows_upserted: fs.rowsUpserted,
            rows_skipped_unresolvable_fk: fs.rowsSkipped,
            status: fs.error ? 'failed' : 'success',
            error_message: fs.error ?? null,
          })
          .eq('id', logRow?.id ?? '')
        totalSynced += fs.rowsUpserted
      }
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
