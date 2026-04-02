'use client'

import { useState, useEffect } from 'react'

export default function PcoSettingsForm({ hasExistingCreds }: { hasExistingCreds: boolean }) {
  const [appId, setAppId] = useState('')
  const [appSecret, setAppSecret] = useState('')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [connectionStatus, setConnectionStatus] = useState<'checking' | 'connected' | 'disconnected' | 'idle'>('idle')
  const [orgName, setOrgName] = useState<string | null>(null)

  // Check connection status on mount if credentials exist
  useEffect(() => {
    if (hasExistingCreds) {
      checkConnection()
    }
  }, [hasExistingCreds])

  const checkConnection = async () => {
    setConnectionStatus('checking')
    try {
      const res = await fetch('/api/pco?action=validate')
      const data = await res.json()
      if (data.valid) {
        setConnectionStatus('connected')
        setOrgName(data.orgName || null)
      } else {
        setConnectionStatus('disconnected')
      }
    } catch {
      setConnectionStatus('disconnected')
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!appId.trim()) { setResult({ type: 'error', message: 'Application ID is required.' }); return }

    setSaving(true)
    setResult(null)

    try {
      const res = await fetch('/api/pco', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'save_credentials',
          appId: appId.trim(),
          appSecret: appSecret.trim() || undefined,
        }),
      })
      const data = await res.json()

      if (data.success) {
        setResult({ type: 'success', message: data.orgName ? `Connected to ${data.orgName}` : 'Credentials verified and saved!' })
        setConnectionStatus('connected')
        setOrgName(data.orgName || null)
        setAppId('')
        setAppSecret('')
      } else {
        setResult({ type: 'error', message: data.error || 'Failed to save credentials.' })
      }
    } catch {
      setResult({ type: 'error', message: 'Network error. Please try again.' })
    }
    setSaving(false)
  }

  return (
    <div>
      {/* Connection status banner */}
      {connectionStatus === 'connected' && (
        <div className="rounded-xl border p-4 mb-5 flex items-center gap-3"
          style={{ background: '#f0fdf4', borderColor: 'var(--green-200)' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: 'var(--green-200)' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green-700)" strokeWidth="2.5" strokeLinecap="round">
              <path d="M20 6L9 17l-5-5"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium sans" style={{ color: 'var(--green-800)' }}>
              Connected to Planning Center{orgName ? ` \u2014 ${orgName}` : ''}
            </div>
            <div className="text-xs sans mt-0.5" style={{ color: 'var(--green-600)' }}>
              Credentials are verified and encrypted.
            </div>
          </div>
        </div>
      )}

      {connectionStatus === 'checking' && (
        <div className="rounded-xl border p-4 mb-5 flex items-center gap-3"
          style={{ background: 'var(--background-subtle)', borderColor: 'var(--border)' }}>
          <div className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin"
            style={{ borderColor: 'var(--border)', borderTopColor: 'var(--primary)' }} />
          <span className="text-sm sans" style={{ color: 'var(--foreground-muted)' }}>
            Checking PCO connection\u2026
          </span>
        </div>
      )}

      {connectionStatus === 'disconnected' && hasExistingCreds && (
        <div className="rounded-xl border p-4 mb-5 flex items-center gap-3"
          style={{ background: 'var(--danger-light)', borderColor: '#fecaca' }}>
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: '#fecaca' }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--danger)" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </div>
          <div>
            <div className="text-sm font-medium sans" style={{ color: '#991b1b' }}>
              Connection failed
            </div>
            <div className="text-xs sans mt-0.5" style={{ color: '#b91c1c' }}>
              Saved credentials could not connect to PCO. Please re-enter them below.
            </div>
          </div>
        </div>
      )}

      {/* Credential form */}
      <form onSubmit={handleSave} className="rounded-xl border p-6 space-y-5"
        style={{ background: 'var(--card)', borderColor: 'var(--border)', boxShadow: 'var(--card-shadow)' }}>

        <div className="text-sm font-medium sans" style={{ color: 'var(--foreground)' }}>
          {connectionStatus === 'connected' ? 'Update credentials' : 'Enter your PCO credentials'}
        </div>

        <div>
          <label className="block text-sm sans mb-1.5" style={{ color: 'var(--foreground-muted)' }}>
            Application ID
          </label>
          <input
            type="text"
            value={appId}
            onChange={e => { setAppId(e.target.value); setResult(null) }}
            placeholder={connectionStatus === 'connected' ? 'Enter new ID to update' : 'Paste your PCO App ID'}
            className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none transition-colors"
            style={{ borderColor: 'var(--border)', background: 'var(--background-subtle)', color: 'var(--foreground)' }}
          />
        </div>

        <div>
          <label className="block text-sm sans mb-1.5" style={{ color: 'var(--foreground-muted)' }}>
            Application Secret
          </label>
          <input
            type="password"
            value={appSecret}
            onChange={e => { setAppSecret(e.target.value); setResult(null) }}
            placeholder={connectionStatus === 'connected' ? 'Enter new secret to update' : 'Paste your PCO App Secret'}
            className="w-full px-4 py-2.5 rounded-lg border text-sm sans outline-none transition-colors"
            style={{ borderColor: 'var(--border)', background: 'var(--background-subtle)', color: 'var(--foreground)' }}
          />
        </div>

        {result && (
          <div className="rounded-lg px-4 py-3 text-sm sans flex items-center gap-2"
            style={{
              background: result.type === 'success' ? '#f0fdf4' : 'var(--danger-light)',
              color: result.type === 'success' ? 'var(--green-800)' : '#991b1b',
            }}>
            {result.type === 'success' ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M20 6L9 17l-5-5"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            )}
            {result.message}
          </div>
        )}

        <div className="pt-1">
          <button
            type="submit"
            disabled={saving || !appId.trim()}
            className="btn-primary text-sm sans disabled:opacity-40">
            {saving ? 'Validating & saving\u2026' : 'Save Credentials'}
          </button>
        </div>
      </form>
    </div>
  )
}
