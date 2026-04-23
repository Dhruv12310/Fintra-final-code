'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { useTheme } from '@/contexts/ThemeContext'
import {
  BarChart3, TrendingUp, Shield, ArrowRight, CheckCircle,
  FileText, Users, Sun, Moon, Building2, CreditCard,
  Sparkles, ChevronRight, BookOpen, FolderTree, RefreshCw,
} from 'lucide-react'

export default function RootPage() {
  const router = useRouter()
  const { user, company, loading } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const [mounted, setMounted] = useState(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (loading) return
    if (user && company) {
      if (!company.onboarding_completed) {
        router.push('/onboarding')
      } else {
        router.push('/new-dashboard')
      }
    }
  }, [router, user, company, loading])

  if (loading || !mounted || (user && company)) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
              style={{ backgroundColor: 'var(--accent)', animationDelay: `${i * 0.15}s` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen dot-grid" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>

      {/* ── Sticky Nav ── */}
      <nav
        className="sticky top-0 z-50 border-b"
        style={{
          backgroundColor: theme === 'dark' ? 'rgba(9,9,12,0.92)' : 'rgba(248,250,252,0.92)',
          borderColor: 'var(--border-color)',
          backdropFilter: 'blur(12px)',
        }}
      >
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          {/* Logo */}
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ backgroundColor: 'var(--accent)', boxShadow: '0 1px 4px rgba(37,99,235,0.35)' }}>
              <Building2 className="w-4 h-4 text-white" />
            </div>
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>Fintra</span>
          </div>

          {/* Center links — hidden on mobile */}
          <div className="hidden md:flex items-center gap-1">
            {['Features', 'How it works', 'Pricing'].map(label => (
              <button key={label} className="btn btn-ghost btn-sm">{label}</button>
            ))}
          </div>

          {/* Right actions */}
          <div className="flex items-center gap-2">
            <button onClick={toggleTheme} className="btn btn-icon btn-sm" aria-label="Toggle theme">
              {theme === 'dark'
                ? <Sun className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                : <Moon className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />}
            </button>
            <button onClick={() => router.push('/login')} className="btn btn-ghost btn-sm">Sign in</button>
            <button onClick={() => router.push('/signup')} className="btn btn-primary btn-sm">
              Get started <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ── */}
      <section className="relative max-w-4xl mx-auto px-6 pt-24 pb-20 text-center">
        {/* Radial hero glow behind */}
        <div className="pointer-events-none absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/3 h-[600px] w-[600px] rounded-full blur-[120px]" aria-hidden
          style={{ backgroundColor: 'var(--accent)', opacity: theme === 'dark' ? 0.2 : 0.1 }} />

        {/* Badge */}
        <div className="animate-fade-up inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-8"
          style={{
            border: '1px solid var(--border-color)',
            backgroundColor: 'var(--bg-card)',
            color: 'var(--text-secondary)',
          }}>
          <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
          AI-powered finance OS
        </div>

        <h1
          className="animate-fade-up font-bold mb-6"
          style={{
            fontSize: 'clamp(3rem, 7vw, 5rem)',
            letterSpacing: '-0.04em',
            lineHeight: 1.1,
            animationDelay: '40ms',
          }}
        >
          <span style={{ color: 'var(--text-primary)' }}>Financial clarity</span>
          <br />
          <span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>without the complexity.</span>
        </h1>

        <p className="animate-fade-up text-base mb-10 max-w-xl mx-auto" style={{ color: 'var(--text-secondary)', lineHeight: 1.65, animationDelay: '80ms' }}>
          The accounting platform that actually makes sense. AI-guided bookkeeping, bank sync,
          invoices, and reports — all in one clean workspace.
        </p>

        <div className="animate-fade-up flex flex-wrap items-center justify-center gap-3 mb-4" style={{ animationDelay: '120ms' }}>
          <button onClick={() => router.push('/signup')} className="btn btn-primary btn-lg">
            Start for free <ArrowRight className="w-4 h-4" />
          </button>
          <button onClick={() => router.push('/login')} className="btn btn-secondary btn-lg">Sign in</button>
        </div>

        <p className="animate-fade-up text-xs" style={{ color: 'var(--text-muted)', animationDelay: '160ms' }}>
          No credit card required · Free to start · Takes 5 minutes to set up
        </p>
      </section>

      {/* ── Fake browser mockup ── */}
      <section className="max-w-5xl mx-auto px-6 pb-20">
        <div className="rounded-xl border overflow-hidden" style={{ borderColor: 'var(--border-color)', boxShadow: 'var(--shadow-xl)' }}>
          {/* Browser chrome */}
          <div className="flex items-center gap-2 px-4 py-3 border-b" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)' }}>
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#ef4444' }} />
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#f59e0b' }} />
            <div className="w-3 h-3 rounded-full" style={{ backgroundColor: '#10b981' }} />
            <div className="flex-1 mx-4 h-6 rounded-md flex items-center px-3" style={{ backgroundColor: 'var(--bg-muted)', border: '1px solid var(--border-color)' }}>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>app.fintra.com</span>
            </div>
          </div>
          {/* Dashboard mockup */}
          <div className="p-6" style={{ backgroundColor: 'var(--bg-card)' }}>
            {/* KPI row */}
            <div className="grid grid-cols-4 gap-4 mb-6">
              {[
                { label: 'Revenue', value: '$84,200', change: '+12.4%', pos: true },
                { label: 'Expenses', value: '$41,800', change: '+3.1%', pos: false },
                { label: 'Net profit', value: '$42,400', change: '+24.1%', pos: true },
                { label: 'Cash on hand', value: '$128,900', change: '+6.7%', pos: true },
              ].map(kpi => (
                <div key={kpi.label} className="kpi">
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{kpi.label}</span>
                  <span className="text-xl font-semibold num-display" style={{ color: 'var(--text-primary)' }}>{kpi.value}</span>
                  <span className="text-xs font-medium" style={{ color: kpi.pos ? 'var(--positive)' : 'var(--negative)' }}>{kpi.change}</span>
                </div>
              ))}
            </div>
            {/* Mini chart placeholder + recent */}
            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2 rounded-lg border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-tertiary)', minHeight: 120 }}>
                <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>Revenue vs Expenses — Last 6 months</p>
                <div className="flex items-end gap-1.5 h-16">
                  {[65, 80, 55, 90, 70, 95].map((h, i) => (
                    <div key={i} className="flex-1 flex flex-col justify-end gap-0.5">
                      <div className="rounded-sm" style={{ height: `${h * 0.6}%`, backgroundColor: 'var(--accent)', opacity: 0.7 }} />
                      <div className="rounded-sm" style={{ height: `${h * 0.4}%`, backgroundColor: 'var(--neon-red)', opacity: 0.5 }} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded-lg border p-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}>
                <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-muted)' }}>Recent</p>
                <div className="space-y-2">
                  {[
                    { name: 'Stripe payout', amt: '+$4,200', pos: true },
                    { name: 'AWS invoice', amt: '-$890', pos: false },
                    { name: 'Gusto payroll', amt: '-$6,200', pos: false },
                  ].map(t => (
                    <div key={t.name} className="flex items-center justify-between">
                      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{t.name}</span>
                      <span className="text-xs font-medium num" style={{ color: t.pos ? 'var(--positive)' : 'var(--negative)' }}>{t.amt}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── Trusted by strip ── */}
      <div className="border-y py-4" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="max-w-5xl mx-auto px-6 flex flex-wrap items-center justify-center gap-x-8 gap-y-2">
          {['Founders & Operators', 'Finance Leads', 'Accountants', 'Startups', 'Agencies', 'Growing Teams'].map(label => (
            <span key={label} className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}</span>
          ))}
        </div>
      </div>

      {/* ── Features grid ── */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="text-center mb-14">
          <p className="section-label mb-2">Features</p>
          <h2 style={{ color: 'var(--text-primary)' }}>Everything finance teams need.</h2>
          <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>Nothing they don't.</p>
          <p className="mt-1 text-sm max-w-md mx-auto" style={{ color: 'var(--text-muted)' }}>
            Built for founders, finance leads, and accountants who want accuracy without the overhead of enterprise software.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-5">
          {[
            {
              icon: BarChart3,
              color: 'var(--accent)',
              colorBg: 'var(--accent-subtle)',
              title: 'Real-time P&L',
              desc: 'Live profit & loss, balance sheet, and cash flow — always current.',
              mockup: (
                <div className="mt-4 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  <div className="px-3 py-2 border-b text-xs font-semibold" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Income Statement · Apr 2025</div>
                  {[['Revenue', '$84,200', true], ['Cost of goods', '-$22,100', false], ['Gross profit', '$62,100', true], ['Operating expenses', '-$19,700', false], ['Net profit', '$42,400', true]].map(([l, v, pos]) => (
                    <div key={String(l)} className="flex items-center justify-between px-3 py-1.5 border-b last:border-0" style={{ borderColor: 'var(--border-color)', fontSize: 12 }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{l}</span>
                      <span className="font-medium num" style={{ color: pos ? 'var(--accent)' : 'var(--text-primary)' }}>{v}</span>
                    </div>
                  ))}
                </div>
              ),
            },
            {
              icon: Sparkles,
              color: '#8b5cf6',
              colorBg: 'rgba(139,92,246,0.08)',
              title: 'AI Financial Copilot',
              desc: 'Ask anything in plain English. Answers from your actual data.',
              mockup: (
                <div className="mt-4 space-y-2">
                  <div className="flex justify-end">
                    <div className="px-3 py-2 rounded-xl text-xs" style={{ backgroundColor: 'var(--accent)', color: 'white', maxWidth: '80%' }}>
                      Why did expenses spike in March?
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <div className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center mt-0.5" style={{ backgroundColor: 'rgba(139,92,246,0.15)' }}>
                      <Sparkles className="w-3 h-3" style={{ color: '#8b5cf6' }} />
                    </div>
                    <div className="px-3 py-2 rounded-xl text-xs" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', maxWidth: '85%' }}>
                      Payroll jumped $8,200 due to 2 new hires. Software spend also rose 34% — mostly AWS.
                    </div>
                  </div>
                </div>
              ),
            },
            {
              icon: CreditCard,
              color: 'var(--positive)',
              colorBg: 'var(--positive-soft)',
              title: 'Bank sync via Plaid',
              desc: 'Connect accounts and reconcile automatically. No CSV exports.',
              mockup: (
                <div className="mt-4 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  {[
                    { name: 'Stripe payout', amt: '+$12,400', dot: 'var(--positive)' },
                    { name: 'AWS invoice', amt: '-$4,200', dot: 'var(--negative)' },
                    { name: 'Gusto payroll', amt: '-$28,400', dot: 'var(--neon-amber)' },
                  ].map(t => (
                    <div key={t.name} className="flex items-center justify-between px-3 py-2 border-b last:border-0" style={{ borderColor: 'var(--border-color)', fontSize: 12 }}>
                      <div className="flex items-center gap-2">
                        <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: t.dot }} />
                        <span style={{ color: 'var(--text-secondary)' }}>{t.name}</span>
                      </div>
                      <span className="font-medium num" style={{ color: t.amt.startsWith('+') ? 'var(--positive)' : 'var(--text-primary)' }}>{t.amt}</span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between px-3 py-2" style={{ backgroundColor: 'var(--bg-tertiary)', fontSize: 11 }}>
                    <span style={{ color: 'var(--text-muted)' }}>1 pending match</span>
                    <span style={{ color: 'var(--accent)', fontWeight: 500 }}>Review →</span>
                  </div>
                </div>
              ),
            },
            {
              icon: FileText,
              color: '#f59e0b',
              colorBg: 'rgba(245,158,11,0.08)',
              title: 'Invoices & bills',
              desc: 'Send invoices, pay bills, track AR/AP with double-entry precision.',
              mockup: (
                <div className="mt-4 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  {[
                    { name: 'Acme Corp', inv: 'INV-042', amt: '$8,500', badge: 'Sent', bc: 'badge-info' },
                    { name: 'Beta LLC', inv: 'INV-041', amt: '$3,200', badge: 'Paid', bc: 'badge-success' },
                    { name: 'Gamma Inc', inv: 'INV-040', amt: '$12,000', badge: 'Overdue', bc: 'badge-danger' },
                  ].map(r => (
                    <div key={r.inv} className="flex items-center justify-between px-3 py-2 border-b last:border-0" style={{ borderColor: 'var(--border-color)', fontSize: 12 }}>
                      <div>
                        <p style={{ color: 'var(--text-primary)', fontWeight: 500 }}>{r.name}</p>
                        <p style={{ color: 'var(--text-muted)', fontSize: 11 }}>{r.inv}</p>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="num" style={{ color: 'var(--text-primary)' }}>{r.amt}</span>
                        <span className={`badge ${r.bc}`}>{r.badge}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
            {
              icon: Shield,
              color: '#6366f1',
              colorBg: 'rgba(99,102,241,0.08)',
              title: 'Role-based access',
              desc: 'Owner, admin, accountant, viewer. Everyone gets exactly what they need.',
              mockup: (
                <div className="mt-4 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-color)' }}>
                  {[
                    { name: 'Aiden K.', role: 'Owner', bc: 'badge-info' },
                    { name: 'Sara R.', role: 'Accountant', bc: 'badge-success' },
                    { name: 'Jake M.', role: 'Viewer', bc: 'badge-neutral' },
                  ].map(u => (
                    <div key={u.name} className="flex items-center justify-between px-3 py-2 border-b last:border-0" style={{ borderColor: 'var(--border-color)', fontSize: 12 }}>
                      <div className="flex items-center gap-2">
                        <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-semibold text-white"
                          style={{ backgroundColor: 'var(--accent)' }}>{u.name[0]}</div>
                        <span style={{ color: 'var(--text-primary)' }}>{u.name}</span>
                      </div>
                      <span className={`badge ${u.bc}`}>{u.role}</span>
                    </div>
                  ))}
                </div>
              ),
            },
            {
              icon: TrendingUp,
              color: 'var(--neon-emerald)',
              colorBg: 'var(--positive-soft)',
              title: 'Market intelligence',
              desc: 'Benchmark against peers. Insights powered by Perplexity AI.',
              mockup: (
                <div className="mt-4 space-y-2">
                  {[
                    { label: 'Gross margin', you: 74, avg: 61 },
                    { label: 'Burn rate', you: 42, avg: 55 },
                    { label: 'AR days', you: 18, avg: 32 },
                  ].map(m => (
                    <div key={m.label}>
                      <div className="flex justify-between mb-1" style={{ fontSize: 11 }}>
                        <span style={{ color: 'var(--text-secondary)' }}>{m.label}</span>
                        <span style={{ color: 'var(--text-muted)' }}>You: {m.you}% · Avg: {m.avg}%</span>
                      </div>
                      <div className="h-1.5 rounded-full" style={{ backgroundColor: 'var(--bg-muted)' }}>
                        <div className="h-full rounded-full" style={{ width: `${m.you}%`, backgroundColor: 'var(--neon-emerald)' }} />
                      </div>
                    </div>
                  ))}
                </div>
              ),
            },
          ].map(feature => (
            <div key={feature.title} className="card p-5" style={{ borderRadius: 14 }}>
              <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3"
                style={{ backgroundColor: feature.colorBg }}>
                <feature.icon className="w-4 h-4" style={{ color: feature.color }} />
              </div>
              <h4 style={{ color: 'var(--text-primary)' }}>{feature.title}</h4>
              <p className="text-sm mt-1" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>{feature.desc}</p>
              {feature.mockup}
            </div>
          ))}
        </div>
      </section>

      {/* ── How it works ── */}
      <div className="border-y" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="max-w-6xl mx-auto px-6 py-20">
          <div className="text-center mb-14">
            <p className="section-label mb-2">How it works</p>
            <h2 style={{ color: 'var(--text-primary)' }}><strong>Up and running</strong> in under 10 minutes.</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                num: '01', title: 'Connect your accounts',
                desc: 'Link bank accounts via Plaid or upload a CSV. Chart of accounts ready in minutes.',
                mockup: (
                  <div className="mt-4 rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>Connect via Plaid</span>
                      <span className="badge badge-success" style={{ fontSize: 10 }}>Secure</span>
                    </div>
                    {['Chase Checking –4821', 'Mercury Business –3302'].map(a => (
                      <div key={a} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
                        <CheckCircle className="w-3 h-3" style={{ color: 'var(--positive)' }} />
                        {a}
                      </div>
                    ))}
                  </div>
                ),
              },
              {
                num: '02', title: 'Record transactions',
                desc: 'Invoices, bills, payments. Double-entry handled automatically in the background.',
                mockup: (
                  <div className="mt-4 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
                    <div className="px-3 py-1.5 border-b text-xs font-semibold" style={{ backgroundColor: 'var(--bg-tertiary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>Auto-generated journal</div>
                    <div className="grid grid-cols-3 px-3 py-1.5 border-b text-xs font-semibold" style={{ borderColor: 'var(--border-color)', color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      <span>Account</span><span className="text-right">Debit</span><span className="text-right">Credit</span>
                    </div>
                    {[['Accounts Receivable', '$8,500', '—'], ['Revenue', '—', '$8,500']].map(([acc, d, c]) => (
                      <div key={acc} className="grid grid-cols-3 px-3 py-1.5 border-b last:border-0 text-xs" style={{ borderColor: 'var(--border-color)', color: 'var(--text-secondary)' }}>
                        <span>{acc}</span><span className="text-right num">{d}</span><span className="text-right num">{c}</span>
                      </div>
                    ))}
                    <div className="px-3 py-1.5 text-xs flex items-center gap-1" style={{ color: 'var(--positive)' }}>
                      <CheckCircle className="w-3 h-3" /> Balanced
                    </div>
                  </div>
                ),
              },
              {
                num: '03', title: 'Get instant clarity',
                desc: 'Dashboard, reports, and AI copilot update in real time. Close the month in minutes.',
                mockup: (
                  <div className="mt-4 rounded-lg border p-3" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { label: 'Revenue', val: '$84,200', change: '+12%', pos: true },
                        { label: 'Net profit', val: '$42,400', change: '+12%', pos: true },
                        { label: 'AR outstanding', val: '$18,500', change: '+5%', pos: true },
                        { label: 'Cash on hand', val: '$128,900', change: '+12%', pos: true },
                      ].map(k => (
                        <div key={k.label} className="rounded-md p-2" style={{ backgroundColor: 'var(--bg-tertiary)' }}>
                          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{k.label}</p>
                          <p className="text-sm font-semibold num-display" style={{ color: 'var(--text-primary)' }}>{k.val}</p>
                          <p className="text-xs" style={{ color: 'var(--positive)' }}>↑ {k.change}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                ),
              },
            ].map(step => (
              <div key={step.num} className="card p-5">
                <p className="text-xs font-semibold mb-3" style={{ color: 'var(--accent)', letterSpacing: '0.04em' }}>{step.num}</p>
                <h4 style={{ color: 'var(--text-primary)' }}>{step.title}</h4>
                <p className="text-sm mt-1" style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>{step.desc}</p>
                {step.mockup}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* ── Double-entry / accuracy section ── */}
      <section className="max-w-6xl mx-auto px-6 py-20">
        <div className="grid md:grid-cols-2 gap-12 items-center">
          <div>
            <p className="section-label mb-3">Built for accuracy</p>
            <h2 style={{ color: 'var(--text-primary)' }}>Double-entry bookkeeping.<br /><span style={{ color: 'var(--text-secondary)', fontWeight: 400 }}>Done automatically.</span></h2>
            <p className="text-sm mt-4 mb-6" style={{ color: 'var(--text-secondary)', lineHeight: 1.65 }}>
              Every invoice, bill, and payment automatically creates balanced journal entries. Your chart of accounts stays clean. Your accountant stays happy.
            </p>
            <ul className="space-y-2.5">
              {[
                'Automatic journal entries on every transaction',
                'Real-time trial balance and financial statements',
                'Bank reconciliation with one-click matching',
                'Multi-user with role-based access control',
                'Period close with lock dates to prevent backdating',
              ].map(item => (
                <li key={item} className="flex items-center gap-2.5 text-sm" style={{ color: 'var(--text-secondary)' }}>
                  <CheckCircle className="w-4 h-4 flex-shrink-0" style={{ color: 'var(--positive)' }} />
                  {item}
                </li>
              ))}
            </ul>
            <button onClick={() => router.push('/signup')} className="btn btn-primary btn-lg mt-8">
              Start free trial <ArrowRight className="w-4 h-4" />
            </button>
          </div>

          {/* AI chat preview widget */}
          <div className="card p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Ask Fintra AI</span>
              </div>
              <span className="badge badge-success">Live</span>
            </div>

            <div className="space-y-3">
              <div className="flex justify-end">
                <div className="px-3 py-2 rounded-xl text-sm" style={{ backgroundColor: 'var(--accent)', color: 'white', maxWidth: '80%' }}>
                  What were my top 3 expenses last month?
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                  <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                </div>
                <div className="px-3 py-2 rounded-xl text-sm" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)', maxWidth: '85%' }}>
                  Your top 3 expenses in March were:<br />
                  1. Payroll — $28,400 (67% of expenses)<br />
                  2. AWS / Infrastructure — $4,200<br />
                  3. Software &amp; SaaS — $2,100
                </div>
              </div>
              <div className="flex justify-end">
                <div className="px-3 py-2 rounded-xl text-sm" style={{ backgroundColor: 'var(--accent)', color: 'white', maxWidth: '80%' }}>
                  Yes, show me the payroll breakdown
                </div>
              </div>
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full flex-shrink-0 flex items-center justify-center" style={{ backgroundColor: 'var(--accent-subtle)' }}>
                  <Sparkles className="w-3 h-3" style={{ color: 'var(--accent)' }} />
                </div>
                <div className="px-3 py-2 rounded-xl text-sm" style={{ backgroundColor: 'var(--bg-tertiary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                  <span className="flex gap-1 items-center"><span className="animate-pulse">···</span> Fintra is thinking...</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <input className="input input-sm flex-1" placeholder="Ask about your finances..." disabled />
              <button className="btn btn-primary btn-sm btn-icon"><ArrowRight className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <div className="border-t" style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)' }}>
        <div className="relative max-w-4xl mx-auto px-6 py-24 text-center overflow-hidden">
          <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2 h-64 w-64 rounded-full blur-[120px]"
            style={{ backgroundColor: 'var(--accent)', opacity: 0.12 }} />
          <p className="section-label mb-4">Ready to simplify your accounting?</p>
          <h2 className="font-bold mb-4" style={{ color: 'var(--text-primary)', fontSize: 'clamp(2rem, 4vw, 2.75rem)', letterSpacing: '-0.03em' }}>
            Start your free account today.
          </h2>
          <p className="text-sm mb-8 max-w-md mx-auto" style={{ color: 'var(--text-secondary)' }}>
            No spreadsheets. No confusing double-entry setup. No legacy software.<br />
            Just clear, accurate financials — powered by AI.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <button onClick={() => router.push('/signup')} className="btn btn-primary btn-xl">
              Get started free <ArrowRight className="w-4 h-4" />
            </button>
            <button onClick={() => router.push('/login')} className="btn btn-secondary btn-lg">
              Sign in
            </button>
          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <footer className="border-t" style={{ borderColor: 'var(--border-color)' }}>
        <div className="max-w-7xl mx-auto px-6 py-8">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ backgroundColor: 'var(--accent)' }}>
                <Building2 className="w-3.5 h-3.5 text-white" />
              </div>
              <span style={{ color: 'var(--text-secondary)', fontWeight: 500 }}>Fintra</span>
            </div>
            <div className="flex items-center gap-6">
              <span>&copy; 2026 Fintra</span>
              <a href="/privacy" style={{ color: 'var(--text-muted)' }}>Privacy</a>
              <a href="/terms" style={{ color: 'var(--text-muted)' }}>Terms</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
