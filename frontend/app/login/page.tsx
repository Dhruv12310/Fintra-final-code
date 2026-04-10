'use client'

import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'
import { BarChart3, Mail, Lock, Eye, EyeOff, CheckCircle, Sun, Moon, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'

export default function Login() {
  const { signIn, checkLoginLockout } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const searchParams = useSearchParams()
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [lockoutRemainingSeconds, setLockoutRemainingSeconds] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (searchParams.get('confirmed') === 'true') {
      setShowConfirmation(true)
      // Hide after 5 seconds
      setTimeout(() => setShowConfirmation(false), 5000)
    }
  }, [searchParams])

  useEffect(() => {
    if (lockoutRemainingSeconds <= 0) return

    const timer = setInterval(() => {
      setLockoutRemainingSeconds((prev) => {
        if (prev <= 1) return 0
        return prev - 1
      })
    }, 1000)

    return () => clearInterval(timer)
  }, [lockoutRemainingSeconds])

  useEffect(() => {
    const normalizedEmail = formData.email.trim().toLowerCase()
    if (!normalizedEmail) {
      setLockoutRemainingSeconds(0)
      return
    }

    const timeout = setTimeout(async () => {
      const lockout = await checkLoginLockout(normalizedEmail)
      setLockoutRemainingSeconds(lockout.locked ? lockout.remainingSeconds : 0)
    }, 300)

    return () => clearTimeout(timeout)
  }, [formData.email, checkLoginLockout])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (lockoutRemainingSeconds > 0) {
      setError(`Too many failed attempts. Try again in ${lockoutRemainingSeconds} seconds.`)
      return
    }
    setLoading(true)
    setError('')

    try {
      await signIn(formData.email, formData.password)
    } catch (error: any) {
      console.error('Login failed:', error)
      if (error?.code === 'AUTH_LOCKED') {
        const remaining = Number(error?.remainingSeconds || 0)
        setLockoutRemainingSeconds(remaining)
      }
      setError(error.message || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!mounted) {
    return (
      <div
        className="flex items-center justify-center h-screen transition-colors duration-300"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neon-cyan)' }}></div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative transition-colors duration-300"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* Neon background effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -top-32 right-1/4 h-96 w-96 rounded-full blur-[200px] transition-opacity duration-500"
          style={{ backgroundColor: 'var(--neon-cyan)', opacity: 'var(--glow-opacity)' }}
        />
        <div
          className="absolute bottom-20 left-1/4 h-80 w-80 rounded-full blur-[180px] transition-opacity duration-500"
          style={{ backgroundColor: 'var(--neon-fuchsia)', opacity: 'var(--glow-opacity)' }}
        />
      </div>

      {/* Theme toggle - top right */}
      <button
        onClick={toggleTheme}
        className="fixed top-4 right-4 p-2 rounded-lg transition-colors z-50"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
      >
        {theme === 'dark' ? (
          <Sun className="w-5 h-5" style={{ color: 'var(--neon-cyan)' }} />
        ) : (
          <Moon className="w-5 h-5" style={{ color: 'var(--neon-fuchsia)' }} />
        )}
      </button>

      {/* Back to home */}
      <Link
        href="/"
        className="fixed top-4 left-4 p-2 rounded-lg transition-colors z-50 flex items-center gap-2 text-sm"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </Link>

      <div className="w-full max-w-md relative z-10">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-3 mb-6">
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan))' }}
            >
              <BarChart3 className="w-6 h-6 text-white" />
            </div>
            <span className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>Fintra Finance OS</span>
          </div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Welcome back</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Sign in to your account to continue</p>
        </div>

        {/* Login Form */}
        <div
          className="rounded-2xl p-8 backdrop-blur-xl transition-all"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: theme === 'dark'
              ? '0 0 60px rgba(34, 211, 238, 0.1)'
              : '0 20px 60px rgba(0, 0, 0, 0.1)'
          }}
        >
          {showConfirmation && (
            <div
              className="mb-4 p-4 rounded-lg"
              style={{
                backgroundColor: theme === 'dark' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(52, 211, 153, 0.15)',
                border: '1px solid var(--neon-emerald)'
              }}
            >
              <div className="flex items-center gap-3">
                <CheckCircle className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--neon-emerald)' }} />
                <div>
                  <p className="font-medium" style={{ color: 'var(--neon-emerald)' }}>Email confirmed successfully!</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>You can now sign in to your account.</p>
                </div>
              </div>
            </div>
          )}

          {error && (
            <div
              className="mb-4 p-3 rounded-lg text-sm"
              style={{
                backgroundColor: theme === 'dark' ? 'rgba(239, 68, 68, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                border: '1px solid rgba(239, 68, 68, 0.5)',
                color: '#ef4444'
              }}
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Email</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  placeholder="you@example.com"
                  className="w-full pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 transition-all"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    boxShadow: theme === 'dark' ? '0 0 20px rgba(34, 211, 238, 0.05)' : 'none'
                  }}
                  disabled={loading}
                  required
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-12 py-3 rounded-lg focus:outline-none focus:ring-2 transition-all"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    boxShadow: theme === 'dark' ? '0 0 20px rgba(34, 211, 238, 0.05)' : 'none'
                  }}
                  disabled={loading || lockoutRemainingSeconds > 0}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            {/* Forgot Password */}
            <div className="flex justify-end">
              <Link
                href="/forgot-password"
                className="text-sm transition-colors"
                style={{ color: 'var(--neon-cyan)' }}
              >
                Forgot password?
              </Link>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading || lockoutRemainingSeconds > 0}
              className="w-full py-3.5 rounded-lg font-semibold transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-fuchsia))',
                color: 'white',
                boxShadow: theme === 'dark' ? '0 0 30px rgba(34, 211, 238, 0.2)' : '0 4px 20px rgba(34, 211, 238, 0.2)'
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Signing in...
                </span>
              ) : lockoutRemainingSeconds > 0 ? (
                `Locked (${lockoutRemainingSeconds}s)`
              ) : (
                'Sign In'
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full" style={{ borderTop: '1px solid var(--border-color)' }}></div>
            </div>
            <div className="relative flex justify-center text-sm">
              <span className="px-3" style={{ backgroundColor: 'var(--bg-card)', color: 'var(--text-muted)' }}>or</span>
            </div>
          </div>

          {/* Sign Up Link */}
          <p className="text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            Don't have an account?{' '}
            <Link
              href="/signup"
              className="font-medium transition-colors"
              style={{ color: 'var(--neon-cyan)' }}
            >
              Sign up
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
          By signing in, you agree to our{' '}
          <Link href="/terms" className="transition-colors hover:underline" style={{ color: 'var(--text-secondary)' }}>
            Terms
          </Link>{' '}
          and{' '}
          <Link href="/privacy" className="transition-colors hover:underline" style={{ color: 'var(--text-secondary)' }}>
            Privacy Policy
          </Link>
        </p>
      </div>
    </div>
  )
}
