'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { ArrowLeft, CheckCircle, Lock, Building2, Sun, Moon } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useTheme } from '@/contexts/ThemeContext'

function getPasswordScore(pw: string): number {
  let score = 0
  if (pw.length >= 8) score++
  if (pw.length >= 12) score++
  if (/[A-Z]/.test(pw) && /[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++
  return score
}

const SCORE_COLORS = ['#ef4444', '#f97316', '#eab308', '#10b981']

export default function ResetPasswordPage() {
  const { theme, toggleTheme } = useTheme()
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  const pwScore = getPasswordScore(password)
  const confirmMismatch = confirmPassword.length > 0 && password !== confirmPassword

  useEffect(() => {
    const init = async () => {
      if (!supabase) { setError('Supabase auth is not configured.'); return }
      const { data } = await supabase.auth.getSession()
      if (data?.session) { setReady(true); return }
      const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY' || !!session) setReady(true)
      })
      setTimeout(async () => {
        if (!supabase) return
        const { data: fresh } = await supabase.auth.getSession()
        if (!fresh?.session && !ready) setError('Invalid or expired reset link. Request a new one.')
      }, 1200)
      return () => subscription.unsubscribe()
    }
    init()
  }, [ready])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!ready) { setError('Reset session is not ready. Open the reset link from your email again.'); return }
    if (password.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (password !== confirmPassword) { setError('Passwords do not match.'); return }
    setLoading(true)
    try {
      if (!supabase) throw new Error('Supabase auth is not configured.')
      const { error: updateError } = await supabase.auth.updateUser({ password })
      if (updateError) throw updateError
      setDone(true)
    } catch (err: any) {
      setError(err?.message || 'Failed to update password.')
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
          <h1 className="mb-1" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em' }}>Set new password</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Choose a strong password for your account.</p>
        </div>

        <div className="card p-7">
          <Link href="/login" className="btn btn-ghost btn-sm mb-5 -ml-1">
            <ArrowLeft className="w-4 h-4" /> Back to sign in
          </Link>

          {done ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}>
                <CheckCircle className="w-6 h-6" style={{ color: 'var(--neon-emerald)' }} />
              </div>
              <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Password updated</h3>
              <p className="text-sm mb-5" style={{ color: 'var(--text-secondary)' }}>You can now sign in with your new password.</p>
              <Link href="/login?confirmed=true" className="btn btn-primary btn-sm inline-flex">Sign in</Link>
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
                {/* New password */}
                <div>
                  <label className="label">New password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <input type="password" required value={password} onChange={e => setPassword(e.target.value)}
                      placeholder="At least 8 characters" className="input" style={{ paddingLeft: 36 }} />
                  </div>
                  {password.length > 0 && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1">
                        {[0, 1, 2, 3].map(i => (
                          <div key={i} className="flex-1 h-1 rounded-full transition-colors"
                            style={{ backgroundColor: i < pwScore ? SCORE_COLORS[pwScore - 1] : 'var(--border-color)' }} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label className="label">Confirm password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <input type="password" required value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                      className={`input ${confirmMismatch ? 'input-error' : ''}`} style={{ paddingLeft: 36 }} />
                  </div>
                  {confirmMismatch && (
                    <p className="text-xs mt-1" style={{ color: '#dc2626' }}>Passwords don&apos;t match</p>
                  )}
                </div>

                <button type="submit" disabled={loading || !ready || confirmMismatch}
                  className="btn btn-primary btn-block" style={{ height: 38 }}>
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Updating...
                    </span>
                  ) : 'Update password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
