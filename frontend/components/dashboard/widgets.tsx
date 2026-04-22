'use client'
import Link from 'next/link'
import { ArrowUpRight, RefreshCw, Loader2 } from 'lucide-react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, AreaChart, Area, ReferenceLine,
  PieChart, Pie, Cell, BarChart,
} from 'recharts'
import { getChartColors } from '@/lib/chartColors'

// ── Types ──────────────────────────────────────────────────────────

export interface WidgetCatalogEntry {
  widget_id: string
  name: string
  description: string
  chartType: string
  defaultVisible: boolean
  icon: string
}

export const WIDGET_CATALOG: WidgetCatalogEntry[] = [
  { widget_id: 'revenue_vs_expenses', name: 'Revenue vs Expenses', description: 'Monthly revenue and expenses bar chart for last 12 months', chartType: 'Grouped Bar', defaultVisible: true, icon: '📊' },
  { widget_id: 'profit_margin_trend', name: 'Profit Margin Trend', description: 'Net profit margin % trend over 12 months', chartType: 'Area Line', defaultVisible: true, icon: '📈' },
  { widget_id: 'top_expense_categories', name: 'Top Expense Categories', description: 'Ranked horizontal bars of your top expenses this period', chartType: 'Horizontal Bar', defaultVisible: true, icon: '💸' },
  { widget_id: 'receivables_aging', name: 'Receivables Aging', description: 'Outstanding AR broken down by aging buckets', chartType: 'Progress Bars', defaultVisible: true, icon: '🕐' },
  { widget_id: 'action_items', name: 'Action Items', description: 'Alerts for overdue invoices, upcoming bills, and draft entries', chartType: 'List', defaultVisible: true, icon: '⚡' },
  { widget_id: 'recent_transactions', name: 'Recent Transactions', description: 'Last 10 journal entries with status', chartType: 'Table', defaultVisible: true, icon: '📋' },
  { widget_id: 'accounts_payable', name: 'Accounts Payable', description: 'AP aging breakdown as a donut chart', chartType: 'Donut Chart', defaultVisible: false, icon: '🔴' },
  { widget_id: 'accounts_receivable', name: 'Accounts Receivable', description: 'Top 5 customers with outstanding balances', chartType: 'Bar Chart', defaultVisible: false, icon: '🟢' },
  { widget_id: 'cash_flow', name: 'Cash Flow', description: 'Monthly inflows vs outflows for last 6 months', chartType: 'Stepped Line', defaultVisible: false, icon: '💧' },
  { widget_id: 'invoices', name: 'Invoices', description: 'Invoice status breakdown — Draft, Sent, Overdue, Paid', chartType: 'Stacked Bar', defaultVisible: false, icon: '🧾' },
  { widget_id: 'bills', name: 'Bills', description: 'Bills by status with count and total amount', chartType: 'List', defaultVisible: false, icon: '📑' },
  { widget_id: 'deposits', name: 'Deposits', description: 'Monthly deposit amounts for last 6 months', chartType: 'Bar Chart', defaultVisible: false, icon: '🏦' },
  { widget_id: 'expenses', name: 'Expenses', description: 'Expense breakdown by category', chartType: 'Bar Chart', defaultVisible: false, icon: '💳' },
  { widget_id: 'profit_and_loss', name: 'Profit & Loss', description: 'Revenue vs expenses for the selected period', chartType: 'Dual Bar', defaultVisible: false, icon: '📉' },
  { widget_id: 'sales', name: 'Sales', description: 'Revenue trend over last 12 months', chartType: 'Line Chart', defaultVisible: false, icon: '🚀' },
  { widget_id: 'ai_analysis', name: 'AI Analysis', description: 'AI-generated financial insights and recommendations', chartType: 'Text Card', defaultVisible: false, icon: '🤖' },
  { widget_id: 'sentinel_alerts', name: 'Sentinel Alerts', description: 'Proactive GL intelligence — duplicate bills, anomalies, overdue AR', chartType: 'List', defaultVisible: true, icon: '🔔' },
]

// ── Helpers ────────────────────────────────────────────────────────

const $ = (n: number, dec = 0) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: dec }).format(n)

const yFmt = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000 ? `$${(n / 1_000).toFixed(0)}K`
    : `$${n}`

function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded ${className}`} style={{ background: 'var(--border-color)' }} />
}

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg p-3 text-xs space-y-1" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)', minWidth: 150 }}>
      <p className="font-semibold mb-1" style={{ color: 'var(--text-secondary)' }}>{label}</p>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex justify-between gap-4">
          <span style={{ color: p.color }}>{p.name}</span>
          <span className="font-medium tabular-nums">{typeof p.value === 'number' && p.value > 100 ? $(p.value) : p.value}</span>
        </div>
      ))}
    </div>
  )
}

function pctChange(curr: number, prior: number) {
  if (prior === 0) return curr === 0 ? 0 : 100
  return ((curr - prior) / Math.abs(prior)) * 100
}

// ── Default Widget Components ──────────────────────────────────────

export function RevenueVsExpensesWidget({ monthlyData }: { monthlyData: any[] }) {
  const colors = getChartColors()
  const hasData = monthlyData.some(m => m.revenue > 0 || m.expenses > 0)
  return hasData ? (
    <ResponsiveContainer width="100%" height={200}>
      <ComposedChart data={monthlyData} barGap={2}>
        <CartesianGrid vertical={false} stroke={colors.grid} strokeOpacity={0.4} />
        <XAxis dataKey="short" tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} width={52} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="revenue" name="Revenue" fill={colors.revenue} opacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={18} animationDuration={800} animationEasing="ease-out" />
        <Bar dataKey="expenses" name="Expenses" fill={colors.expenses} opacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={18} animationDuration={800} animationEasing="ease-out" />
        <Line dataKey="net" name="Net Profit" stroke={colors.accent} strokeWidth={2} dot={false} animationDuration={800} />
      </ComposedChart>
    </ResponsiveContainer>
  ) : (
    <div className="flex items-center justify-center h-[200px] text-sm" style={{ color: 'var(--text-muted)' }}>No transaction data yet</div>
  )
}

export function ProfitMarginTrendWidget({ monthlyData }: { monthlyData: any[] }) {
  const colors = getChartColors()
  const marginData = monthlyData.map(m => ({
    ...m,
    margin: m.revenue > 0 ? parseFloat(((m.net / m.revenue) * 100).toFixed(1)) : 0,
  }))
  const hasData = marginData.some(m => m.revenue > 0)
  return hasData ? (
    <ResponsiveContainer width="100%" height={200}>
      <AreaChart data={marginData}>
        <defs>
          <linearGradient id="marginGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.accent} stopOpacity={0.15} />
            <stop offset="95%" stopColor={colors.accent} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={colors.grid} strokeOpacity={0.4} />
        <XAxis dataKey="short" tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={(v) => `${v}%`} tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} width={42} />
        <Tooltip
          content={({ active, payload }: any) => {
            if (!active || !payload?.length) return null
            const d = payload[0]?.payload
            return (
              <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                <p className="font-semibold" style={{ color: 'var(--text-secondary)' }}>{d?.label}</p>
                <p>{payload[0]?.value?.toFixed(1)}% margin</p>
                <p style={{ color: 'var(--text-muted)' }}>{$(d?.net)} profit on {$(d?.revenue)} revenue</p>
              </div>
            )
          }}
        />
        <ReferenceLine y={0} stroke={colors.grid} strokeDasharray="4 2" />
        <Area dataKey="margin" name="Margin %" stroke={colors.accent} strokeWidth={2} fill="url(#marginGrad)" dot={false} animationDuration={800} />
      </AreaChart>
    </ResponsiveContainer>
  ) : (
    <div className="flex items-center justify-center h-[200px] text-sm" style={{ color: 'var(--text-muted)' }}>More data needed</div>
  )
}

export function TopExpenseCategoriesWidget({ categories }: { categories: any[] }) {
  return categories.length > 0 ? (
    <div className="space-y-2.5">
      {categories.map((cat: any) => (
        <div key={cat.account_name}>
          <div className="flex justify-between text-xs mb-1">
            <span className="truncate max-w-[55%]" style={{ color: 'var(--text-primary)' }}>{cat.account_name}</span>
            <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
              {$(cat.amount)} <span className="opacity-60">({cat.percentage}%)</span>
            </span>
          </div>
          <div className="h-1.5 rounded-full" style={{ background: 'var(--border-color)' }}>
            <div className="h-full rounded-full transition-all" style={{ width: `${cat.percentage}%`, background: 'var(--neon-fuchsia)', opacity: 0.7 }} />
          </div>
        </div>
      ))}
    </div>
  ) : (
    <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--text-muted)' }}>No expense data for this period</div>
  )
}

export function ReceivablesAgingWidget({ aging }: { aging: any }) {
  // Support both rich format { total_outstanding, buckets: { current: {total, count}, ... } }
  // and legacy flat format { current, days_1_30, ... }
  const isRich = aging && aging.buckets
  const BUCKET_DEFS = [
    { label: 'Current', richKey: 'current', flatKey: 'current', color: 'var(--neon-emerald)' },
    { label: '1–30 days', richKey: '1_30', flatKey: 'days_1_30', color: '#fbbf24' },
    { label: '31–60 days', richKey: '31_60', flatKey: 'days_31_60', color: '#f97316' },
    { label: '61–90 days', richKey: '61_90', flatKey: 'days_61_90', color: '#ef4444' },
    { label: '90+ days', richKey: 'over_90', flatKey: 'days_90_plus', color: '#b91c1c' },
  ]
  const total = isRich
    ? (aging.total_outstanding as number)
    : Object.values(aging as Record<string, number>).reduce((s, v) => s + (v as number), 0)

  return total > 0 ? (
    <div className="space-y-2.5">
      {BUCKET_DEFS.map(({ label, richKey, flatKey, color }) => {
        const bucketData = isRich ? aging.buckets[richKey] : null
        const amt = isRich ? (bucketData?.total ?? 0) : ((aging as any)[flatKey] || 0)
        const count = isRich ? (bucketData?.count ?? 0) : null
        const pct = total > 0 ? (amt / total) * 100 : 0
        return (
          <div key={richKey}>
            <div className="flex justify-between text-xs mb-1">
              <span style={{ color: 'var(--text-primary)' }}>
                {label}{count !== null && count > 0 ? <span className="ml-1 opacity-50">({count})</span> : null}
              </span>
              <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>
                {$(amt)} <span className="opacity-60">({pct.toFixed(0)}%)</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full" style={{ background: 'var(--border-color)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: color }} />
            </div>
          </div>
        )
      })}
      <div className="flex justify-between text-xs font-semibold pt-2 mt-1" style={{ borderTop: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
        <span>Total Outstanding</span>
        <span className="tabular-nums">{$(total)}</span>
      </div>
      {isRich && aging.total_overdue > 0 && (
        <p className="text-xs" style={{ color: 'var(--negative)' }}>
          {$(aging.total_overdue)} overdue
        </p>
      )}
    </div>
  ) : (
    <div className="flex flex-col items-center justify-center h-40 gap-2">
      <div className="w-2 h-2 rounded-full" style={{ background: 'var(--neon-emerald)' }} />
      <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No overdue receivables</p>
    </div>
  )
}

export function ActionItemsWidget({ items }: { items: any[] }) {
  const configs: Record<string, { dot: string; text: (i: any) => string }> = {
    overdue_invoices: { dot: 'var(--negative)', text: (i) => `${i.count} invoice${i.count > 1 ? 's' : ''} overdue (${$(i.amount)})` },
    bills_due_soon: { dot: '#fbbf24', text: (i) => `${i.count} bill${i.count > 1 ? 's' : ''} due this week (${$(i.amount)})` },
    draft_entries: { dot: 'var(--neon-cyan)', text: (i) => `${i.count} draft entr${i.count > 1 ? 'ies' : 'y'} need posting` },
    negative_cash: { dot: 'var(--negative)', text: (i) => `Cash balance is negative (${$(i.amount)})` },
  }
  return items.length === 0 ? (
    <div className="flex items-center gap-2.5 py-3">
      <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--neon-emerald)' }} />
      <span className="text-sm" style={{ color: 'var(--text-muted)' }}>All clear — no action items</span>
    </div>
  ) : (
    <div className="space-y-1">
      {items.slice(0, 5).map((item, i) => {
        const cfg = configs[item.type] || { dot: 'var(--text-muted)', text: () => item.type }
        return (
          <Link key={i} href={item.link} className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group" style={{ background: 'var(--bg-secondary)' }}>
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: cfg.dot }} />
            <span className="text-sm flex-1" style={{ color: 'var(--text-primary)' }}>{cfg.text(item)}</span>
            <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-muted)' }} />
          </Link>
        )
      })}
    </div>
  )
}

export function RecentTransactionsWidget({ transactions }: { transactions: any[] }) {
  return transactions.length > 0 ? (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
            {['Date', 'Entry #', 'Memo', 'Amount', 'Status'].map((h, i) => (
              <th key={h} className={`pb-2 text-left font-medium ${i >= 3 ? 'text-right' : ''}`} style={{ color: 'var(--text-muted)' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {transactions.map((txn: any) => (
            <tr key={txn.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
              <td className="py-2 pr-3 whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
                {txn.date ? new Date(txn.date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
              </td>
              <td className="py-2 pr-3 font-mono" style={{ color: 'var(--text-secondary)' }}>{txn.entry_number || '—'}</td>
              <td className="py-2 pr-3 max-w-[120px] truncate" style={{ color: 'var(--text-primary)' }}>{txn.memo || '—'}</td>
              <td className="py-2 pr-3 text-right tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>{$(txn.amount)}</td>
              <td className="py-2 text-right">
                <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-medium" style={{
                  background: txn.status === 'posted' ? 'rgba(52,211,153,0.15)' : 'rgba(251,191,36,0.15)',
                  color: txn.status === 'posted' ? 'var(--neon-emerald)' : '#fbbf24',
                }}>{txn.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <p className="text-sm py-6 text-center" style={{ color: 'var(--text-muted)' }}>No recent transactions</p>
  )
}

// ── Additional Widget Components ───────────────────────────────────

export function AccountsPayableWidget({ data }: { data: any }) {
  const colors = getChartColors()
  if (!data) return <Skeleton className="h-40 w-full" />

  // Support rich format { total_outstanding, buckets: { current: {total, count}, ... } }
  // and legacy flat format { current, days_1_30, ... }
  const isRich = data && data.buckets
  const BUCKET_DEFS = [
    { label: 'Current', richKey: 'current', flatKey: 'current', color: colors.revenue },
    { label: '1–30 days', richKey: '1_30', flatKey: 'days_1_30', color: colors.warning || '#fbbf24' },
    { label: '31–60 days', richKey: '31_60', flatKey: 'days_31_60', color: colors.orange || '#f97316' },
    { label: '61–90 days', richKey: '61_90', flatKey: 'days_61_90', color: colors.danger || '#ef4444' },
    { label: '90+ days', richKey: 'over_90', flatKey: 'days_90_plus', color: '#b91c1c' },
  ]
  const chartData = BUCKET_DEFS.map(b => ({
    name: b.label,
    value: isRich ? (data.buckets[b.richKey]?.total ?? 0) : (data[b.flatKey] || 0),
    count: isRich ? (data.buckets[b.richKey]?.count ?? 0) : null,
    color: b.color,
  }))
  const total = isRich ? data.total_outstanding : chartData.reduce((s, d) => s + d.value, 0)

  return (
    <div className="flex items-center gap-4">
      <ResponsiveContainer width={140} height={140}>
        <PieChart>
          <Pie data={chartData} cx={65} cy={65} innerRadius={40} outerRadius={65} dataKey="value" animationDuration={800}>
            {chartData.map((entry, i) => <Cell key={i} fill={entry.color} opacity={0.85} />)}
          </Pie>
          <Tooltip formatter={(v: any) => $(v)} contentStyle={{ background: 'var(--bg-primary)', border: '1px solid var(--border-color)', borderRadius: 6, fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
      <div className="flex-1 space-y-1.5">
        {chartData.map((b) => (
          <div key={b.name} className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: b.color }} />
              <span style={{ color: 'var(--text-secondary)' }}>{b.name}</span>
              {b.count !== null && b.count > 0 && (
                <span className="opacity-40" style={{ color: 'var(--text-muted)' }}>({b.count})</span>
              )}
            </div>
            <span className="tabular-nums font-medium" style={{ color: 'var(--text-primary)' }}>{$(b.value)}</span>
          </div>
        ))}
        <div className="flex justify-between text-xs font-bold pt-1.5 mt-1" style={{ borderTop: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
          <span>Total AP</span><span className="tabular-nums">{$(total)}</span>
        </div>
        {isRich && data.total_overdue > 0 && (
          <p className="text-xs" style={{ color: 'var(--negative)' }}>{$(data.total_overdue)} overdue</p>
        )}
      </div>
    </div>
  )
}

export function AccountsReceivableWidget({ data }: { data: any[] | null }) {
  const colors = getChartColors()
  if (!data) return <Skeleton className="h-40 w-full" />
  return data.length > 0 ? (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={data} layout="vertical">
        <CartesianGrid horizontal={false} stroke={colors.grid} strokeOpacity={0.4} />
        <XAxis type="number" tickFormatter={yFmt} tick={{ fontSize: 10, fill: colors.text } as any} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="customer" tick={{ fontSize: 10, fill: colors.text } as any} axisLine={false} tickLine={false} width={80} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="amount" name="Outstanding" fill={colors.revenue} opacity={0.85} radius={[0, 2, 2, 0]} animationDuration={800} />
      </BarChart>
    </ResponsiveContainer>
  ) : (
    <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--text-muted)' }}>No outstanding receivables</div>
  )
}

export function CashFlowWidget({ data }: { data: any[] | null }) {
  const colors = getChartColors()
  if (!data) return <Skeleton className="h-40 w-full" />
  return (
    <ResponsiveContainer width="100%" height={180}>
      <ComposedChart data={data}>
        <CartesianGrid vertical={false} stroke={colors.grid} strokeOpacity={0.4} />
        <XAxis dataKey="short" tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} width={52} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="inflows" name="Inflows" fill={colors.revenue} opacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={16} animationDuration={800} />
        <Bar dataKey="outflows" name="Outflows" fill={colors.expenses} opacity={0.85} radius={[2, 2, 0, 0]} maxBarSize={16} animationDuration={800} />
        <Line dataKey="net" name="Net" stroke={colors.accent} strokeWidth={2} dot={false} />
      </ComposedChart>
    </ResponsiveContainer>
  )
}

export function InvoicesWidget({ data }: { data: any | null }) {
  if (!data) return <Skeleton className="h-24 w-full" />
  const statuses = [
    { key: 'paid', label: 'Paid', color: 'var(--neon-emerald)' },
    { key: 'sent', label: 'Sent', color: 'var(--neon-cyan)' },
    { key: 'overdue', label: 'Overdue', color: 'var(--negative)' },
    { key: 'draft', label: 'Draft', color: 'var(--text-muted)' },
  ]
  const total = Object.values(data as Record<string, number>).reduce((s, v) => s + v, 0)
  return (
    <div className="space-y-3">
      <div className="flex rounded-full overflow-hidden h-4" style={{ background: 'var(--border-color)' }}>
        {statuses.map(({ key, color }) => {
          const pct = total > 0 ? ((data[key] || 0) / total) * 100 : 0
          return pct > 0 ? <div key={key} style={{ width: `${pct}%`, background: color, transition: 'width 0.8s ease' }} /> : null
        })}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {statuses.map(({ key, label, color }) => (
          <div key={key} className="flex items-center justify-between px-2 py-1.5 rounded" style={{ background: 'var(--bg-secondary)' }}>
            <div className="flex items-center gap-1.5">
              <div className="w-2 h-2 rounded-full" style={{ background: color }} />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{label}</span>
            </div>
            <span className="text-xs font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{data[key] || 0}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function BillsWidget({ data }: { data: any[] | null }) {
  if (!data) return <Skeleton className="h-32 w-full" />
  const statusColors: Record<string, string> = {
    paid: 'var(--neon-emerald)', posted: 'var(--neon-cyan)', draft: 'var(--text-muted)', void: '#6b7280', overdue: 'var(--negative)',
  }
  return data.length > 0 ? (
    <div className="space-y-1.5">
      {data.map((row: any) => (
        <div key={row.status} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ background: statusColors[row.status] || 'var(--text-muted)' }} />
            <span className="text-sm capitalize" style={{ color: 'var(--text-primary)' }}>{row.status}</span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>({row.count})</span>
          </div>
          <span className="text-sm font-semibold tabular-nums" style={{ color: 'var(--text-primary)' }}>{$(row.total)}</span>
        </div>
      ))}
    </div>
  ) : (
    <div className="flex items-center justify-center h-32 text-sm" style={{ color: 'var(--text-muted)' }}>No bills found</div>
  )
}

export function DepositsWidget({ data }: { data: any[] | null }) {
  const colors = getChartColors()
  if (!data) return <Skeleton className="h-40 w-full" />
  return (
    <ResponsiveContainer width="100%" height={160}>
      <BarChart data={data}>
        <CartesianGrid vertical={false} stroke={colors.grid} strokeOpacity={0.4} />
        <XAxis dataKey="short" tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} width={48} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="amount" name="Deposits" fill={colors.accent} opacity={0.85} radius={[2, 2, 0, 0]} animationDuration={800} />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function ExpensesWidget({ categories }: { categories: any[] }) {
  const colors = getChartColors()
  const top = categories.slice(0, 7)
  return top.length > 0 ? (
    <ResponsiveContainer width="100%" height={180}>
      <BarChart data={top} layout="vertical">
        <CartesianGrid horizontal={false} stroke={colors.grid} strokeOpacity={0.4} />
        <XAxis type="number" tickFormatter={yFmt} tick={{ fontSize: 10, fill: colors.text } as any} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="account_name" tick={{ fontSize: 10, fill: colors.text } as any} axisLine={false} tickLine={false} width={90} />
        <Tooltip content={<ChartTooltip />} />
        <Bar dataKey="amount" name="Amount" fill={colors.expenses} opacity={0.85} radius={[0, 2, 2, 0]} animationDuration={800} />
      </BarChart>
    </ResponsiveContainer>
  ) : (
    <div className="flex items-center justify-center h-40 text-sm" style={{ color: 'var(--text-muted)' }}>No expense data</div>
  )
}

export function ProfitAndLossWidget({ data }: { data: any | null }) {
  const colors = getChartColors()
  if (!data) return <Skeleton className="h-40 w-full" />
  const chartData = [
    { name: 'Revenue', value: data.revenue, color: colors.revenue },
    { name: 'Expenses', value: data.expenses, color: colors.expenses },
  ]
  return (
    <div className="space-y-4">
      <ResponsiveContainer width="100%" height={120}>
        <BarChart data={chartData}>
          <CartesianGrid vertical={false} stroke={colors.grid} strokeOpacity={0.4} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} width={52} />
          <Tooltip content={<ChartTooltip />} />
          <Bar dataKey="value" name="Amount" radius={[2, 2, 0, 0]} maxBarSize={40} animationDuration={800}>
            {chartData.map((entry, i) => <Cell key={i} fill={entry.color} opacity={0.85} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex justify-between items-center px-1">
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Net Profit</span>
        <span className="text-lg font-bold tabular-nums" style={{ color: data.net >= 0 ? 'var(--neon-emerald)' : 'var(--negative)' }}>{$(data.net)}</span>
      </div>
    </div>
  )
}

export function SalesWidget({ data }: { data: any[] | null }) {
  const colors = getChartColors()
  if (!data) return <Skeleton className="h-40 w-full" />
  return (
    <ResponsiveContainer width="100%" height={180}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="salesGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={colors.revenue} stopOpacity={0.15} />
            <stop offset="95%" stopColor={colors.revenue} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid vertical={false} stroke={colors.grid} strokeOpacity={0.4} />
        <XAxis dataKey="short" tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} />
        <YAxis tickFormatter={yFmt} tick={{ fontSize: 11, fill: colors.text } as any} axisLine={false} tickLine={false} width={52} />
        <Tooltip content={<ChartTooltip />} />
        <Area dataKey="revenue" name="Revenue" stroke={colors.revenue} strokeWidth={2} fill="url(#salesGrad)" dot={false} animationDuration={800} />
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function AIAnalysisWidget({
  companyId, onRefresh,
}: { companyId: string | null; onRefresh?: () => void }) {
  return (
    <div
      className="rounded-lg p-4 space-y-3 text-sm"
      style={{
        background: 'var(--accent-subtle)',
        border: '1px solid var(--border-color)',
        borderLeft: '2px solid var(--accent)',
      }}
    >
      <p style={{ color: 'var(--text-muted)' }}>AI financial analysis is available via the AI Insights section.</p>
      <Link href="/ai-insights" className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: 'var(--neon-cyan)' }}>
        Open AI Insights <ArrowUpRight className="w-3 h-3" />
      </Link>
    </div>
  )
}

const SEVERITY_DOT: Record<string, string> = {
  critical: 'var(--negative)',
  warning: '#f59e0b',
  info: 'var(--neon-cyan)',
}

const TRIGGER_SHORT: Record<string, string> = {
  duplicate_bill: 'Dup. Bill',
  anomaly_txn: 'Anomaly',
  overdue_invoice: 'Overdue AR',
}

export function SentinelAlertsWidget({ alerts }: { alerts: any[] | null }) {
  if (!alerts) return <Skeleton className="h-32 w-full" />
  if (alerts.length === 0) {
    return (
      <div className="flex items-center gap-2.5 py-3">
        <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: 'var(--neon-emerald)' }} />
        <span className="text-sm" style={{ color: 'var(--text-muted)' }}>No open alerts — all clear</span>
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {alerts.slice(0, 5).map((a: any) => (
        <Link
          key={a.id}
          href="/alerts"
          className="flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors group"
          style={{ background: 'var(--bg-secondary)' }}
        >
          <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: SEVERITY_DOT[a.severity] || 'var(--text-muted)' }} />
          <span className="text-sm flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{a.title}</span>
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            {TRIGGER_SHORT[a.trigger_name] || a.trigger_name}
          </span>
          <ArrowUpRight className="w-3.5 h-3.5 opacity-0 group-hover:opacity-60 transition-opacity" style={{ color: 'var(--text-muted)' }} />
        </Link>
      ))}
      {alerts.length > 5 && (
        <Link href="/alerts" className="block text-xs text-center pt-1" style={{ color: 'var(--neon-cyan)' }}>
          View all {alerts.length} alerts →
        </Link>
      )}
    </div>
  )
}
