'use client'

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import Link from 'next/link'
import { ArrowUpRight, ArrowDownRight, Loader2, AlertCircle, RefreshCw, Plus } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import { useCountUp } from '@/hooks/useCountUp'
import { useScrollReveal } from '@/hooks/useScrollReveal'
import { BankAccountsCard } from '@/components/dashboard/BankAccountsCard'
import { WidgetGrid } from '@/components/dashboard/WidgetGrid'
import { AddWidgetModal } from '@/components/dashboard/AddWidgetModal'
import { WIDGET_CATALOG } from '@/components/dashboard/widgets'

// ── Types ─────────────────────────────────────────────────────────

type Period = 'this_month' | 'last_month' | 'this_quarter' | 'ytd'

interface KpiPair { current: number; prior: number }
interface DashboardData {
  period: { start: string; end: string; label: string }
  prior_period: { start: string; end: string }
  kpis: {
    revenue: KpiPair
    expenses: KpiPair
    net_profit: KpiPair
    cash_balance: { current: number }
    ar_outstanding: number
    ap_outstanding: number
  }
  monthly_data: Array<{ month: string; label: string; short: string; revenue: number; expenses: number; net: number }>
  expense_categories: Array<{ account_name: string; amount: number; percentage: number }>
  aging: { current: number; days_1_30: number; days_31_60: number; days_61_90: number; days_90_plus: number }
  action_items: Array<{ type: string; count: number; amount: number; link: string }>
  recent_transactions: Array<{ id: string; date: string; entry_number: string; memo: string; amount: number; status: string }>
  widget_data: Record<string, any>
}

interface WidgetPref { widget_id: string; position: number; is_visible: boolean }

interface BankAccount { account_id: string; account_name: string; account_code: string; balance: number }

// ── Helpers ───────────────────────────────────────────────────────

const PERIODS: { key: Period; label: string }[] = [
  { key: 'this_month', label: 'This Month' },
  { key: 'last_month', label: 'Last Month' },
  { key: 'this_quarter', label: 'This Quarter' },
  { key: 'ytd', label: 'YTD' },
]

const DEFAULT_PREFS: WidgetPref[] = WIDGET_CATALOG
  .filter(w => w.defaultVisible)
  .map((w, i) => ({ widget_id: w.widget_id, position: i, is_visible: true }))

const fmt = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const $ = (n: number) => fmt.format(n)

const fmtDate = (d: string) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const pctChange = (curr: number, prior: number) => {
  if (prior === 0) return curr === 0 ? 0 : 100
  return ((curr - prior) / Math.abs(prior)) * 100
}

// ── Skeleton ──────────────────────────────────────────────────────

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded ${className}`} style={{ background: 'var(--border-color)' }} />
}

function KpiSkeleton() {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <Skeleton className="h-3 w-20" />
      <Skeleton className="h-7 w-32" />
      <Skeleton className="h-3 w-24" />
    </div>
  )
}

// ── KPI Card with count-up ─────────────────────────────────────────

function KpiCard({
  label, value, prior, favorable = true, suffix, children,
}: {
  label: string
  value: number
  prior?: number
  favorable?: boolean
  suffix?: string
  children?: React.ReactNode
  glowColor?: string
}) {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  const animated = useCountUp(value, 900, visible)
  const [hovered, setHovered] = useState(false)
  const change = prior !== undefined ? pctChange(value, prior) : null
  const isGood = change !== null ? (favorable ? change >= 0 : change <= 0) : null
  const ChangeIcon = change !== null ? (change >= 0 ? ArrowUpRight : ArrowDownRight) : null

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="flex flex-col gap-1.5 relative overflow-hidden"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-color)'}`,
        borderRadius: 10,
        padding: '16px 18px',
        transition: 'opacity 0.5s ease, transform 0.5s ease, border-color 0.15s ease, box-shadow 0.15s ease',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(12px)',
        boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-xs)',
      }}
    >
      <p
        className="font-semibold uppercase"
        style={{ color: 'var(--text-muted)', fontSize: 10.5, letterSpacing: '0.08em' }}
      >
        {label}
      </p>
      <p
        className="num-display"
        style={{
          color: 'var(--text-primary)',
          fontSize: 26,
          lineHeight: 1.15,
          fontWeight: 600,
        }}
      >
        {$(animated)}
        {suffix && (
          <span
            className="ml-1 font-normal"
            style={{ color: 'var(--text-muted)', fontSize: 13 }}
          >
            {suffix}
          </span>
        )}
      </p>
      {children}
      {change !== null && ChangeIcon && (
        <div className="flex items-center gap-1 mt-0.5">
          <ChangeIcon
            className="w-3.5 h-3.5"
            style={{ color: isGood ? 'var(--positive)' : 'var(--negative)' }}
          />
          <span
            className="text-xs font-medium num"
            style={{ color: isGood ? 'var(--positive)' : 'var(--negative)' }}
          >
            {Math.abs(change).toFixed(1)}%
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            vs prior period
          </span>
        </div>
      )}
    </div>
  )
}

// ── Main Dashboard ─────────────────────────────────────────────────

export default function NewDashboard() {
  const { company, loading: authLoading, refreshUser } = useAuth()
  const co = company as any
  const companyId = co?.id || null

  const [period, setPeriod] = useState<Period>('this_month')
  const [data, setData] = useState<DashboardData | null>(null)
  const [loading, setLoading] = useState(true)
  const [transitioning, setTransitioning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [retryCount, setRetryCount] = useState(0)

  const [bankAccounts, setBankAccounts] = useState<BankAccount[]>([])
  const [bankTotal, setBankTotal] = useState(0)
  const [bankLoading, setBankLoading] = useState(true)

  const [widgetPrefs, setWidgetPrefs] = useState<WidgetPref[]>(DEFAULT_PREFS)
  const [widgetModalOpen, setWidgetModalOpen] = useState(false)
  const [widgetSaving, setWidgetSaving] = useState(false)

  const activeWidgetIds = useMemo(
    () => widgetPrefs.filter(p => p.is_visible).map(p => p.widget_id),
    [widgetPrefs]
  )

  const fetchData = useCallback(async (isTransition = false) => {
    if (!companyId) return
    if (isTransition) {
      setTransitioning(true)
    } else {
      setLoading(true)
    }
    setError(null)
    try {
      const widgetsParam = activeWidgetIds.join(',')
      const result = await api.get(`/dashboard/summary?period=${period}&widgets=${widgetsParam}`)
      setData(result)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load dashboard')
    } finally {
      setLoading(false)
      setTransitioning(false)
    }
  }, [companyId, period, activeWidgetIds])

  const fetchBankAccounts = useCallback(async () => {
    if (!companyId) return
    setBankLoading(true)
    try {
      const result = await api.get('/dashboard/bank-accounts')
      setBankAccounts(result.accounts || [])
      setBankTotal(result.total_balance || 0)
    } catch {
      // silent fail
    } finally {
      setBankLoading(false)
    }
  }, [companyId])

  const fetchWidgetPrefs = useCallback(async () => {
    if (!companyId) return
    try {
      const result = await api.get('/dashboard/widgets')
      if (Array.isArray(result) && result.length > 0) {
        setWidgetPrefs(result)
      }
    } catch {
      // fall back to defaults
    }
  }, [companyId])

  useEffect(() => {
    if (authLoading) return
    if (!companyId && retryCount < 3) {
      refreshUser().then(() => setRetryCount(p => p + 1))
      return
    }
    if (companyId) {
      fetchWidgetPrefs()
      fetchBankAccounts()
    } else {
      setLoading(false)
    }
  }, [companyId, authLoading, retryCount])

  const prevPeriod = useRef(period)
  useEffect(() => {
    if (!companyId) return
    const isTransition = prevPeriod.current !== period && data !== null
    prevPeriod.current = period
    fetchData(isTransition)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyId, period, widgetPrefs])

  async function saveWidgetPrefs(prefs: WidgetPref[]) {
    setWidgetSaving(true)
    try {
      await api.put('/dashboard/widgets', { widgets: prefs })
      setWidgetPrefs(prefs)
      setWidgetModalOpen(false)
    } catch {
      // silent, still update local state
      setWidgetPrefs(prefs)
      setWidgetModalOpen(false)
    } finally {
      setWidgetSaving(false)
    }
  }

  // ── Guards ────────────────────────────────────────────────────

  if (!companyId && !authLoading && retryCount >= 3) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-4">
        <p style={{ color: 'var(--text-muted)' }}>No company found. Complete onboarding first.</p>
        <Link href="/onboarding" className="text-sm font-semibold px-4 py-2 rounded-lg" style={{ background: 'var(--accent)', color: '#fff' }}>Go to Onboarding</Link>
      </div>
    )
  }

  if (!companyId || (loading && !data)) {
    return (
      <div className="p-6 space-y-4" style={{ color: 'var(--text-primary)' }}>
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
          {[...Array(5)].map((_, i) => <KpiSkeleton key={i} />)}
        </div>
        <Skeleton className="h-40 w-full" />
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-56" />)}
        </div>
      </div>
    )
  }

  if (error && !data) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3">
        <AlertCircle className="w-8 h-8" style={{ color: 'var(--negative)' }} />
        <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        <button onClick={() => fetchData()} className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
          <RefreshCw className="w-4 h-4" /> Retry
        </button>
      </div>
    )
  }

  if (!data) return null

  const { kpis } = data

  // ── Render ─────────────────────────────────────────────────────

  return (
    <div className="p-6 space-y-4 min-h-screen" style={{ color: 'var(--text-primary)', opacity: transitioning ? 0.6 : 1, transition: 'opacity 0.2s ease' }}>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 mb-2">
        <div>
          <p
            className="font-semibold uppercase"
            style={{ color: 'var(--text-muted)', fontSize: 10.5, letterSpacing: '0.08em' }}
          >
            Overview
          </p>
          <h1
            className="mt-1"
            style={{
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: '-0.02em',
              color: 'var(--text-primary)',
            }}
          >
            Dashboard
          </h1>
          <p className="text-xs mt-0.5 num" style={{ color: 'var(--text-muted)' }}>
            {fmtDate(data.period.start)} — {fmtDate(data.period.end)}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <button
            onClick={() => setWidgetModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium rounded-md transition-colors"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              color: 'var(--text-secondary)',
              padding: '6px 10px',
              height: 30,
            }}
            onMouseEnter={e => {
              const el = e.currentTarget
              el.style.background = 'var(--bg-muted)'
              el.style.color = 'var(--text-primary)'
            }}
            onMouseLeave={e => {
              const el = e.currentTarget
              el.style.background = 'var(--bg-card)'
              el.style.color = 'var(--text-secondary)'
            }}
          >
            <Plus className="w-3.5 h-3.5" /> Add widget
          </button>
          {/* Segmented period control */}
          <div
            className="inline-flex items-center rounded-md"
            style={{
              background: 'var(--bg-muted)',
              border: '1px solid var(--border-color)',
              padding: 2,
              height: 30,
            }}
          >
            {PERIODS.map((p) => {
              const active = period === p.key
              return (
                <button
                  key={p.key}
                  onClick={() => setPeriod(p.key)}
                  className="text-xs font-medium transition-all rounded"
                  style={{
                    background: active ? 'var(--bg-card)' : 'transparent',
                    color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                    padding: '0 10px',
                    height: 24,
                    border: active ? '1px solid var(--border-color)' : '1px solid transparent',
                    boxShadow: active ? 'var(--shadow-xs)' : 'none',
                  }}
                >
                  {p.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── KPI Cards + Bank Accounts ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <div className="xl:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3">
          <KpiCard label="Revenue" value={kpis.revenue.current} prior={kpis.revenue.prior} favorable />
          <KpiCard label="Expenses" value={kpis.expenses.current} prior={kpis.expenses.prior} favorable={false} />
          <KpiCard label="Net Profit" value={kpis.net_profit.current} prior={kpis.net_profit.prior} favorable>
            {kpis.revenue.current > 0 && (
              <p className="text-xs num" style={{ color: 'var(--text-muted)' }}>
                {((kpis.net_profit.current / kpis.revenue.current) * 100).toFixed(1)}% margin
              </p>
            )}
          </KpiCard>
          <KpiCard label="Cash Balance" value={kpis.cash_balance.current} />
          <div
            className="col-span-2 md:col-span-1 flex flex-col gap-1.5"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-color)',
              borderRadius: 10,
              padding: '16px 18px',
              boxShadow: 'var(--shadow-xs)',
            }}
          >
            <p
              className="font-semibold uppercase"
              style={{ color: 'var(--text-muted)', fontSize: 10.5, letterSpacing: '0.08em' }}
            >
              Receivables / Payables
            </p>
            <div className="space-y-1.5 mt-1">
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-muted)' }}>AR</span>
                <span className="font-semibold num" style={{ color: 'var(--text-primary)' }}>{$(kpis.ar_outstanding)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span style={{ color: 'var(--text-muted)' }}>AP</span>
                <span className="font-semibold num" style={{ color: 'var(--text-primary)' }}>{$(kpis.ap_outstanding)}</span>
              </div>
              <div className="flex justify-between text-sm pt-2 mt-1" style={{ borderTop: '1px solid var(--border-color)' }}>
                <span className="font-medium" style={{ color: 'var(--text-secondary)' }}>Net</span>
                <span
                  className="font-semibold num"
                  style={{ color: kpis.ar_outstanding - kpis.ap_outstanding >= 0 ? 'var(--positive)' : 'var(--negative)' }}
                >
                  {$(kpis.ar_outstanding - kpis.ap_outstanding)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <BankAccountsCard accounts={bankAccounts} totalBalance={bankTotal} loading={bankLoading} />
      </div>

      {/* ── Widget Grid ── */}
      <WidgetGrid prefs={widgetPrefs} dashboardData={data} companyId={companyId} />

      {/* ── Add Widget Modal ── */}
      <AddWidgetModal
        open={widgetModalOpen}
        currentPrefs={widgetPrefs}
        onClose={() => setWidgetModalOpen(false)}
        onSave={saveWidgetPrefs}
        saving={widgetSaving}
      />
    </div>
  )
}
