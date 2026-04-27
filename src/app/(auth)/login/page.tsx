'use client'

import { useId, useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function LoginPage() {
  const [code, setCode] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [serverError, setServerError] = useState('')
  const [codeTouched, setCodeTouched] = useState(false)
  const [emailTouched, setEmailTouched] = useState(false)

  const codeRef = useRef<HTMLInputElement>(null)
  const router = useRouter()
  const codeErrorId = useId()
  const emailErrorId = useId()
  const serverErrorId = useId()

  useEffect(() => { codeRef.current?.focus() }, [])

  const codeIssue = code.trim().length === 0
    ? 'Invite code is required.'
    : code.trim().length < 4 ? 'Invite codes are at least 4 characters.' : null
  const emailIssue = email.trim().length === 0
    ? 'Email is required.'
    : !EMAIL_RE.test(email.trim()) ? "That doesn't look like a valid email." : null

  const showCodeError = codeTouched && codeIssue !== null
  const showEmailError = emailTouched && emailIssue !== null
  const canSubmit = !codeIssue && !emailIssue && !loading

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setCodeTouched(true)
    setEmailTouched(true)
    if (!canSubmit) return
    setLoading(true)
    setServerError('')

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim(), email: email.trim() }),
    })
    const data = await res.json()

    if (data.error) {
      setServerError(data.error)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  return (
    <div
      className="relative flex min-h-screen items-center justify-center overflow-hidden"
      style={{ background: 'linear-gradient(135deg, var(--color-green-900) 0%, var(--color-green-800) 40%, var(--color-green-700) 100%)' }}
    >
      <div
        className="absolute inset-0 opacity-[0.06]"
        style={{
          backgroundImage: `url("data:image/svg+xml,%3Csvg width='80' height='80' viewBox='0 0 80 80' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='%23ffffff' fill-opacity='1'%3E%3Cpath d='M40 10 C40 10 55 25 55 40 C55 55 40 55 40 55 C40 55 25 55 25 40 C25 25 40 10 40 10Z'/%3E%3Cpath d='M40 10 L40 55' stroke='%23ffffff' stroke-width='0.5' fill='none'/%3E%3Cpath d='M32 25 L40 32' stroke='%23ffffff' stroke-width='0.3' fill='none'/%3E%3Cpath d='M48 25 L40 32' stroke='%23ffffff' stroke-width='0.3' fill='none'/%3E%3Cpath d='M30 35 L40 40' stroke='%23ffffff' stroke-width='0.3' fill='none'/%3E%3Cpath d='M50 35 L40 40' stroke='%23ffffff' stroke-width='0.3' fill='none'/%3E%3C/g%3E%3C/svg%3E")`,
        }}
      />
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse at center, rgba(106,184,142,0.15) 0%, transparent 70%)' }}
      />

      <div className="relative w-full max-w-sm px-6">
        <div className="mb-10 text-center">
          <div
            className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-2xl"
            style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)' }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none" aria-hidden>
              <path d="M16 4C16 4 26 10 26 20C26 26 20 28 16 28C12 28 6 26 6 20C6 10 16 4 16 4Z" fill="rgba(106,184,142,0.4)" stroke="white" strokeWidth="1.5"/>
              <path d="M16 8V26" stroke="white" strokeWidth="1.5" strokeLinecap="round"/>
              <path d="M11 14L16 18" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
              <path d="M21 14L16 18" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
              <path d="M10 20L16 23" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
              <path d="M22 20L16 23" stroke="white" strokeWidth="1" strokeLinecap="round" opacity="0.7"/>
            </svg>
          </div>
          <h1 className="font-serif text-3xl text-white">Shepherdly</h1>
          <p className="mt-1.5 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Faith Church &middot; Pastoral Care
          </p>
        </div>

        <div
          className="rounded-2xl p-8"
          style={{
            background: 'rgba(255,255,255,0.1)',
            backdropFilter: 'blur(16px)',
            border: '1px solid rgba(255,255,255,0.15)',
            boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
          }}
        >
          <h2 className="mb-1 font-serif text-xl text-white">Sign in</h2>
          <p className="mb-6 text-sm" style={{ color: 'rgba(255,255,255,0.55)' }}>
            Enter your personal invite code and email address.
          </p>

          <form onSubmit={handleLogin} className="space-y-4" noValidate>
            <div>
              <label htmlFor="invite-code" className="sr-only">Invite code</label>
              <input
                id="invite-code"
                ref={codeRef}
                type="text"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                onBlur={() => setCodeTouched(true)}
                placeholder="Invite code"
                maxLength={12}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                aria-invalid={showCodeError || undefined}
                aria-describedby={showCodeError ? codeErrorId : undefined}
                className="w-full rounded-lg px-4 py-3 text-center font-mono text-xl tracking-widest outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: `1px solid ${showCodeError || serverError ? 'var(--color-red-300)' : 'rgba(255,255,255,0.2)'}`,
                  color: 'white',
                  letterSpacing: '0.2em',
                }}
              />
              {showCodeError && (
                <p id={codeErrorId} className="mt-1.5 text-xs" style={{ color: 'var(--color-red-100)' }}>
                  {codeIssue}
                </p>
              )}
            </div>

            <div>
              <label htmlFor="email" className="sr-only">Email address</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onBlur={() => setEmailTouched(true)}
                placeholder="Email address"
                autoComplete="email"
                aria-invalid={showEmailError || undefined}
                aria-describedby={showEmailError ? emailErrorId : undefined}
                className="w-full rounded-lg px-4 py-3 text-sm outline-none transition-all"
                style={{
                  background: 'rgba(255,255,255,0.1)',
                  border: `1px solid ${showEmailError || serverError ? 'var(--color-red-300)' : 'rgba(255,255,255,0.2)'}`,
                  color: 'white',
                }}
              />
              {showEmailError && (
                <p id={emailErrorId} className="mt-1.5 text-xs" style={{ color: 'var(--color-red-100)' }}>
                  {emailIssue}
                </p>
              )}
            </div>

            {serverError && (
              <p
                id={serverErrorId}
                role="alert"
                className="rounded-lg px-3 py-2 text-center text-sm"
                style={{ background: 'rgba(220,74,74,0.15)', color: 'var(--color-red-300)' }}
              >
                {serverError}
              </p>
            )}

            <button
              type="submit"
              disabled={!canSubmit}
              aria-describedby={serverError ? serverErrorId : undefined}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-semibold transition-all disabled:opacity-40"
              style={{
                background: 'rgba(255,255,255,0.95)',
                color: 'var(--color-green-800)',
              }}
            >
              {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
              <span>{loading ? 'Signing in…' : 'Sign In'}</span>
            </button>
          </form>
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: 'rgba(255,255,255,0.4)' }}>
          Don&apos;t have a code? Contact your church administrator.
        </p>
      </div>
    </div>
  )
}
