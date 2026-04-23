'use client'
import React, { useState, useEffect } from 'react'
import Link from 'next/link'
import { useScrollReveal } from '@/hooks/useScrollReveal'
import {
  RevenueVsExpensesWidget,
  ProfitMarginTrendWidget,
  TopExpenseCategoriesWidget,
  ActionItemsWidget,
  RecentTransactionsWidget,
  AccountsReceivableWidget,
  InvoicesWidget,
  BillsWidget,
  DepositsWidget,
  ExpensesWidget,
  ProfitAndLossWidget,
  SalesWidget,
  AIAnalysisWidget,
  SentinelAlertsWidget,
  WIDGET_CATALOG,
} from './widgets'
import { AgingStackedBar } from './AgingStackedBar'
import { CashFlowWaterfall } from './CashFlowWaterfall'
import { api } from '@/lib/api'

interface WidgetPref {
  widget_id: string
  position: number
  is_visible: boolean
}

interface Props {
  prefs: WidgetPref[]
  dashboardData: any
  companyId: string | null
}

const WIDGET_TITLES: Record<string, string> = {
  revenue_vs_expenses: 'Revenue vs Expenses',
  profit_margin_trend: 'Profit Margin Trend',
  top_expense_categories: 'Top Expense Categories',
  receivables_aging: 'Receivables Aging',
  action_items: 'Action Items',
  recent_transactions: 'Recent Transactions',
  accounts_payable: 'Accounts Payable',
  accounts_receivable: 'Accounts Receivable',
  cash_flow: 'Cash Flow',
  invoices: 'Invoices',
  bills: 'Bills',
  deposits: 'Deposits',
  expenses: 'Expenses',
  profit_and_loss: 'Profit & Loss',
  sales: 'Sales',
  ai_analysis: 'AI Analysis',
  sentinel_alerts: 'Sentinel Alerts',
}

function WidgetCard({ id, children, showViewAll, viewAllHref }: {
  id: string
  children: React.ReactNode
  showViewAll?: boolean
  viewAllHref?: string
}) {
  const { ref, visible } = useScrollReveal<HTMLDivElement>()
  const [hovered, setHovered] = useState(false)

  return (
    <div
      ref={ref}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${hovered ? 'var(--border-strong)' : 'var(--border-color)'}`,
        borderRadius: 10,
        padding: 18,
        transition: 'opacity 0.5s ease, transform 0.5s ease, border-color 0.15s ease, box-shadow 0.15s ease',
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateY(0)' : 'translateY(16px)',
        boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-xs)',
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <p
          className="font-semibold uppercase"
          style={{
            color: 'var(--text-muted)',
            fontSize: 10.5,
            letterSpacing: '0.08em',
          }}
        >
          {WIDGET_TITLES[id] || id}
        </p>
        {showViewAll && viewAllHref && (
          <Link
            href={viewAllHref}
            className="text-xs font-medium transition-colors hover:opacity-80"
            style={{ color: 'var(--accent)' }}
          >
            View all →
          </Link>
        )}
      </div>
      {children}
    </div>
  )
}

export function WidgetGrid({ prefs, dashboardData, companyId }: Props) {
  const visible = prefs.filter(p => p.is_visible).sort((a, b) => a.position - b.position)
  const wd = dashboardData?.widget_data || {}
  const [sentinelAlerts, setSentinelAlerts] = useState<any[] | null>(null)

  useEffect(() => {
    if (visible.some(p => p.widget_id === 'sentinel_alerts')) {
      api.get('/alerts', { status: 'open', limit: 10 })
        .then(d => setSentinelAlerts(d || []))
        .catch(() => setSentinelAlerts([]))
    }
  }, [])

  if (!dashboardData) return null

  function renderWidget(id: string) {
    switch (id) {
      case 'revenue_vs_expenses':
        return (
          <WidgetCard key={id} id={id}>
            <RevenueVsExpensesWidget monthlyData={dashboardData.monthly_data || []} />
          </WidgetCard>
        )
      case 'profit_margin_trend':
        return (
          <WidgetCard key={id} id={id}>
            <ProfitMarginTrendWidget monthlyData={dashboardData.monthly_data || []} />
          </WidgetCard>
        )
      case 'top_expense_categories':
        return (
          <WidgetCard key={id} id={id}>
            <TopExpenseCategoriesWidget categories={dashboardData.expense_categories || []} />
          </WidgetCard>
        )
      case 'receivables_aging':
        return (
          <WidgetCard key={id} id={id} showViewAll viewAllHref="/month-end">
            <AgingStackedBar
              data={wd.ar_aging ?? dashboardData.aging ?? {}}
              emptyLabel="No outstanding receivables"
            />
          </WidgetCard>
        )
      case 'action_items':
        return (
          <WidgetCard key={id} id={id}>
            <ActionItemsWidget items={dashboardData.action_items || []} />
          </WidgetCard>
        )
      case 'recent_transactions':
        return (
          <WidgetCard key={id} id={id} showViewAll viewAllHref="/new-journals">
            <RecentTransactionsWidget transactions={dashboardData.recent_transactions || []} />
          </WidgetCard>
        )
      case 'accounts_payable':
        return (
          <WidgetCard key={id} id={id} showViewAll viewAllHref="/month-end">
            <AgingStackedBar
              data={wd.ap_aging ?? wd.accounts_payable ?? {}}
              emptyLabel="No bills outstanding"
            />
          </WidgetCard>
        )
      case 'accounts_receivable':
        return (
          <WidgetCard key={id} id={id}>
            <AccountsReceivableWidget data={wd.accounts_receivable ?? null} />
          </WidgetCard>
        )
      case 'cash_flow':
        return (
          <WidgetCard key={id} id={id}>
            <CashFlowWaterfall data={wd.cash_flow ?? null} />
          </WidgetCard>
        )
      case 'invoices':
        return (
          <WidgetCard key={id} id={id} showViewAll viewAllHref="/invoices">
            <InvoicesWidget data={wd.invoices ?? null} />
          </WidgetCard>
        )
      case 'bills':
        return (
          <WidgetCard key={id} id={id} showViewAll viewAllHref="/bills">
            <BillsWidget data={wd.bills ?? null} />
          </WidgetCard>
        )
      case 'deposits':
        return (
          <WidgetCard key={id} id={id}>
            <DepositsWidget data={wd.deposits ?? null} />
          </WidgetCard>
        )
      case 'expenses':
        return (
          <WidgetCard key={id} id={id}>
            <ExpensesWidget categories={wd.expenses ?? dashboardData.expense_categories ?? []} />
          </WidgetCard>
        )
      case 'profit_and_loss':
        return (
          <WidgetCard key={id} id={id}>
            <ProfitAndLossWidget data={wd.profit_and_loss ?? null} />
          </WidgetCard>
        )
      case 'sales':
        return (
          <WidgetCard key={id} id={id}>
            <SalesWidget data={wd.sales ?? null} />
          </WidgetCard>
        )
      case 'ai_analysis':
        return (
          <WidgetCard key={id} id={id}>
            <AIAnalysisWidget companyId={companyId} />
          </WidgetCard>
        )
      case 'sentinel_alerts':
        return (
          <WidgetCard key={id} id={id} showViewAll viewAllHref="/alerts">
            <SentinelAlertsWidget alerts={sentinelAlerts} />
          </WidgetCard>
        )
      default:
        return null
    }
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      {visible.map(p => renderWidget(p.widget_id))}
    </div>
  )
}
