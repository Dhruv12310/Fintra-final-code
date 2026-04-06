'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import { Brain, TrendingUp, Zap, Shield, ArrowRight, CheckCircle, BarChart3, FileText, Users, Sun, Moon } from 'lucide-react'

export default function RootPage() {
  const router = useRouter()
  const { user, company, loading } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (loading) return

    // If user is authenticated, redirect based on onboarding status
    if (user && company) {
      if (!company.onboarding_completed) {
        router.push('/onboarding')
      } else {
        router.push('/new-dashboard')
      }
    }
  }, [router, user, company, loading])

  // Show loading spinner while checking auth
  if (loading || !mounted) {
    return (
      <div
        className="flex items-center justify-center h-screen transition-colors duration-300"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neon-emerald)' }}></div>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neon-cyan)', animationDelay: '0.2s' }}></div>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neon-fuchsia)', animationDelay: '0.4s' }}></div>
        </div>
      </div>
    )
  }

  // If authenticated, show loading (will redirect via useEffect)
  if (user && company) {
    return (
      <div
        className="flex items-center justify-center h-screen transition-colors duration-300"
        style={{ backgroundColor: 'var(--bg-primary)' }}
      >
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neon-emerald)' }}></div>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neon-cyan)', animationDelay: '0.2s' }}></div>
          <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neon-fuchsia)', animationDelay: '0.4s' }}></div>
        </div>
      </div>
    )
  }

  // Show landing page for unauthenticated users
  return (
    <div
      className="min-h-screen transition-colors duration-300"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      {/* Neon background effects */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div
          className="absolute -top-32 left-1/4 h-96 w-96 rounded-full blur-[200px] transition-opacity duration-500"
          style={{ backgroundColor: 'var(--neon-fuchsia)', opacity: 'var(--glow-opacity)' }}
        />
        <div
          className="absolute top-1/3 right-0 h-80 w-80 rounded-full blur-[180px] transition-opacity duration-500"
          style={{ backgroundColor: 'var(--neon-cyan)', opacity: 'var(--glow-opacity)' }}
        />
        <div
          className="absolute bottom-10 left-10 h-72 w-72 rounded-full blur-[160px] transition-opacity duration-500"
          style={{ backgroundColor: 'var(--neon-emerald)', opacity: 'var(--glow-opacity)' }}
        />
      </div>

      {/* Navigation */}
      <nav
        className="border-b backdrop-blur-sm sticky top-0 z-50"
        style={{ borderColor: 'var(--border-color)', backgroundColor: theme === 'dark' ? 'rgba(2, 6, 23, 0.8)' : 'rgba(248, 250, 252, 0.8)' }}
      >
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan))' }}>
              <BarChart3 className="w-5 h-5 text-white" />
            </div>
            <span className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Fintra Finance OS</span>
          </div>

          <div className="flex items-center gap-3">
            {/* Theme toggle */}
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
            >
              {theme === 'dark' ? (
                <Sun className="w-5 h-5" style={{ color: 'var(--neon-cyan)' }} />
              ) : (
                <Moon className="w-5 h-5" style={{ color: 'var(--neon-fuchsia)' }} />
              )}
            </button>

            <button
              onClick={() => router.push('/login')}
              className="px-4 py-2 text-sm font-medium transition-colors"
              style={{ color: 'var(--text-secondary)' }}
            >
              Sign in
            </button>
            <button
              onClick={() => router.push('/signup')}
              className="px-5 py-2.5 text-sm font-medium rounded-lg transition-all hover:scale-105"
              style={{
                background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-fuchsia))',
                color: 'white'
              }}
            >
              Get started
            </button>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative max-w-7xl mx-auto px-6 pt-20 pb-16">
        <div className="max-w-3xl">
          <div
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-sm mb-8"
            style={{
              backgroundColor: theme === 'dark' ? 'rgba(34, 211, 238, 0.1)' : 'rgba(34, 211, 238, 0.15)',
              border: '1px solid var(--neon-cyan)',
              color: 'var(--neon-cyan)'
            }}
          >
            <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: 'var(--neon-cyan)' }}></div>
            AI-Powered Accounting for Everyone
          </div>

          <h1 className="text-5xl md:text-6xl font-bold mb-6 leading-tight">
            <span style={{ color: 'var(--text-primary)' }}>Financial clarity</span>
            <br />
            <span className="text-gradient-neon">without the complexity</span>
          </h1>

          <p className="text-xl mb-8 leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
            The accounting platform that actually makes sense. AI-guided bookkeeping,
            real-time insights, and effortless financial management for non-accountants
            and growing businesses.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => router.push('/signup')}
              className="px-8 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-105 flex items-center gap-2"
              style={{
                background: 'linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan))',
                color: 'white',
                boxShadow: theme === 'dark' ? '0 0 40px rgba(34, 211, 238, 0.3)' : '0 4px 20px rgba(34, 211, 238, 0.3)'
              }}
            >
              Start free trial
              <ArrowRight className="w-5 h-5" />
            </button>
            <button
              onClick={() => router.push('/login')}
              className="px-8 py-4 rounded-xl font-medium text-lg transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)'
              }}
            >
              Sign in
            </button>
          </div>

          {/* Quick stats */}
          <div className="flex flex-wrap gap-8 mt-12 pt-8" style={{ borderTop: '1px solid var(--border-color)' }}>
            <div>
              <div className="text-2xl font-bold" style={{ color: 'var(--neon-cyan)' }}>5 min</div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Setup time</div>
            </div>
            <div>
              <div className="text-2xl font-bold" style={{ color: 'var(--neon-emerald)' }}>Zero</div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>Accounting knowledge needed</div>
            </div>
            <div>
              <div className="text-2xl font-bold" style={{ color: 'var(--neon-fuchsia)' }}>Real-time</div>
              <div className="text-sm" style={{ color: 'var(--text-secondary)' }}>AI insights</div>
            </div>
          </div>
        </div>
      </section>

      {/* Features Grid */}
      <section className="relative max-w-7xl mx-auto px-6 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
            Everything you need, nothing you don't
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Built for business owners, not accountants
          </p>
        </div>

        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* AI Insights */}
          <div
            className="p-6 rounded-xl transition-all hover:scale-105 group"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)'
            }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors"
              style={{ backgroundColor: theme === 'dark' ? 'rgba(34, 211, 238, 0.1)' : 'rgba(34, 211, 238, 0.15)' }}
            >
              <Brain className="w-6 h-6" style={{ color: 'var(--neon-cyan)' }} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>AI Insights</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Get plain-English explanations of your finances. Ask questions, get answers instantly.
            </p>
          </div>

          {/* Real-time Analytics */}
          <div
            className="p-6 rounded-xl transition-all hover:scale-105 group"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)'
            }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors"
              style={{ backgroundColor: theme === 'dark' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(52, 211, 153, 0.15)' }}
            >
              <TrendingUp className="w-6 h-6" style={{ color: 'var(--neon-emerald)' }} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Live Dashboards</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Real-time metrics, cash flow tracking, and predictive analytics at a glance.
            </p>
          </div>

          {/* Automation */}
          <div
            className="p-6 rounded-xl transition-all hover:scale-105 group"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)'
            }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors"
              style={{ backgroundColor: theme === 'dark' ? 'rgba(217, 70, 239, 0.1)' : 'rgba(217, 70, 239, 0.15)' }}
            >
              <Zap className="w-6 h-6" style={{ color: 'var(--neon-fuchsia)' }} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Smart Automation</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Automated categorization, journal entries, and reconciliation. Less manual work.
            </p>
          </div>

          {/* Security */}
          <div
            className="p-6 rounded-xl transition-all hover:scale-105 group"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)'
            }}
          >
            <div
              className="w-12 h-12 rounded-xl flex items-center justify-center mb-4 transition-colors"
              style={{ backgroundColor: theme === 'dark' ? 'rgba(129, 140, 248, 0.1)' : 'rgba(129, 140, 248, 0.15)' }}
            >
              <Shield className="w-6 h-6" style={{ color: 'var(--neon-indigo)' }} />
            </div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Enterprise Security</h3>
            <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
              Bank-grade encryption and compliance. Your data is always protected.
            </p>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="relative max-w-7xl mx-auto px-6 py-16" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div className="max-w-2xl mb-12">
          <h2 className="text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
            Get started in minutes
          </h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            No accounting degree required. Our AI learns your business and handles the rest.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-8">
          <div className="flex gap-4">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-semibold"
              style={{
                backgroundColor: theme === 'dark' ? 'rgba(34, 211, 238, 0.1)' : 'rgba(34, 211, 238, 0.15)',
                border: '1px solid var(--neon-cyan)',
                color: 'var(--neon-cyan)'
              }}
            >
              1
            </div>
            <div>
              <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Sign up & Setup</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Tell us about your business. Our quick onboarding captures what we need to help you.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-semibold"
              style={{
                backgroundColor: theme === 'dark' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(52, 211, 153, 0.15)',
                border: '1px solid var(--neon-emerald)',
                color: 'var(--neon-emerald)'
              }}
            >
              2
            </div>
            <div>
              <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>AI Takes Over</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                AI categorizes transactions, creates journal entries, and spots anomalies automatically.
              </p>
            </div>
          </div>

          <div className="flex gap-4">
            <div
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center font-semibold"
              style={{
                backgroundColor: theme === 'dark' ? 'rgba(217, 70, 239, 0.1)' : 'rgba(217, 70, 239, 0.15)',
                border: '1px solid var(--neon-fuchsia)',
                color: 'var(--neon-fuchsia)'
              }}
            >
              3
            </div>
            <div>
              <h3 className="font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Understand & Grow</h3>
              <p className="text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                Get real-time insights, industry benchmarks, and actionable recommendations.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* AI Features Highlight */}
      <section className="relative max-w-7xl mx-auto px-6 py-16" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <div
              className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm mb-6"
              style={{
                backgroundColor: theme === 'dark' ? 'rgba(217, 70, 239, 0.1)' : 'rgba(217, 70, 239, 0.15)',
                color: 'var(--neon-fuchsia)'
              }}
            >
              <Brain className="w-4 h-4" />
              Dual AI Power
            </div>
            <h2 className="text-3xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
              Two AI engines, one powerful platform
            </h2>
            <p className="mb-6" style={{ color: 'var(--text-secondary)' }}>
              We combine local financial analysis with real-time market intelligence to give you
              the complete picture.
            </p>

            <div className="space-y-4">
              <div
                className="p-4 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)' }}>
                    <FileText className="w-4 h-4 text-blue-500" />
                  </div>
                  <h4 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Local Analysis (OpenAI)</h4>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Analyzes YOUR financial data. Ask about expenses, cash flow, revenue trends, anomalies, and cost savings.
                </p>
              </div>

              <div
                className="p-4 rounded-xl"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}
              >
                <div className="flex items-center gap-3 mb-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'rgba(16, 185, 129, 0.2)' }}>
                    <TrendingUp className="w-4 h-4 text-emerald-500" />
                  </div>
                  <h4 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Market Intelligence (Perplexity)</h4>
                </div>
                <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                  Real-time industry benchmarks, competitor analysis, tax updates, and growth recommendations with citations.
                </p>
              </div>
            </div>
          </div>

          <div
            className="p-6 rounded-2xl"
            style={{
              backgroundColor: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              boxShadow: theme === 'dark' ? '0 0 60px rgba(217, 70, 239, 0.1)' : '0 20px 60px rgba(0, 0, 0, 0.1)'
            }}
          >
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)' }}>
                  <Users className="w-4 h-4 text-blue-500" />
                </div>
                <div
                  className="px-4 py-3 rounded-2xl rounded-tl-none flex-1"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    "What were my top expenses last month?"
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-fuchsia))' }}>
                  <Brain className="w-4 h-4 text-white" />
                </div>
                <div
                  className="px-4 py-3 rounded-2xl rounded-tl-none flex-1"
                  style={{ backgroundColor: theme === 'dark' ? 'rgba(34, 211, 238, 0.1)' : 'rgba(34, 211, 238, 0.15)' }}
                >
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    Your top 5 expenses were: Software subscriptions ($2,400), Marketing ($1,800),
                    Office supplies ($950), Utilities ($620), and Travel ($580).
                    Software costs increased 15% from last month.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ backgroundColor: 'rgba(59, 130, 246, 0.2)' }}>
                  <Users className="w-4 h-4 text-blue-500" />
                </div>
                <div
                  className="px-4 py-3 rounded-2xl rounded-tl-none flex-1"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    "How does this compare to my industry?"
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: 'linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan))' }}>
                  <TrendingUp className="w-4 h-4 text-white" />
                </div>
                <div
                  className="px-4 py-3 rounded-2xl rounded-tl-none flex-1"
                  style={{ backgroundColor: theme === 'dark' ? 'rgba(52, 211, 153, 0.1)' : 'rgba(52, 211, 153, 0.15)' }}
                >
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    SaaS companies typically spend 25-30% on software. At 18%, you're below average.
                    Marketing at 14% is healthy for your growth stage.
                    <span className="block mt-2 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Sources: IBISWorld, Statista 2026
                    </span>
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social Proof */}
      <section className="relative max-w-7xl mx-auto px-6 py-16" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div className="flex flex-col md:flex-row items-center justify-between gap-8">
          <div>
            <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Built for the modern business</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
              Trusted by startups, agencies, and growing companies
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-6 text-sm" style={{ color: 'var(--text-muted)' }}>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" style={{ color: 'var(--neon-emerald)' }} />
              <span>SOC 2 Certified</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" style={{ color: 'var(--neon-emerald)' }} />
              <span>Bank-grade Security</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" style={{ color: 'var(--neon-emerald)' }} />
              <span>99.9% Uptime</span>
            </div>
            <div className="flex items-center gap-2">
              <CheckCircle className="w-5 h-5" style={{ color: 'var(--neon-emerald)' }} />
              <span>GDPR Compliant</span>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative max-w-7xl mx-auto px-6 py-20" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div
          className="max-w-3xl mx-auto text-center p-12 rounded-2xl"
          style={{
            backgroundColor: 'var(--bg-card)',
            border: '1px solid var(--border-color)',
            boxShadow: theme === 'dark' ? '0 0 80px rgba(34, 211, 238, 0.15)' : '0 20px 60px rgba(0, 0, 0, 0.1)'
          }}
        >
          <h2 className="text-4xl font-bold mb-4" style={{ color: 'var(--text-primary)' }}>
            Ready to simplify your accounting?
          </h2>
          <p className="text-xl mb-8" style={{ color: 'var(--text-secondary)' }}>
            Start your free trial. No credit card required. No accounting degree needed.
          </p>
          <button
            onClick={() => router.push('/signup')}
            className="px-10 py-4 rounded-xl font-semibold text-lg transition-all hover:scale-105 inline-flex items-center gap-2"
            style={{
              background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-fuchsia))',
              color: 'white',
              boxShadow: theme === 'dark' ? '0 0 40px rgba(217, 70, 239, 0.3)' : '0 4px 20px rgba(217, 70, 239, 0.3)'
            }}
          >
            Get started free
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </section>

      {/* Footer */}
      <footer style={{ borderTop: '1px solid var(--border-color)' }} className="mt-20">
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-sm" style={{ color: 'var(--text-muted)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: 'linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan))' }}>
                <BarChart3 className="w-4 h-4 text-white" />
              </div>
              <span style={{ color: 'var(--text-secondary)' }}>Fintra Finance OS</span>
            </div>
            <div className="flex items-center gap-6">
              <span>&copy; 2026 Fintra Finance OS</span>
              <a href="#" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>Privacy</a>
              <a href="#" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>Terms</a>
              <a href="#" className="hover:underline" style={{ color: 'var(--text-secondary)' }}>Contact</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
