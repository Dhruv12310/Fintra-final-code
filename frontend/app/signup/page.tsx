'use client'

import { useState, useEffect } from 'react'
import { Building2, Mail, Lock, User, Eye, EyeOff, CheckCircle, Sun, Moon, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
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
const SCORE_LABELS = ['Too short', 'Weak', 'Fair', 'Strong']

export default function Signup() {
  const { signUp } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [formData, setFormData] = useState({ fullName: '', email: '', password: '', confirmPassword: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  const pwScore = getPasswordScore(formData.password)
  const confirmMismatch = formData.confirmPassword.length > 0 && formData.password !== formData.confirmPassword

  useEffect(() => { setMounted(true) }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (formData.password !== formData.confirmPassword) { setError('Passwords do not match'); return }
    if (formData.password.length < 8) { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    try {
      await signUp(formData.email, formData.password, formData.fullName)
      setSuccess(true)
    } catch (error: any) {
      setError(error.message || 'Signup failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!mounted) return <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }} />

  return (
    <div
      data-glow-zone="true"
      className="min-h-screen dot-grid flex items-center justify-center p-4 py-10 relative"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* Theme toggle */}
      <button onClick={toggleTheme} className="btn btn-icon fixed top-4 right-4 z-50" aria-label="Toggle theme">
        {theme === 'dark'
          ? <Sun className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
          : <Moon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
      </button>

      {/* Back button */}
      <Link href="/" className="btn btn-ghost btn-sm fixed top-4 left-4 z-50">
        <ArrowLeft className="w-4 h-4" /> Back
      </Link>

      <div className="w-full max-w-sm relative z-10">
        {/* Logo + heading */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent)', boxShadow: '0 1px 4px rgba(37,99,235,0.35)' }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.025em' }}>Fintra</span>
          </div>
          <h1 className="mb-1" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em' }}>Create your account</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Start managing your finances with AI</p>
        </div>

        {/* Card */}
        <div className="card p-7">
          {/* Success state */}
          {success ? (
            <div className="text-center py-4">
              <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                style={{ backgroundColor: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}>
                <CheckCircle className="w-6 h-6" style={{ color: 'var(--neon-emerald)' }} />
              </div>
              <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Check your email</h3>
              <p className="text-sm" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
                We sent a confirmation link to{' '}
                <strong style={{ color: 'var(--text-primary)' }}>{formData.email}</strong>.
                Click it to activate your account.
              </p>
              <Link href="/login" className="btn btn-primary btn-sm mt-5 inline-flex">Go to sign in</Link>
            </div>
          ) : (
            <>
              {/* Error banner */}
              {error && (
                <div className="mb-5 p-3 rounded-lg text-sm"
                  style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626' }}>
                  {error}
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Full name */}
                <div>
                  <label className="label">Full name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <input type="text" value={formData.fullName}
                      onChange={e => setFormData({ ...formData, fullName: e.target.value })}
                      placeholder="Jane Smith" className="input" style={{ paddingLeft: 36 }} required />
                  </div>
                </div>

                {/* Email */}
                <div>
                  <label className="label">Work email</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <input type="email" value={formData.email}
                      onChange={e => setFormData({ ...formData, email: e.target.value })}
                      placeholder="you@example.com" className="input" style={{ paddingLeft: 36 }} required />
                  </div>
                </div>

                {/* Password */}
                <div>
                  <label className="label">Password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <input type={showPassword ? 'text' : 'password'} value={formData.password}
                      onChange={e => setFormData({ ...formData, password: e.target.value })}
                      placeholder="••••••••" className="input" style={{ paddingLeft: 36, paddingRight: 40 }} required minLength={8} />
                    <button type="button" onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5"
                      style={{ color: 'var(--text-muted)' }} tabIndex={-1}>
                      {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>

                  {/* Strength bar */}
                  {formData.password.length > 0 && (
                    <div className="mt-2">
                      <div className="flex gap-1 mb-1">
                        {[0, 1, 2, 3].map(i => (
                          <div key={i} className="flex-1 h-1 rounded-full transition-colors"
                            style={{ backgroundColor: i < pwScore ? SCORE_COLORS[pwScore - 1] : 'var(--border-color)' }} />
                        ))}
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex gap-2">
                          {[
                            { label: '8+ chars', pass: formData.password.length >= 8 },
                            { label: 'A-Z + 0-9', pass: /[A-Z]/.test(formData.password) && /[0-9]/.test(formData.password) },
                            { label: 'Symbol', pass: /[^A-Za-z0-9]/.test(formData.password) },
                          ].map(c => (
                            <span key={c.label} className="flex items-center gap-1" style={{ fontSize: 10, color: c.pass ? 'var(--positive)' : 'var(--text-muted)' }}>
                              <span className="w-2 h-2 rounded-full inline-block" style={{ backgroundColor: c.pass ? 'var(--positive)' : 'var(--border-strong)' }} />
                              {c.label}
                            </span>
                          ))}
                        </div>
                        <span style={{ fontSize: 10, color: pwScore > 0 ? SCORE_COLORS[pwScore - 1] : 'var(--text-muted)' }}>
                          {pwScore > 0 ? SCORE_LABELS[pwScore - 1] : ''}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Confirm password */}
                <div>
                  <label className="label">Confirm password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                    <input type={showPassword ? 'text' : 'password'} value={formData.confirmPassword}
                      onChange={e => setFormData({ ...formData, confirmPassword: e.target.value })}
                      placeholder="••••••••"
                      className={`input ${confirmMismatch ? 'input-error' : ''}`}
                      style={{ paddingLeft: 36 }} required />
                  </div>
                  {confirmMismatch && (
                    <p className="text-xs mt-1" style={{ color: '#dc2626' }}>Passwords don&apos;t match</p>
                  )}
                </div>

                {/* Submit */}
                <button type="submit" disabled={loading || confirmMismatch} className="btn btn-primary btn-block" style={{ height: 38 }}>
                  {loading ? (
                    <span className="flex items-center gap-2">
                      <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                      Creating account...
                    </span>
                  ) : 'Create account'}
                </button>
              </form>

              {/* Divider */}
              <div className="relative my-5">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full" style={{ borderTop: '1px solid var(--border-color)' }} />
                </div>
                <div className="relative flex justify-center">
                  <span className="px-2 text-xs" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-muted)' }}>or</span>
                </div>
              </div>

              <p className="text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                Already have an account?{' '}
                <Link href="/login" className="font-medium" style={{ color: 'var(--accent)' }}>Sign in</Link>
              </p>
            </>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-xs mt-6" style={{ color: 'var(--text-muted)' }}>
          By signing up, you agree to our{' '}
          <Link href="/terms" style={{ color: 'var(--text-secondary)' }}>Terms</Link>{' '}
          and{' '}
          <Link href="/privacy" style={{ color: 'var(--text-secondary)' }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}
