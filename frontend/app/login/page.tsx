'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { Building2, Mail, Lock, Eye, EyeOff, CheckCircle, Sun, Moon, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'

function LoginInner() {
  const { signIn, checkLoginLockout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [formData, setFormData] = useState({ email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState(0)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (searchParams.get('confirmed') === 'true') {
      setShowConfirmation(true)
      setTimeout(() => setShowConfirmation(false), 5000)
    }
  }, [searchParams])

  useEffect(() => {
    if (lockoutRemainingSeconds <= 0) return
    const timer = setInterval(() => {
      setLockoutRemainingSeconds(prev => (prev <= 1 ? 0 : prev - 1))
    }, 1000)
    return () => clearInterval(timer)
  }, [lockoutRemainingSeconds])

  useEffect(() => {
    const normalizedEmail = formData.email.trim().toLowerCase()
    if (!normalizedEmail) { setLockoutRemainingSeconds(0); return }
    const timeout = setTimeout(async () => {
      const lockout = await checkLoginLockout(normalizedEmail)
      setLockoutRemainingSeconds(lockout.locked ? lockout.remainingSeconds : 0)
    }, 300)
    return () => clearTimeout(timeout)
  }, [formData.email, checkLoginLockout])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (lockoutRemainingSeconds > 0) { setError(`Too many failed attempts. Try again in ${lockoutRemainingSeconds} seconds.`); return }
    setLoading(true); setError('')
    try {
      await signIn(formData.email, formData.password)
    } catch (error: any) {
      if (error?.code === 'AUTH_LOCKED') setLockoutRemainingSeconds(Number(error?.remainingSeconds || 0))
      setError(error.message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!mounted) {
    return <div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }} />
  }

  return (
    <div
      data-glow-zone="true"
      className="min-h-screen dot-grid flex items-center justify-center p-4 relative"
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
        {/* Logo + heading (above card) */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center gap-2.5 mb-5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center"
              style={{ backgroundColor: 'var(--accent)', boxShadow: '0 1px 4px rgba(37,99,235,0.35)' }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-lg font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.025em' }}>Fintra</span>
          </div>
          <h1 className="mb-1" style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.025em' }}>Welcome back</h1>
          <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Sign in to your account to continue</p>
        </div>

        {/* Card */}
        <div className="card p-7">
          {/* Success banner */}
          {showConfirmation && (
            <div className="mb-5 p-3 rounded-lg flex items-center gap-3"
              style={{ backgroundColor: 'rgba(52,211,153,0.12)', border: '1px solid rgba(52,211,153,0.25)' }}>
              <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--neon-emerald)' }} />
              <div>
                <p className="text-sm font-medium" style={{ color: 'var(--neon-emerald)' }}>Email confirmed!</p>
                <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>You can now sign in.</p>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="mb-5 p-3 rounded-lg text-sm"
              style={{ backgroundColor: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)', color: '#dc2626' }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="label">Email address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="email"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  placeholder="you@example.com"
                  className="input"
                  style={{ paddingLeft: 36 }}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-[5px]">
                <label className="label" style={{ marginBottom: 0 }}>Password</label>
                <Link href="/forgot-password" className="text-xs" style={{ color: 'var(--accent)' }}>Forgot password?</Link>
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={e => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className="input"
                  style={{ paddingLeft: 36, paddingRight: 40 }}
                  disabled={loading || lockoutRemainingSeconds > 0}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5"
                  style={{ color: 'var(--text-muted)' }}
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading || lockoutRemainingSeconds > 0}
              className="btn btn-primary btn-block"
              style={{ height: 38 }}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Signing in...
                </span>
              ) : lockoutRemainingSeconds > 0 ? (
                `Locked (${lockoutRemainingSeconds}s)`
              ) : (
                'Sign in'
              )}
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
            Don&apos;t have an account?{' '}
            <Link href="/signup" className="font-medium" style={{ color: 'var(--accent)' }}>Create one free</Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs mt-6" style={{ color: 'var(--text-muted)' }}>
          By signing in, you agree to our{' '}
          <Link href="/terms" style={{ color: 'var(--text-secondary)' }}>Terms</Link>{' '}
          and{' '}
          <Link href="/privacy" style={{ color: 'var(--text-secondary)' }}>Privacy Policy</Link>
        </p>
      </div>
    </div>
  )
}

export default function Login() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }} />}>
      <LoginInner />
    </Suspense>
  )
}
