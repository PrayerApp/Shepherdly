'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    })
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #4a2c1a 0%, #4a7c59 100%)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '1rem',
    }}>
      <div style={{
        background: 'white',
        borderRadius: '16px',
        padding: '2.5rem',
        width: '100%',
        maxWidth: '420px',
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        textAlign: 'center',
      }}>
        {/* Logo / Icon */}
        <div style={{ fontSize: '3rem', marginBottom: '0.5rem' }}>🌿</div>
        <h1 style={{
          fontSize: '1.8rem',
          fontFamily: 'Georgia, serif',
          color: '#4a2c1a',
          marginBottom: '0.25rem',
        }}>
          Shepherdly
        </h1>
        <p style={{ color: '#9b8070', fontSize: '0.9rem', marginBottom: '2rem', fontFamily: 'sans-serif' }}>
          Faith Church Shepherding Dashboard
        </p>

        {sent ? (
          <div style={{
            background: '#f0faf4',
            border: '1.5px solid #7ab68a',
            borderRadius: '10px',
            padding: '1.5rem',
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📬</div>
            <p style={{ color: '#4a7c59', fontWeight: 600, fontFamily: 'sans-serif', margin: 0 }}>
              Check your email!
            </p>
            <p style={{ color: '#666', fontSize: '0.85rem', marginTop: '0.5rem', fontFamily: 'sans-serif' }}>
              We sent a magic link to <strong>{email}</strong>.<br />
              Click it to sign in — no password needed.
            </p>
            <button
              onClick={() => setSent(false)}
              style={{ marginTop: '1rem', color: '#9b8070', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.85rem', fontFamily: 'sans-serif' }}
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '1rem', textAlign: 'left' }}>
              <label style={{
                display: 'block',
                fontSize: '0.85rem',
                fontWeight: 600,
                color: '#4a2c1a',
                marginBottom: '0.4rem',
                fontFamily: 'sans-serif',
              }}>
                Your Email
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@faithchurch.com"
                required
                style={{
                  width: '100%',
                  padding: '0.75rem 1rem',
                  border: '1.5px solid #ddd0c0',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  fontFamily: 'sans-serif',
                  outline: 'none',
                  transition: 'border-color 0.15s',
                  boxSizing: 'border-box',
                }}
                onFocus={e => e.target.style.borderColor = '#4a7c59'}
                onBlur={e => e.target.style.borderColor = '#ddd0c0'}
              />
            </div>

            {error && (
              <p style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '1rem', fontFamily: 'sans-serif' }}>
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading || !email}
              className="btn-primary"
              style={{ width: '100%', padding: '0.75rem', fontSize: '1rem' }}
            >
              {loading ? 'Sending...' : 'Send Magic Link →'}
            </button>

            <p style={{ marginTop: '1.5rem', color: '#9b8070', fontSize: '0.8rem', fontFamily: 'sans-serif' }}>
              Access is by invitation only. If you don't receive an email, contact your church admin.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}
