'use client'

import { useState, useEffect } from 'react'
import { BarChart3, Mail, Lock, User, Eye, EyeOff, CheckCircle, Sun, Moon, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'

export default function Signup() {
  const { signUp } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [showPassword, setShowPassword] = useState(false)
  const [mounted, setMounted] = useState(false)
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    password: '',
    confirmPassword: ''
  })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }

    setLoading(true)

    try {
      await signUp(formData.email, formData.password, formData.fullName)
      setSuccess(true)
    } catch (error: any) {
      console.error('Signup failed:', error)
      setError(error.message || 'Signup failed. Please try again.')
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
      data-glow-zone="true"
      className="min-h-screen flex items-center justify-center p-4 relative transition-colors duration-300"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* Neon background effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -top-32 left-1/4 h-96 w-96 rounded-full blur-[200px] transition-opacity duration-500"
          style={{ backgroundColor: 'var(--neon-emerald)', opacity: 'var(--glow-opacity)' }}
        />
        <div
          className="absolute bottom-20 right-1/4 h-80 w-80 rounded-full blur-[180px] transition-opacity duration-500"
          style={{ backgroundColor: 'var(--neon-fuchsia)', opacity: 'var(--glow-opacity)' }}
        />
        <div
          className="absolute top-1/2 right-10 h-64 w-64 rounded-full blur-[150px] transition-opacity duration-500"
          style={{ backgroundColor: 'var(--neon-cyan)', opacity: 'var(--glow-opacity)' }}
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
          <h1 className="text-2xl font-bold mb-2" style={{ color: 'var(--text-primary)' }}>Create your account</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Start managing your finances with AI</p>
        </div>

        {/* Signup Form */}
        <div
          className="rounded-2xl p-8 backdrop-blur-xl transition-all"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: theme === 'dark'
              ? '0 0 60px rgba(52, 211, 153, 0.1)'
              : '0 20px 60px rgba(0, 0, 0, 0.1)'
          }}
        >
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

          {success && (
            <div
              className="mb-4 p-4 rounded-lg"
              style={{
                backgroundColor: theme === 'dark' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(52, 211, 153, 0.15)',
                border: '1px solid var(--neon-emerald)'
              }}
            >
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" style={{ color: 'var(--neon-emerald)' }} />
                <div>
                  <p className="font-medium mb-1" style={{ color: 'var(--neon-emerald)' }}>Check your email!</p>
                  <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                    We've sent a confirmation link to <strong style={{ color: 'var(--text-primary)' }}>{formData.email}</strong>.
                    Click the link to verify your account and you'll be redirected to login.
                  </p>
                </div>
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Full Name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  placeholder="John Doe"
                  className="w-full pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 transition-all"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    boxShadow: theme === 'dark' ? '0 0 20px rgba(52, 211, 153, 0.05)' : 'none'
                  }}
                  required
                />
              </div>
            </div>

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
                    boxShadow: theme === 'dark' ? '0 0 20px rgba(52, 211, 153, 0.05)' : 'none'
                  }}
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
                    boxShadow: theme === 'dark' ? '0 0 20px rgba(52, 211, 153, 0.05)' : 'none'
                  }}
                  required
                  minLength={8}
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
              <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>At least 8 characters</p>
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Confirm Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5" style={{ color: 'var(--text-muted)' }} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                  placeholder="••••••••"
                  className="w-full pl-10 pr-4 py-3 rounded-lg focus:outline-none focus:ring-2 transition-all"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-primary)',
                    boxShadow: theme === 'dark' ? '0 0 20px rgba(52, 211, 153, 0.05)' : 'none'
                  }}
                  required
                />
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-lg font-semibold transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
              style={{
                background: 'linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan))',
                color: 'white',
                boxShadow: theme === 'dark' ? '0 0 30px rgba(52, 211, 153, 0.2)' : '0 4px 20px rgba(52, 211, 153, 0.2)'
              }}
            >
              {loading ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                  Creating account...
                </span>
              ) : (
                'Create Account'
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

          {/* Login Link */}
          <p className="text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
            Already have an account?{' '}
            <Link
              href="/login"
              className="font-medium transition-colors"
              style={{ color: 'var(--neon-cyan)' }}
            >
              Sign in
            </Link>
          </p>
        </div>

        {/* Footer */}
        <p className="text-center text-xs mt-8" style={{ color: 'var(--text-muted)' }}>
          By signing up, you agree to our{' '}
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
