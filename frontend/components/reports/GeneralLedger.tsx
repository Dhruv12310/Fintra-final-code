'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Search, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'

interface GLAccount {
  account_id: string
  account_code: string
  account_name: string
  account_type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  account_subtype?: string | null
  opening_balance: number
  period_debit: number
  period_credit: number
  ending_balance: number
}

interface GLTransaction {
  line_id: string
  entry_id: string
  entry_date: string
  journal_number?: string | null
  memo?: string | null
  description?: string | null
  source?: string | null
  source_type?: string | null
  source_id?: string | null
  reverses_entry_id?: string | null
  contact_id?: string | null
  contact_name?: string | null
  debit: number
  credit: number
  running_balance: number
}

interface GLData {
  account_id: string
  start_date: string
  end_date: string
  opening_balance: number
  period_debit: number
  period_credit: number
  ending_balance: number
  transactions: GLTransaction[]
}

interface Props {
  startDate: string
  endDate: string
}

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)

const TYPE_LABELS: Record<GLAccount['account_type'], string> = {
  asset: 'Assets',
  liability: 'Liabilities',
  equity: 'Equity',
  revenue: 'Revenue',
  expense: 'Expenses',
}

const TYPE_ORDER: GLAccount['account_type'][] = [
  'asset',
  'liability',
  'equity',
  'revenue',
  'expense',
]

function sourceLink(
  source_type: string | null | undefined,
  source_id: string | null | undefined,
  entry_id: string,
): string | null {
  switch (source_type) {
    case 'invoice':
      return source_id ? `/invoices?focus=${source_id}` : null
    case 'bill':
      return source_id ? `/bills?focus=${source_id}` : null
    case 'payment':
      return source_id ? `/payments?focus=${source_id}` : null
    case 'bill_payment':
      return source_id ? `/payments?focus=${source_id}` : null
    case 'manual':
      // Manual entries have no separate source doc; jump to the entry itself.
      return `/journals?focus=${entry_id}`
    default:
      return null
  }
}

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function GeneralLedgerReport({ startDate, endDate }: Props) {
  const [accounts, setAccounts] = useState<GLAccount[]>([])
  const [accountsLoading, setAccountsLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [data, setData] = useState<GLData | null>(null)
  const [txnsLoading, setTxnsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchAccounts = useCallback(async () => {
    setAccountsLoading(true)
    setError(null)
    try {
      const res = await api.get(
        `/reports/general-ledger/accounts?start_date=${startDate}&end_date=${endDate}`
      )
      const list: GLAccount[] = res?.accounts || []
      setAccounts(list)
      if (list.length > 0 && !selectedId) {
        setSelectedId(list[0].account_id)
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load accounts')
    } finally {
      setAccountsLoading(false)
    }
  }, [startDate, endDate, selectedId])

  const fetchTransactions = useCallback(
    async (accountId: string) => {
      setTxnsLoading(true)
      try {
        const res = await api.get(
          `/reports/general-ledger?account_id=${accountId}&start_date=${startDate}&end_date=${endDate}`
        )
        setData(res)
      } catch {
        setData(null)
      } finally {
        setTxnsLoading(false)
      }
    },
    [startDate, endDate]
  )

  useEffect(() => {
    fetchAccounts()
  }, [fetchAccounts])

  useEffect(() => {
    if (selectedId) fetchTransactions(selectedId)
  }, [selectedId, fetchTransactions])

  const grouped = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const filtered = f
      ? accounts.filter(
          a =>
            a.account_name.toLowerCase().includes(f) ||
            a.account_code.toLowerCase().includes(f)
        )
      : accounts
    const buckets: Record<GLAccount['account_type'], GLAccount[]> = {
      asset: [], liability: [], equity: [], revenue: [], expense: [],
    }
    filtered.forEach(a => buckets[a.account_type]?.push(a))
    return buckets
  }, [accounts, filter])

  const selectedAccount = accounts.find(a => a.account_id === selectedId) || null

  if (error) {
    return (
      <div className="p-8 text-center text-sm" style={{ color: 'var(--negative)' }}>
        {error}
      </div>
    )
  }

  if (accountsLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    )
  }

  if (accounts.length === 0) {
    return (
      <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
        No accounts found for this period.
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-[280px_1fr] gap-4">
      {/* Account rail */}
      <aside
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
      >
        <div className="p-2 border-b" style={{ borderColor: 'var(--border-color)' }}>
          <div className="relative">
            <Search
              className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5"
              style={{ color: 'var(--text-muted)' }}
            />
            <input
              type="text"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              placeholder="Search account or code"
              className="w-full text-xs pl-7 pr-2 py-1.5 rounded"
              style={{
                background: 'var(--bg-muted)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
              }}
            />
          </div>
        </div>
        <div className="max-h-[640px] overflow-y-auto">
          {TYPE_ORDER.map(type => {
            const list = grouped[type]
            if (!list || list.length === 0) return null
            return (
              <div key={type}>
                <div
                  className="px-3 py-1.5 text-[10px] font-semibold uppercase sticky top-0"
                  style={{
                    color: 'var(--text-muted)',
                    background: 'var(--bg-card)',
                    borderBottom: '1px solid var(--border-color)',
                    letterSpacing: '0.08em',
                  }}
                >
                  {TYPE_LABELS[type]}
                </div>
                {list.map(a => {
                  const active = a.account_id === selectedId
                  return (
                    <button
                      key={a.account_id}
                      onClick={() => setSelectedId(a.account_id)}
                      className="w-full text-left px-3 py-2 transition-colors block"
                      style={{
                        background: active ? 'var(--accent-subtle)' : 'transparent',
                        borderLeft: active
                          ? '2px solid var(--accent)'
                          : '2px solid transparent',
                      }}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div
                            className="text-xs font-medium truncate"
                            style={{
                              color: active
                                ? 'var(--accent-text, var(--accent))'
                                : 'var(--text-primary)',
                            }}
                          >
                            {a.account_name}
                          </div>
                          <div
                            className="text-[10px] num"
                            style={{ color: 'var(--text-muted)' }}
                          >
                            {a.account_code}
                          </div>
                        </div>
                        <div
                          className="text-xs num text-right"
                          style={{
                            color:
                              a.ending_balance < 0
                                ? 'var(--negative)'
                                : 'var(--text-secondary)',
                          }}
                        >
                          {$(a.ending_balance)}
                        </div>
                      </div>
                    </button>
                  )
                })}
              </div>
            )
          })}
        </div>
      </aside>

      {/* Transactions panel */}
      <section
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)' }}
      >
        {selectedAccount ? (
          <>
            <header
              className="px-4 py-3 flex items-start justify-between gap-3 flex-wrap"
              style={{ borderBottom: '1px solid var(--border-color)' }}
            >
              <div>
                <h3
                  className="text-base font-semibold"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {selectedAccount.account_name}
                  <span
                    className="ml-2 text-xs font-normal num"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {selectedAccount.account_code}
                  </span>
                </h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {fmtDate(startDate)} to {fmtDate(endDate)}
                </p>
              </div>
              <div className="flex gap-4 text-right">
                <Stat label="Opening" value={data?.opening_balance ?? selectedAccount.opening_balance} />
                <Stat label="Debits" value={data?.period_debit ?? selectedAccount.period_debit} positive />
                <Stat label="Credits" value={data?.period_credit ?? selectedAccount.period_credit} negative />
                <Stat label="Ending" value={data?.ending_balance ?? selectedAccount.ending_balance} bold />
              </div>
            </header>

            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr
                    style={{
                      background: 'var(--bg-muted)',
                      borderBottom: '1px solid var(--border-color)',
                    }}
                  >
                    <Th>Date</Th>
                    <Th>Entry #</Th>
                    <Th>Memo / Description</Th>
                    <Th>Contact</Th>
                    <Th align="right">Debit</Th>
                    <Th align="right">Credit</Th>
                    <Th align="right">Balance</Th>
                  </tr>
                </thead>
                <tbody>
                  {txnsLoading ? (
                    <tr>
                      <td colSpan={7} className="py-8 text-center">
                        <Loader2 className="h-4 w-4 animate-spin inline" style={{ color: 'var(--text-muted)' }} />
                      </td>
                    </tr>
                  ) : data && data.transactions.length > 0 ? (
                    data.transactions.map(t => {
                      const link = sourceLink(t.source_type, t.source_id, t.entry_id)
                      const memo = [t.memo, t.description].filter(Boolean).join(' \u2014 ')
                      return (
                        <tr
                          key={t.line_id}
                          style={{ borderBottom: '1px solid var(--border-color)' }}
                        >
                          <Td muted nowrap>{fmtDate(t.entry_date)}</Td>
                          <Td nowrap>
                            <span className="num" style={{ color: 'var(--text-secondary)' }}>
                              {t.journal_number || '\u2014'}
                            </span>
                          </Td>
                          <Td>
                            <div className="flex items-center gap-1.5">
                              <span style={{ color: 'var(--text-primary)' }}>
                                {memo || '\u2014'}
                              </span>
                              {link && (
                                <Link
                                  href={link}
                                  className="opacity-60 hover:opacity-100"
                                  title={`Open source ${t.source_type}`}
                                >
                                  <ExternalLink className="w-3 h-3" />
                                </Link>
                              )}
                              {t.reverses_entry_id && (
                                <span
                                  className="text-[9px] px-1 py-0.5 rounded uppercase font-semibold"
                                  style={{
                                    background: 'var(--negative-soft)',
                                    color: 'var(--negative)',
                                  }}
                                >
                                  Reversal
                                </span>
                              )}
                            </div>
                          </Td>
                          <Td muted>{t.contact_name || '\u2014'}</Td>
                          <Td align="right" mono>
                            {t.debit > 0 ? $(t.debit) : ''}
                          </Td>
                          <Td align="right" mono>
                            {t.credit > 0 ? $(t.credit) : ''}
                          </Td>
                          <Td align="right" mono bold>
                            {$(t.running_balance)}
                          </Td>
                        </tr>
                      )
                    })
                  ) : (
                    <tr>
                      <td
                        colSpan={7}
                        className="py-12 text-center text-sm"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        No transactions for this account in the selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="p-8 text-center" style={{ color: 'var(--text-muted)' }}>
            Select an account to view its ledger.
          </div>
        )}
      </section>
    </div>
  )
}

function Stat({
  label, value, positive, negative, bold,
}: {
  label: string
  value: number
  positive?: boolean
  negative?: boolean
  bold?: boolean
}) {
  const color = positive
    ? 'var(--positive)'
    : negative
    ? 'var(--negative)'
    : 'var(--text-primary)'
  return (
    <div className="flex flex-col items-end">
      <span
        className="text-[10px] uppercase font-semibold"
        style={{ color: 'var(--text-muted)', letterSpacing: '0.08em' }}
      >
        {label}
      </span>
      <span
        className="num"
        style={{ color, fontWeight: bold ? 600 : 500, fontSize: 13 }}
      >
        {$(value)}
      </span>
    </div>
  )
}

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
}) {
  return (
    <th
      className="text-[10px] font-semibold uppercase px-3 py-2"
      style={{
        color: 'var(--text-muted)',
        textAlign: align,
        letterSpacing: '0.06em',
      }}
    >
      {children}
    </th>
  )
}

function Td({
  children,
  align = 'left',
  muted,
  mono,
  bold,
  nowrap,
}: {
  children: React.ReactNode
  align?: 'left' | 'right'
  muted?: boolean
  mono?: boolean
  bold?: boolean
  nowrap?: boolean
}) {
  return (
    <td
      className={`px-3 py-2 ${nowrap ? 'whitespace-nowrap' : ''} ${mono ? 'num' : ''}`}
      style={{
        color: muted ? 'var(--text-muted)' : 'var(--text-primary)',
        textAlign: align,
        fontWeight: bold ? 600 : 400,
      }}
    >
      {children}
    </td>
  )
}
