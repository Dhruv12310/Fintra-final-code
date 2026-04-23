'use client'
import PageHeader from '@/components/PageHeader'

import { useState, useEffect, useCallback } from 'react'
import {
  CalendarCheck, Loader2, CheckCircle, XCircle, AlertCircle,
  Clock, Lock, BookOpen, Plus, Trash2, ChevronDown, ChevronRight,
  RefreshCw, Landmark, TrendingUp, Package,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

const $ = (n: number) => n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
function monthLabel(y: number, m: number) { return `${MONTHS[m - 1]} ${y}` }

// ── Step Card ──────────────────────────────────────────────────────

function StepCard({ num, title, description, status, detail, data, children }: {
  num: number; title: string; description: string
  status: 'pass' | 'fail' | 'warn' | 'pending' | 'info' | 'skip'
  detail?: string; data?: any; children?: React.ReactNode
}) {
  const [expanded, setExpanded] = useState(status === 'fail' || status === 'warn')
  const colors = {
    pass:    { border: 'var(--neon-emerald)', icon: <CheckCircle className="w-4 h-4" style={{ color: 'var(--neon-emerald)' }} /> },
    fail:    { border: '#ef4444',             icon: <XCircle className="w-4 h-4" style={{ color: '#ef4444' }} /> },
    warn:    { border: '#f59e0b',             icon: <AlertCircle className="w-4 h-4" style={{ color: '#f59e0b' }} /> },
    pending: { border: 'var(--border-color)', icon: <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> },
    info:    { border: 'var(--accent)',    icon: <CheckCircle className="w-4 h-4" style={{ color: 'var(--accent)' }} /> },
    skip:    { border: 'var(--border-color)', icon: <Clock className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /> },
  }
  const c = colors[status] || colors.pending

  return (
    <div className="panel overflow-hidden" style={{ border: '1px solid var(--border-color)', borderLeft: `4px solid ${c.border}`, backgroundColor: 'var(--bg-card)' }}>
      <div
        className="flex items-center gap-3 px-5 py-4 cursor-pointer select-none"
        onClick={() => setExpanded(e => !e)}
      >
        <div className="flex h-8 w-8 items-center justify-center rounded-xl shrink-0"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
          <span className="text-xs font-bold" style={{ color: 'var(--text-muted)' }}>{num}</span>
        </div>
        {c.icon}
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-secondary)' }}>{detail || description}</p>
        </div>
        {expanded ? <ChevronDown className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />
                  : <ChevronRight className="w-4 h-4 shrink-0" style={{ color: 'var(--text-muted)' }} />}
      </div>
      {expanded && children && (
        <div className="px-5 pb-4 pt-0 space-y-2" style={{ borderTop: '1px solid var(--border-color)' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// ── Fixed Asset Row ────────────────────────────────────────────────

function AssetRow({ asset, onDelete }: { asset: any; onDelete: (id: string) => void }) {
  const bookValue = asset.cost - asset.accumulated_depreciation
  const pctDepreciated = asset.cost > 0 ? (asset.accumulated_depreciation / asset.cost) * 100 : 0
  return (
    <div className="flex items-center gap-4 px-4 py-3 text-sm" style={{ borderBottom: '1px solid var(--border-color)' }}>
      <div className="flex-1 min-w-0">
        <p className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>{asset.name}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          {asset.depreciation_method?.replace('_', ' ')} · {asset.useful_life_months}mo · purchased {asset.purchase_date}
        </p>
      </div>
      <div className="text-right shrink-0">
        <p className="font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>${$(bookValue)}</p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{pctDepreciated.toFixed(0)}% depreciated</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          ${$(asset.monthly_depreciation ?? (asset.cost - (asset.salvage_value || 0)) / asset.useful_life_months)}/mo
        </p>
      </div>
      <button onClick={() => onDelete(asset.id)} className="p-1.5 rounded-lg hover:opacity-70 transition-opacity shrink-0" style={{ color: '#f87171' }}>
        <Trash2 className="w-3.5 h-3.5" />
      </button>
    </div>
  )
}

// ── Main Page ──────────────────────────────────────────────────────

export default function MonthEndPage() {
  const { company, loading: authLoading } = useAuth()
  const co = company as any
  const companyId = co?.id || null

  const now = new Date()
  const [selYear, setSelYear] = useState(now.getFullYear())
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1)

  // Checklist state
  const [checklist, setChecklist] = useState<any>(null)
  const [runResult, setRunResult] = useState<any>(null)
  const [loadingCheck, setLoadingCheck] = useState(false)
  const [running, setRunning] = useState(false)
  const [closedPeriods, setClosedPeriods] = useState<any[]>([])

  // Fixed assets state
  const [assets, setAssets] = useState<any[]>([])
  const [loadingAssets, setLoadingAssets] = useState(false)
  const [showAddAsset, setShowAddAsset] = useState(false)
  const [newAsset, setNewAsset] = useState({
    name: '', cost: '', useful_life_months: '60', salvage_value: '0',
    depreciation_method: 'straight_line', purchase_date: new Date().toISOString().split('T')[0], description: '',
  })
  const [savingAsset, setSavingAsset] = useState(false)

  // AR/AP aging
  const [arAging, setArAging] = useState<any>(null)
  const [apAging, setApAging] = useState<any>(null)

  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)

  function showToast(ok: boolean, msg: string) {
    setToast({ ok, msg })
    setTimeout(() => setToast(null), 5000)
  }

  // Derived
  const periodStart = `${selYear}-${String(selMonth).padStart(2, '0')}-01`
  const periodEnd = new Date(selYear, selMonth, 0).toISOString().split('T')[0]
  const isClosed = closedPeriods.some(p => p.period_start?.startsWith(`${selYear}-${String(selMonth).padStart(2, '0')}`))

  // Load closed periods
  useEffect(() => {
    if (!companyId) return
    api.get('/accounting-periods/').catch(() => []).then((data: any) =>
      setClosedPeriods(Array.isArray(data) ? data.filter((p: any) => p.is_closed) : [])
    )
  }, [companyId])

  // Load fixed assets
  const loadAssets = useCallback(async () => {
    if (!companyId) return
    setLoadingAssets(true)
    try {
      const res = await api.get('/fixed-assets')
      setAssets(Array.isArray(res) ? res : [])
    } catch { setAssets([]) }
    finally { setLoadingAssets(false) }
  }, [companyId])

  // Load AR/AP aging
  const loadAging = useCallback(async () => {
    if (!companyId) return
    try {
      const [ar, ap] = await Promise.all([
        api.get('/reports/ar-aging').catch(() => null),
        api.get('/reports/ap-aging').catch(() => null),
      ])
      setArAging(ar)
      setApAging(ap)
    } catch { /* ignore */ }
  }, [companyId])

  // Pre-flight checklist (lightweight, no server run)
  const runChecklist = useCallback(async () => {
    if (!companyId) return
    setLoadingCheck(true)
    setChecklist(null)
    try {
      const [invoices, bills, journals, accounts] = await Promise.all([
        api.get('/invoices/').catch(() => []),
        api.get('/bills/').catch(() => []),
        api.get('/journals/').catch(() => []),
        api.get(`/accounts/company/${companyId}`).catch(() => []),
      ])
      const invArr = Array.isArray(invoices) ? invoices : []
      const billArr = Array.isArray(bills) ? bills : []
      const jeArr = Array.isArray(journals) ? journals : []
      const acctArr = Array.isArray(accounts) ? accounts : []

      const inPeriod = (d: string) => d >= periodStart && d <= periodEnd
      const draftInvoices = invArr.filter((i: any) => i.status === 'draft' && inPeriod(i.invoice_date || ''))
      const draftBills = billArr.filter((b: any) => b.status === 'draft' && inPeriod(b.bill_date || ''))
      const draftJournals = jeArr.filter((j: any) => j.status === 'draft' && inPeriod(j.entry_date || ''))
      const totalDebit = acctArr.filter((a: any) => ['asset','expense'].includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.current_balance || 0), 0)
      const totalCredit = acctArr.filter((a: any) => ['liability','equity','revenue'].includes(a.account_type)).reduce((s: number, a: any) => s + Number(a.current_balance || 0), 0)
      const isBalanced = Math.abs(totalDebit - totalCredit) < 0.01

      setChecklist({ draftInvoices, draftBills, draftJournals, isBalanced, totalDebit, totalCredit })
    } catch { setChecklist({ error: true }) }
    finally { setLoadingCheck(false) }
  }, [companyId, periodStart, periodEnd])

  useEffect(() => {
    if (!companyId) return
    runChecklist()
    loadAssets()
    loadAging()
  }, [companyId, selYear, selMonth])

  // Run full close via backend engine
  const handleRunClose = async (lock: boolean) => {
    if (!companyId) return
    setRunning(true)
    setRunResult(null)
    try {
      const res = await api.post('/month-end/close', { period_start: periodStart, period_end: periodEnd, lock })
      setRunResult(res)
      if (res.period_locked) {
        setClosedPeriods(p => [...p, { period_start: periodStart, period_end: periodEnd, is_closed: true }])
        showToast(true, `${monthLabel(selYear, selMonth)} closed successfully.`)
      } else if (res.overall_status === 'failed') {
        showToast(false, `Close failed: ${res.blocking_failures} blocking issue(s). Review steps below.`)
      } else {
        showToast(true, `Checklist complete. ${res.overall_status?.replace(/_/g, ' ')}.`)
      }
    } catch (e: any) {
      showToast(false, e?.response?.data?.detail || 'Close failed')
    } finally { setRunning(false) }
  }

  // Add fixed asset
  const handleAddAsset = async () => {
    if (!newAsset.name || !newAsset.cost) return
    setSavingAsset(true)
    try {
      await api.post('/fixed-assets', {
        name: newAsset.name,
        cost: parseFloat(newAsset.cost),
        purchase_date: newAsset.purchase_date,
        useful_life_months: parseInt(newAsset.useful_life_months),
        salvage_value: parseFloat(newAsset.salvage_value || '0'),
        depreciation_method: newAsset.depreciation_method,
        description: newAsset.description,
      })
      await loadAssets()
      setShowAddAsset(false)
      setNewAsset({ name: '', cost: '', useful_life_months: '60', salvage_value: '0', depreciation_method: 'straight_line', purchase_date: new Date().toISOString().split('T')[0], description: '' })
      showToast(true, 'Fixed asset added.')
    } catch (e: any) {
      showToast(false, e?.response?.data?.detail || 'Failed to add asset')
    } finally { setSavingAsset(false) }
  }

  const handleDeleteAsset = async (id: string) => {
    if (!confirm('Dispose this asset? This will deactivate it from the depreciation schedule.')) return
    try {
      await api.patch(`/fixed-assets/${id}`, { is_active: false })
      setAssets(a => a.filter(x => x.id !== id))
      showToast(true, 'Asset disposed.')
    } catch { showToast(false, 'Failed to dispose asset') }
  }

  if (!companyId && !authLoading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
      <CalendarCheck className="h-16 w-16 mb-4" style={{ color: 'var(--text-muted)' }} />
      <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>No company set up</h2>
      <a href="/onboarding" className="btn btn-primary mt-4"
       >
        Complete onboarding
      </a>
    </div>
  )

  const canClose = checklist && !checklist.error && checklist.isBalanced && checklist.draftJournals?.length === 0

  return (
    <div className="min-h-screen p-6 space-y-6">

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-3 rounded-lg text-sm font-medium max-w-sm shadow-lg" style={{
          backgroundColor: toast.ok ? 'rgba(52,211,153,0.12)' : 'rgba(239,68,68,0.12)',
          border: `1px solid ${toast.ok ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: toast.ok ? 'var(--success)' : 'var(--neon-red)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Header */}
      <PageHeader
        eyebrow="Accounting"
        title="Month-end Close"
        subtitle="6-step guided close — depreciation, accruals, period lock"
        actions={<>
          <select value={selYear} onChange={e => setSelYear(Number(e.target.value))} className="select text-sm">
            {[now.getFullYear() - 1, now.getFullYear()].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={selMonth} onChange={e => setSelMonth(Number(e.target.value))} className="select text-sm">
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <button onClick={runChecklist} className="btn btn-secondary btn-sm">
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </>}
      />

      {/* Closed banner */}
      {isClosed && (
        <div className="flex items-center gap-3 px-5 py-3 rounded-lg"
          style={{ backgroundColor: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.25)' }}>
          <Lock className="w-5 h-5" style={{ color: 'var(--neon-emerald)' }} />
          <p className="text-sm font-semibold" style={{ color: 'var(--neon-emerald)' }}>
            {monthLabel(selYear, selMonth)} is closed and locked. No entries can be posted to this period.
          </p>
        </div>
      )}

      {/* Module locks + retained earnings rollover */}
      <PeriodLocksSection
        companyId={companyId}
        year={selYear}
        month={selMonth}
        onToast={(ok, msg) => showToast(ok, msg)}
      />

      {/* 3-column summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* AR summary */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="w-4 h-4" style={{ color: 'var(--neon-emerald)' }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>AR Outstanding</p>
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            ${$(arAging?.total_outstanding || 0)}
          </p>
          {arAging?.buckets && (
            <p className="text-xs mt-1" style={{ color: '#f59e0b' }}>
              ${$(arAging.buckets.over_90?.total + arAging.buckets['61_90']?.total + arAging.buckets['31_60']?.total || 0)} overdue 30+ days
            </p>
          )}
        </div>
        {/* AP summary */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Landmark className="w-4 h-4" style={{ color: '#f87171' }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>AP Outstanding</p>
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>
            ${$(apAging?.total_outstanding || 0)}
          </p>
          {apAging?.buckets && (
            <p className="text-xs mt-1" style={{ color: '#f59e0b' }}>
              ${$(apAging.buckets.over_90?.total + apAging.buckets['61_90']?.total + apAging.buckets['31_60']?.total || 0)} overdue 30+ days
            </p>
          )}
        </div>
        {/* Fixed assets */}
        <div className="card p-4">
          <div className="flex items-center gap-2 mb-3">
            <Package className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Fixed Assets</p>
          </div>
          <p className="text-2xl font-bold tabular-nums" style={{ color: 'var(--text-primary)' }}>{assets.length}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
            ${$(assets.reduce((s, a) => s + (a.cost - a.accumulated_depreciation), 0))} book value
          </p>
        </div>
      </div>

      {/* Pre-flight checklist */}
      {loadingCheck ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--accent)' }} /></div>
      ) : checklist && !checklist.error ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Pre-flight Checks</h2>
          <StepCard num={1} title="Draft Transactions" description="All transactions should be posted before closing."
            status={(checklist.draftInvoices?.length === 0 && checklist.draftBills?.length === 0 && checklist.draftJournals?.length === 0) ? 'pass' : 'fail'}
            detail={checklist.draftInvoices?.length === 0 && checklist.draftBills?.length === 0 && checklist.draftJournals?.length === 0
              ? 'All transactions are posted.' : `${(checklist.draftInvoices?.length || 0) + (checklist.draftBills?.length || 0) + (checklist.draftJournals?.length || 0)} draft items need attention.`}>
            <div className="space-y-2 pt-3">
              {checklist.draftInvoices?.length > 0 && (
                <div className="flex justify-between text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.06)' }}>
                  <span style={{ color: '#f87171' }}>{checklist.draftInvoices.length} draft invoice(s)</span>
                  <a href="/invoices" className="font-semibold" style={{ color: 'var(--accent)' }}>Review →</a>
                </div>
              )}
              {checklist.draftBills?.length > 0 && (
                <div className="flex justify-between text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.06)' }}>
                  <span style={{ color: '#f87171' }}>{checklist.draftBills.length} draft bill(s)</span>
                  <a href="/bills" className="font-semibold" style={{ color: 'var(--accent)' }}>Review →</a>
                </div>
              )}
              {checklist.draftJournals?.length > 0 && (
                <div className="flex justify-between text-xs px-3 py-2 rounded-lg" style={{ background: 'rgba(239,68,68,0.06)' }}>
                  <span style={{ color: '#f87171' }}>{checklist.draftJournals.length} draft journal entr{checklist.draftJournals.length === 1 ? 'y' : 'ies'}</span>
                  <a href="/new-journals" className="font-semibold" style={{ color: 'var(--accent)' }}>Review →</a>
                </div>
              )}
              {checklist.draftInvoices?.length === 0 && checklist.draftBills?.length === 0 && checklist.draftJournals?.length === 0 && (
                <p className="text-xs" style={{ color: 'var(--neon-emerald)' }}>No draft items — all clear.</p>
              )}
            </div>
          </StepCard>

          <StepCard num={2} title="Trial Balance" description="Debits must equal credits across all accounts."
            status={checklist.isBalanced ? 'pass' : 'fail'}
            detail={checklist.isBalanced ? 'Balanced ✓' : `Out of balance by $${$(Math.abs(checklist.totalDebit - checklist.totalCredit))}`}>
            <div className="space-y-2 pt-3">
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>Total Debits</span>
                <span className="font-medium tabular-nums">${$(checklist.totalDebit)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span style={{ color: 'var(--text-secondary)' }}>Total Credits</span>
                <span className="font-medium tabular-nums">${$(checklist.totalCredit)}</span>
              </div>
              <div className="flex justify-between text-xs font-bold pt-1" style={{ borderTop: '1px solid var(--border-color)' }}>
                <span style={{ color: 'var(--text-muted)' }}>Difference</span>
                <span style={{ color: checklist.isBalanced ? 'var(--neon-emerald)' : '#ef4444' }}>
                  ${$(Math.abs(checklist.totalDebit - checklist.totalCredit))}
                </span>
              </div>
            </div>
          </StepCard>

          <StepCard num={3} title="AR Aging" description="Outstanding customer balances." status="info"
            detail={arAging ? `$${$(arAging.total_outstanding)} outstanding across all customers` : 'Loading…'}>
            {arAging?.buckets && (
              <div className="space-y-2 pt-3">
                {Object.entries({
                  'Current': arAging.buckets.current,
                  '1–30 days': arAging.buckets['1_30_days'],
                  '31–60 days': arAging.buckets['31_60_days'],
                  '61–90 days': arAging.buckets['61_90_days'],
                  '90+ days': arAging.buckets.over_90_days,
                } as any).map(([label, bucket]: [string, any]) => bucket?.count > 0 && (
                  <div key={label} className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{label} ({bucket.count})</span>
                    <span className="font-medium tabular-nums" style={{ color: label.includes('90') || label.includes('61') ? '#f59e0b' : 'var(--text-primary)' }}>
                      ${$(bucket.total)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </StepCard>

          <StepCard num={4} title="AP Aging" description="Outstanding vendor balances." status="info"
            detail={apAging ? `$${$(apAging.total_outstanding)} outstanding` : 'Loading…'}>
            {apAging?.buckets && (
              <div className="space-y-2 pt-3">
                {Object.entries({
                  'Current': apAging.buckets.current,
                  '1–30 days': apAging.buckets['1_30_days'],
                  '31–60 days': apAging.buckets['31_60_days'],
                  '61–90 days': apAging.buckets['61_90_days'],
                  '90+ days': apAging.buckets.over_90_days,
                } as any).map(([label, bucket]: [string, any]) => bucket?.count > 0 && (
                  <div key={label} className="flex justify-between text-xs">
                    <span style={{ color: 'var(--text-secondary)' }}>{label} ({bucket.count})</span>
                    <span className="font-medium tabular-nums" style={{ color: 'var(--text-primary)' }}>${$(bucket.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </StepCard>
        </div>
      ) : null}

      {/* Backend close result */}
      {runResult && (
        <div className="panel overflow-hidden" style={{ border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
          <div className="px-5 py-4" style={{ background: runResult.overall_status === 'failed' ? 'rgba(239,68,68,0.06)' : 'rgba(52,211,153,0.06)', borderBottom: '1px solid var(--border-color)' }}>
            <p className="text-sm font-semibold" style={{ color: runResult.overall_status === 'failed' ? '#ef4444' : 'var(--neon-emerald)' }}>
              Close result: {runResult.overall_status?.replace(/_/g, ' ').replace(/\b\w/g, (l: string) => l.toUpperCase())}
              {runResult.net_income != null && ` — Net income: $${$(runResult.net_income)}`}
            </p>
          </div>
          <div className="px-5 py-4 space-y-2">
            {(runResult.steps || []).map((s: any, i: number) => {
              const icon = { pass: '✓', fail: '✗', warn: '!', skip: '—', info: 'i' }[s.status as string] || '?'
              const color = { pass: 'var(--neon-emerald)', fail: '#ef4444', warn: '#f59e0b', skip: 'var(--text-muted)', info: 'var(--accent)' }[s.status as string] || 'var(--text-muted)'
              return (
                <div key={i} className="flex items-start gap-3 text-sm">
                  <span className="font-bold w-4 shrink-0" style={{ color }}>{icon}</span>
                  <div>
                    <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{s.title}</span>
                    <span className="ml-2" style={{ color: 'var(--text-secondary)' }}>{s.detail}</span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Fixed Assets */}
      <div className="panel overflow-hidden" style={{ border: '1px solid var(--border-color)', backgroundColor: 'var(--bg-card)' }}>
        <div className="flex items-center justify-between px-5 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-2">
            <Package className="w-4 h-4" style={{ color: 'var(--text-secondary)' }} />
            <p className="text-sm font-semibold">Fixed Assets</p>
            <span className="text-xs px-2 py-0.5 rounded-full" style={{ background: 'var(--accent-subtle)', color: 'var(--text-secondary)' }}>{assets.length}</span>
          </div>
          <button
            onClick={() => setShowAddAsset(s => !s)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all"
            style={{ background: 'var(--accent-subtle)', color: 'var(--text-secondary)', border: '1px solid var(--accent)' }}
          >
            <Plus className="w-3.5 h-3.5" /> Add Asset
          </button>
        </div>

        {/* Add asset form */}
        {showAddAsset && (
          <div className="px-5 py-4 space-y-3" style={{ borderBottom: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Asset Name *</label>
                <input value={newAsset.name} onChange={e => setNewAsset(a => ({ ...a, name: e.target.value }))}
                  placeholder="e.g. MacBook Pro"
                  className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Cost ($) *</label>
                <input type="number" value={newAsset.cost} onChange={e => setNewAsset(a => ({ ...a, cost: e.target.value }))}
                  placeholder="5000"
                  className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Purchase Date</label>
                <input type="date" value={newAsset.purchase_date} onChange={e => setNewAsset(a => ({ ...a, purchase_date: e.target.value }))}
                  className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Useful Life (months)</label>
                <input type="number" value={newAsset.useful_life_months} onChange={e => setNewAsset(a => ({ ...a, useful_life_months: e.target.value }))}
                  className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Salvage Value ($)</label>
                <input type="number" value={newAsset.salvage_value} onChange={e => setNewAsset(a => ({ ...a, salvage_value: e.target.value }))}
                  className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }} />
              </div>
              <div>
                <label className="text-xs font-medium mb-1 block" style={{ color: 'var(--text-secondary)' }}>Method</label>
                <select value={newAsset.depreciation_method} onChange={e => setNewAsset(a => ({ ...a, depreciation_method: e.target.value }))}
                  className="w-full text-sm px-3 py-2 rounded-lg outline-none"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                  <option value="straight_line">Straight-line</option>
                  <option value="declining_balance">Double-declining Balance</option>
                </select>
              </div>
            </div>
            {newAsset.cost && newAsset.useful_life_months && (
              <p className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Monthly depreciation: ${$((parseFloat(newAsset.cost || '0') - parseFloat(newAsset.salvage_value || '0')) / parseInt(newAsset.useful_life_months || '1'))}
              </p>
            )}
            <div className="flex gap-2">
              <button onClick={handleAddAsset} disabled={savingAsset || !newAsset.name || !newAsset.cost}
                className="px-4 py-2 text-xs font-semibold rounded-lg disabled:opacity-50"
                style={{ background: 'var(--accent)', color: '#fff' }}>
                {savingAsset ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Save Asset'}
              </button>
              <button onClick={() => setShowAddAsset(false)} className="px-4 py-2 text-xs rounded-lg"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {loadingAssets ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} /></div>
        ) : assets.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No fixed assets. Add one to enable automatic depreciation entries.</p>
          </div>
        ) : (
          assets.map(a => <AssetRow key={a.id} asset={a} onDelete={handleDeleteAsset} />)
        )}
      </div>

      {/* Close actions */}
      {!isClosed && (
        <div className="card p-6">
          <h3 className="text-base font-bold mb-1">Close {monthLabel(selYear, selMonth)}</h3>
          <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>
            Running the close will: process recurring accruals, generate depreciation entries for all fixed assets, snapshot P&L, and lock the period.
            {!canClose && ' Fix the failing pre-flight checks above first.'}
          </p>
          <div className="flex gap-3 flex-wrap">
            <button
              onClick={() => handleRunClose(true)}
              disabled={!canClose || running}
              className="btn btn-primary flex items-center gap-2 disabled:opacity-40">
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Lock className="w-4 h-4" />}
              {running ? 'Running…' : `Close & Lock ${monthLabel(selYear, selMonth)}`}
            </button>
            <button
              onClick={() => handleRunClose(false)}
              disabled={running}
              className="btn btn-secondary flex items-center gap-2 disabled:opacity-40">
              <RefreshCw className="w-4 h-4" /> Dry Run (no lock)
            </button>
          </div>
        </div>
      )}

      {/* Closed periods history */}
      {closedPeriods.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-bold mb-3">Closed Periods</h3>
          <div className="space-y-2">
            {closedPeriods.map((p, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span style={{ color: 'var(--text-secondary)' }}>{p.period_start} – {p.period_end}</span>
                <span className="flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--neon-emerald)' }}>
                  <Lock className="w-3.5 h-3.5" /> Locked
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}


// ─── Period locks + retained-earnings rollover ────────────────────────────

function PeriodLocksSection({
  companyId, year, month, onToast,
}: {
  companyId: string | null
  year: number
  month: number
  onToast: (ok: boolean, msg: string) => void
}) {
  const [periods, setPeriods] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)

  const periodStart = `${year}-${String(month).padStart(2, '0')}-01`
  const period = periods.find(p => p.period_start === periodStart) || null

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const r = await api.get('/accounting-periods/')
      setPeriods(Array.isArray(r) ? r : [])
    } catch { /* ignore */ } finally { setLoading(false) }
  }, [companyId])

  useEffect(() => { load() }, [load, year, month])

  async function ensurePeriod(): Promise<string | null> {
    if (period?.id) return period.id
    try {
      const periodEnd = new Date(year, month, 0).toISOString().split('T')[0]
      const r = await api.post('/accounting-periods/', {
        period_start: periodStart, period_end: periodEnd,
      })
      const newId = r?.data?.id || r?.id || null
      await load()
      return newId
    } catch (e: any) {
      onToast(false, e?.response?.data?.detail || 'Failed to create period')
      return null
    }
  }

  async function toggleLock(field: 'sales' | 'purchases' | 'financial', value: boolean) {
    setBusy(true)
    try {
      const id = await ensurePeriod()
      if (!id) return
      await api.patch(`/accounting-periods/${id}/lock`, { [field]: value })
      onToast(true, `${field} ${value ? 'locked' : 'unlocked'} for ${MONTHS[month - 1]} ${year}`)
      await load()
    } catch (e: any) {
      onToast(false, e?.response?.data?.detail || 'Failed to update lock')
    } finally { setBusy(false) }
  }

  async function closeFiscalYear() {
    if (!confirm(`Close fiscal year through ${MONTHS[month - 1]} ${year}? This posts a closing entry to retained earnings and locks all modules for the period.`)) return
    setBusy(true)
    try {
      const id = await ensurePeriod()
      if (!id) return
      const r = await api.post(`/accounting-periods/${id}/close-fiscal-year`)
      onToast(true, `Closed. Net income posted to retained earnings: $${Number(r?.net_income || 0).toFixed(2)}`)
      await load()
    } catch (e: any) {
      onToast(false, e?.response?.data?.detail || 'Failed to close fiscal year')
    } finally { setBusy(false) }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
          <Lock className="w-4 h-4" /> Period Locks &amp; Year-end
        </h2>
        {period?.retained_earnings_entry_id && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase"
            style={{ background: 'var(--positive-soft)', color: 'var(--positive)', letterSpacing: '0.05em' }}>
            Year closed
          </span>
        )}
      </div>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Lock individual modules to prevent new posted journals dated inside this period. Closing the fiscal
        year aggregates revenue and expense activity into retained earnings.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {(['sales', 'purchases', 'financial'] as const).map(field => {
          const locked = !!period?.[`${field}_locked`]
          return (
            <div key={field} className="flex items-center justify-between px-3 py-2 rounded-lg"
              style={{ background: 'var(--bg-muted)', border: '1px solid var(--border-color)' }}>
              <span className="text-sm capitalize" style={{ color: 'var(--text-primary)' }}>{field}</span>
              <button
                disabled={busy || loading}
                onClick={() => toggleLock(field, !locked)}
                className="text-xs px-2 py-1 rounded inline-flex items-center gap-1"
                style={{
                  background: locked ? 'var(--negative-soft)' : 'var(--positive-soft)',
                  color: locked ? 'var(--negative)' : 'var(--positive)',
                  border: '1px solid var(--border-color)',
                }}>
                {locked ? 'Locked' : 'Open'}
              </button>
            </div>
          )
        })}
      </div>

      <div className="flex justify-end pt-2">
        <button
          onClick={closeFiscalYear}
          disabled={busy || !!period?.retained_earnings_entry_id}
          className="text-sm font-medium px-4 py-2 rounded-lg"
          style={{
            background: period?.retained_earnings_entry_id ? 'var(--bg-muted)' : 'var(--accent)',
            color: period?.retained_earnings_entry_id ? 'var(--text-muted)' : '#fff',
            border: '1px solid var(--border-color)',
            opacity: busy ? 0.5 : 1,
          }}>
          {period?.retained_earnings_entry_id ? 'Year already closed' : 'Close fiscal year through this period'}
        </button>
      </div>
    </div>
  )
}
