'use client'

import { useState, useEffect } from 'react'

interface AutoSyncSettings {
  enabled: boolean
  frequency: 'daily' | 'weekly' | 'monthly'
  fixedMonths: number
}

const FREQ_LABELS: Record<string, string> = {
  daily: 'Once a day (midnight)',
  weekly: 'Once a week (Sunday midnight)',
  monthly: 'Once a month (1st at midnight)',
}

export default function PcoAutoSyncSettings() {
  const [settings, setSettings] = useState<AutoSyncSettings>({ enabled: false, frequency: 'daily', fixedMonths: 6 })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    fetch('/api/pco?action=auto_sync_settings')
      .then(r => r.json())
      .then(data => {
        if (data.enabled !== undefined) {
          setSettings({ enabled: data.enabled, frequency: data.frequency || 'daily', fixedMonths: data.fixedMonths ?? 6 })
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const handleSave = async (newSettings: AutoSyncSettings) => {
    setSettings(newSettings)
    setSaving(true)
    setSaved(false)
    try {
      await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_auto_sync',
          enabled: newSettings.enabled,
          frequency: newSettings.frequency,
          fixedMonths: newSettings.fixedMonths,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch { /* ignore */ }
    setSaving(false)
  }

  if (loading) return null

  return (
    <div className="rounded-xl border p-5" style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="font-serif text-base" style={{ color: 'var(--foreground)' }}>Auto Sync</h3>
          <p className="text-xs sans mt-0.5" style={{ color: 'var(--foreground-muted)' }}>
            Automatically keep PCO data up to date.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {saved && (
            <span className="text-xs sans font-medium" style={{ color: 'var(--success)' }}>Saved</span>
          )}
          <button
            onClick={() => handleSave({ ...settings, enabled: !settings.enabled })}
            disabled={saving}
            className="relative w-11 h-6 rounded-full transition-colors duration-200"
            style={{ background: settings.enabled ? 'var(--primary)' : 'var(--neutral-300)' }}
            aria-label={settings.enabled ? 'Disable auto sync' : 'Enable auto sync'}>
            <span className="absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform duration-200"
              style={{ transform: settings.enabled ? 'translateX(20px)' : 'translateX(0)' }} />
          </button>
        </div>
      </div>

      {settings.enabled && (
        <div className="space-y-2">
          {(['daily', 'weekly', 'monthly'] as const).map(freq => (
            <label key={freq}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors"
              style={{
                background: settings.frequency === freq ? 'var(--primary-light)' : 'transparent',
                border: `1px solid ${settings.frequency === freq ? 'var(--green-200)' : 'transparent'}`,
              }}>
              <input
                type="radio"
                name="sync-frequency"
                checked={settings.frequency === freq}
                onChange={() => handleSave({ ...settings, frequency: freq })}
                className="sr-only"
              />
              <div className="w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0"
                style={{ borderColor: settings.frequency === freq ? 'var(--primary)' : 'var(--neutral-400)' }}>
                {settings.frequency === freq && (
                  <div className="w-2 h-2 rounded-full" style={{ background: 'var(--primary)' }} />
                )}
              </div>
              <span className="text-sm sans" style={{ color: settings.frequency === freq ? 'var(--green-800)' : 'var(--foreground-muted)' }}>
                {FREQ_LABELS[freq]}
              </span>
            </label>
          ))}
        </div>
      )}

      {/* Fixed-data threshold */}
      <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--border)' }}>
        <h4 className="text-sm sans font-medium mb-1" style={{ color: 'var(--foreground)' }}>
          Fixed Data Threshold
        </h4>
        <p className="text-xs sans mb-3" style={{ color: 'var(--foreground-muted)' }}>
          Data older than this is considered fixed and won&apos;t be re-synced.
          Only data newer than this threshold is fetched on each sync.
          Use &ldquo;Force Full Sync&rdquo; to re-sync everything.
        </p>
        <div className="flex items-center gap-2">
          <select
            value={settings.fixedMonths}
            onChange={(e) => handleSave({ ...settings, fixedMonths: parseInt(e.target.value, 10) })}
            disabled={saving}
            className="px-3 py-2 rounded-lg border text-sm sans"
            style={{ borderColor: 'var(--border)', color: 'var(--foreground)', background: 'var(--card)' }}
          >
            <option value={3}>3 months</option>
            <option value={6}>6 months</option>
            <option value={9}>9 months</option>
            <option value={12}>12 months</option>
            <option value={18}>18 months</option>
            <option value={24}>24 months</option>
          </select>
          <span className="text-xs sans" style={{ color: 'var(--foreground-muted)' }}>
            ago
          </span>
        </div>
      </div>
    </div>
  )
}
