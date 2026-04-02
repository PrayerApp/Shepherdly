'use client'

import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function LoginPage() {
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  useEffect(() => { inputRef.current?.focus() }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    if (code.trim().length < 4) return
    setLoading(true)
    setError('')

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() }),
    })

    const data = await res.json()

    if (data.error) {
      setError(data.error)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--background)' }}>
      {/* Subtle cross-hatch background */}
      <div className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%236b4c2a' fill-opacity='1'%3E%3Cpath d='M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E")`
        }} />

      <div className="relative w-full max-w-sm px-6">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full mb-4"
            style={{ background: 'var(--primary)' }}>
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path d="M20 4C20 4 24 6 24 10C24 14 20 14 20 18V28" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
              <path d="M12 28L20 28" stroke="white" strokeWidth="2.5" strokeLinecap="round"/>
              <circle cx="12" cy="12" r="4" stroke="white" strokeWidth="2"/>
              <path d="M12 16V28" stroke="white" strokeWidth="2" strokeLinecap="round"/>
            </svg>
          </div>
          <h1 className="text-3xl font-serif" style={{ color: 'var(--primary)' }}>Shepherdly</h1>
          <p className="mt-1 text-sm sans" style={{ color: 'var(--muted-foreground)' }}>Faith Church · Pastoral Care</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-lg border p-8" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-xl font-serif mb-1" style={{ color: 'var(--foreground)' }}>Enter your access code</h2>
          <p className="text-sm sans mb-6" style={{ color: 'var(--muted-foreground)' }}>
            Your code was given to you by a church administrator.
          </p>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              ref={inputRef}
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g. ABC12345"
              maxLength={12}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="w-full px-4 py-3 rounded-lg border text-center text-xl font-mono tracking-widest outline-none transition-all"
              style={{
                borderColor: error ? 'var(--danger)' : 'var(--border)',
                background: 'var(--muted)',
                color: 'var(--foreground)',
                letterSpacing: '0.2em',
              }}
            />

            {error && (
              <p className="text-sm sans rounded-lg px-3 py-2 text-center"
                style={{ background: '#fef2f2', color: 'var(--danger)' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || code.trim().length < 4}
              className="w-full py-3 px-4 rounded-lg text-sm font-medium sans transition-opacity disabled:opacity-40"
              style={{ background: 'var(--primary)', color: 'white' }}>
              {loading ? 'Signing in…' : 'Sign In'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs mt-6 sans" style={{ color: 'var(--muted-foreground)' }}>
          Don't have a code? Contact your church administrator.
        </p>
      </div>
    </div>
  )
}
