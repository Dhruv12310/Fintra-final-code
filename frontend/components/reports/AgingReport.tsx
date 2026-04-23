'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Loader2, Mail, ExternalLink } from 'lucide-react'
import { api } from '@/lib/api'

type Mode = 'ar' | 'ap'

interface AgingItem {
  id: string
  number: string
  contact_name: string
  contact_email?: string | null
  due_date: string
  days_overdue: number
  balance_due: number
}

interface AgingBucket {
  count: number
  total: number
  items: AgingItem[]
}

interface AgingResponse {
  as_of_date: string
  total_outstanding: number
  buckets: {
    current: AgingBucket
    '1_30_days': AgingBucket
    '31_60_days': AgingBucket
    '61_90_days': AgingBucket
    'over_90_days': AgingBucket
  }
}

interface Props {
  mode: Mode
  asOfDate: string
}

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)

const BUCKETS: {
  key: keyof AgingResponse['buckets']
  label: string
  short: string
  color: string
}[] = [
  { key: 'current',     label: 'Current',     short: 'Current', color: 'var(--positive)' },
  { key: '1_30_days',   label: '1\u201330 days',  short: '1-30',   color: '#f59e0b' },
  { key: '31_60_days',  label: '31\u201360 days', short: '31-60',  color: '#f97316' },
  { key: '61_90_days',  label: '61\u201390 days', short: '61-90',  color: '#ef4444' },
  { key: 'over_90_days', label: '90+ days',   short: '90+',    color: '#b91c1c' },
]

function fmtDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  })
}

export function AgingReport({ mode, asOfDate }: Props) {
  const [data, setData] = useState<AgingResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hovered, setHovered] = useState<string | null>(null)

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const path = mode === 'ar' ? '/reports/ar-aging' : '/reports/ap-aging'
      const result = await api.get(`${path}?as_of_date=${asOfDate}`)
      setData(result)
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to load aging report')
    } finally {
      setLoading(false)
    }
  }, [mode, asOfDate])

  useEffect(() => { fetchData() }, [fetchData])

  const allItems = useMemo(() => {
    if (!data) return []
    const out: (AgingItem & { bucket: typeof BUCKETS[number] })[] = []
    BUCKETS.forEach(b => {
      data.buckets[b.key].items.forEach(item => {
        out.push({ ...item, bucket: b })
      })
    })
    return out.sort((a, b) => b.days_overdue - a.days_overdue)
  }, [data])

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-6 w-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-8 text-center text-sm" style={{ color: 'var(--negative)' }}>
        {error}
      </div>
    )
  }

  if (!data || data.total_outstanding === 0) {
    return (
      <div className="p-12 text-center" style={{ color: 'var(--text-muted)' }}>
        <p className="text-sm">
          {mode === 'ar' ? 'No outstanding receivables' : 'No outstanding payables'}.
        </p>
      </div>
    )
  }

  const total = data.total_outstanding
  const overdue = BUCKETS.slice(1).reduce((s, b) => s + data.buckets[b.key].total, 0)
  const docLink = mode === 'ar' ? '/invoices' : '/bills'
  const contactLabel = mode === 'ar' ? 'Customer' : 'Vendor'
  const docLabel = mode === 'ar' ? 'Invoice' : 'Bill'

  return (
    <div className="space-y-6">
      {/* Header summary */}
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div className="flex items-baseline gap-3">
          <span
            className="num-display"
            style={{ color: 'var(--text-primary)', fontSize: 28, lineHeight: 1.1 }}
          >
            {$(total)}
          </span>
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
            outstanding
          </span>
        </div>
        {overdue > 0 && (
          <span className="text-sm font-medium num" style={{ color: 'var(--negative)' }}>
            {$(overdue)} overdue
          </span>
        )}
      </div>

      {/* Stacked bar */}
      <div
        className="flex h-3 w-full rounded-full overflow-hidden"
        style={{ background: 'var(--bg-muted)' }}
      >
        {BUCKETS.map(b => {
          const v = data.buckets[b.key].total
          const pct = total > 0 ? (v / total) * 100 : 0
          if (pct <= 0) return null
          const dim = hovered && hovered !== b.key
          return (
            <div
              key={b.key}
              onMouseEnter={() => setHovered(b.key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: `${pct}%`,
                background: b.color,
                opacity: dim ? 0.4 : 1,
                transition: 'opacity 0.15s ease, width 0.4s ease',
                cursor: 'pointer',
              }}
              title={`${b.label}: ${$(v)} (${pct.toFixed(0)}%)`}
            />
          )
        })}
      </div>

      {/* Bucket cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-2">
        {BUCKETS.map(b => {
          const bucket = data.buckets[b.key]
          const pct = total > 0 ? (bucket.total / total) * 100 : 0
          const isHover = hovered === b.key
          return (
            <div
              key={b.key}
              onMouseEnter={() => setHovered(b.key)}
              onMouseLeave={() => setHovered(null)}
              className="flex flex-col gap-1 px-3 py-2 rounded-lg transition-colors"
              style={{
                border: '1px solid var(--border-color)',
                background: isHover ? 'var(--bg-muted)' : 'var(--bg-card)',
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                  style={{ background: b.color }}
                />
                <span
                  className="text-[10px] uppercase font-semibold"
                  style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}
                >
                  {b.label}
                </span>
              </div>
              <span
                className="num"
                style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 600 }}
              >
                {$(bucket.total)}
              </span>
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                {bucket.count} {bucket.count === 1 ? 'item' : 'items'} \u00B7 {pct.toFixed(0)}%
              </span>
            </div>
          )
        })}
      </div>

      {/* Detail table */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--border-color)' }}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr
                style={{
                  background: 'var(--bg-muted)',
                  borderBottom: '1px solid var(--border-color)',
                }}
              >
                <Th>Bucket</Th>
                <Th>{contactLabel}</Th>
                <Th>{docLabel} #</Th>
                <Th>Due Date</Th>
                <Th align="right">Days Overdue</Th>
                <Th align="right">Balance</Th>
                <Th align="right">Action</Th>
              </tr>
            </thead>
            <tbody>
              {allItems.map(item => {
                const dim = hovered && hovered !== item.bucket.key
                return (
                  <tr
                    key={item.id}
                    style={{
                      borderBottom: '1px solid var(--border-color)',
                      opacity: dim ? 0.45 : 1,
                      transition: 'opacity 0.15s ease',
                    }}
                  >
                    <Td>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                          style={{ background: item.bucket.color }}
                        />
                        <span style={{ color: 'var(--text-secondary)' }}>
                          {item.bucket.short}
                        </span>
                      </span>
                    </Td>
                    <Td>
                      <span style={{ color: 'var(--text-primary)' }}>
                        {item.contact_name}
                      </span>
                      {item.contact_email && (
                        <a
                          href={`mailto:${item.contact_email}`}
                          className="ml-1.5 inline-flex opacity-60 hover:opacity-100"
                          title={`Email ${item.contact_name}`}
                        >
                          <Mail className="w-3 h-3" />
                        </a>
                      )}
                    </Td>
                    <Td muted nowrap>{item.number || '\u2014'}</Td>
                    <Td muted nowrap>{fmtDate(item.due_date)}</Td>
                    <Td align="right" mono>
                      <span
                        style={{
                          color:
                            item.days_overdue > 0
                              ? 'var(--negative)'
                              : 'var(--text-muted)',
                        }}
                      >
                        {item.days_overdue > 0 ? `+${item.days_overdue}` : '0'}
                      </span>
                    </Td>
                    <Td align="right" mono bold>
                      {$(item.balance_due)}
                    </Td>
                    <Td align="right">
                      <Link
                        href={`${docLink}?focus=${item.id}`}
                        className="inline-flex opacity-60 hover:opacity-100"
                        title={`Open ${docLabel.toLowerCase()}`}
                      >
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    </Td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr
                style={{
                  background: 'var(--bg-muted)',
                  borderTop: '2px solid var(--border-color)',
                }}
              >
                <td colSpan={5} className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
                  Total Outstanding
                </td>
                <td
                  className="px-3 py-2 text-xs font-semibold num text-right"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {$(total)}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  )
}

function Th({
  children, align = 'left',
}: { children: React.ReactNode; align?: 'left' | 'right' }) {
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
  children, align = 'left', muted, mono, bold, nowrap,
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
