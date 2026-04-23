'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Mail, ArrowLeft, CheckCircle, Building2, Sun, Moon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/contexts/ThemeContext'

export default function ForgotPasswordPage() {
  const { theme, toggleTheme } = useTheme()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    try {
      if (!supabase) throw new Error('Supabase auth is not configured.')
      const redirectTo = typeof window !== 'undefined'
        ? `${window.location.origin}/reset-password`
        : 'http://localhost:3000/reset-password'
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo })
      if (resetError) throw resetError
      setSent(true)
    } catch (err: any) {
      setError(err?.message || 'Failed to send reset email.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen dot-grid flex items-center justify-center p-4" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Theme toggle */}
      <button onClick={toggleTheme} className="btn btn-icon fixed top-4 right-4 z-50" aria-label="Toggle theme">
        {theme === 'dark'
          ? <Sun className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          : <Moon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
      </button>

      <div className="w-full max-w-sm">
        {/* Logo + heading */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent)', boxShadow: '0 1px 4px rgba(37,99,235,0.35)' }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.025em' }}>Fintra</span>
          </div>
          <h1 className="mb-1" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em' }}>Forgot password?</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Enter your email and we&apos;ll send a reset link.</p>
        </div>

        <div className="card p-7">
          <Link href="/login" className="btn btn-ghost btn-sm mb-5 -ml-1">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>

          {sent ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}>
                <CheckCircle className="w-6 h-6" style={{ color: 'var(--neon-emerald)' }} />
              </div>
              <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Check your email</h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                If <strong style={{ color: 'var(--text-primary)' }}>{email}</strong> has an account, a reset link is on its way.
              </p>
              <Link href="/login" className="btn btn-secondary btn-sm mt-5 inline-flex">Back to sign in</Link>
            </div>
          ) : (
            <>
              {error && (
                <div className="mb-5 p-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626' }}>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="label">Email address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
                      placeholder="you@example.com" className="input" style={{ paddingLeft: 36 }} />
                  </div>
                </div>

                <button type="submit" disabled={loading} className="btn btn-primary btn-block" style={{ height: 38 }}>
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Sending...
                    </span>
                  ) : 'Send reset link'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
