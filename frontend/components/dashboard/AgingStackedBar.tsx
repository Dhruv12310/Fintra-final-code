'use client'

import { useState } from 'react'

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

interface AgingData {
  total_outstanding?: number
  total_overdue?: number
  buckets?: Record<string, { label?: string; count?: number; total?: number }>
}

interface FlatAging {
  current?: number
  days_1_30?: number
  days_31_60?: number
  days_61_90?: number
  days_90_plus?: number
}

interface Props {
  data: AgingData | FlatAging
  emptyLabel?: string
}

const SEGMENTS = [
  { key: 'current',  flatKey: 'current',       label: 'Current',    color: 'var(--positive)' },
  { key: '1_30',     flatKey: 'days_1_30',     label: '1\u201330 days',   color: '#f59e0b' },
  { key: '31_60',    flatKey: 'days_31_60',    label: '31\u201360 days',  color: '#f97316' },
  { key: '61_90',    flatKey: 'days_61_90',    label: '61\u201390 days',  color: '#ef4444' },
  { key: 'over_90',  flatKey: 'days_90_plus',  label: '90+ days',   color: '#b91c1c' },
] as const

export function AgingStackedBar({ data, emptyLabel = 'No outstanding balance' }: Props) {
  const [hovered, setHovered] = useState<string | null>(null)

  const isRich = !!(data as AgingData)?.buckets
  const rows = SEGMENTS.map(seg => {
    const bucket = isRich ? (data as AgingData).buckets?.[seg.key] : null
    const total = isRich
      ? Number(bucket?.total ?? 0)
      : Number(((data as any)[seg.flatKey] ?? 0))
    const count = isRich ? Number(bucket?.count ?? 0) : null
    return { ...seg, total, count }
  })

  const grandTotal = isRich
    ? Number((data as AgingData).total_outstanding ?? rows.reduce((s, r) => s + r.total, 0))
    : rows.reduce((s, r) => s + r.total, 0)

  const overdue = isRich
    ? Number((data as AgingData).total_overdue ?? 0)
    : rows.filter(r => r.key !== 'current').reduce((s, r) => s + r.total, 0)

  if (grandTotal <= 0) {
    return (
      <div className="flex flex-col items-center justify-center py-10 gap-2">
        <div className="w-2 h-2 rounded-full" style={{ background: 'var(--positive)' }} />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{emptyLabel}</p>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between">
        <div className="flex items-baseline gap-2">
          <span
            className="num-display"
            style={{ color: 'var(--text-primary)', fontSize: 22, lineHeight: 1.1 }}
          >
            {$(grandTotal)}
          </span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            outstanding
          </span>
        </div>
        {overdue > 0 && (
          <span
            className="text-xs font-medium num"
            style={{ color: 'var(--negative)' }}
          >
            {$(overdue)} overdue
          </span>
        )}
      </div>

      <div
        className="flex h-2.5 w-full rounded-full overflow-hidden"
        style={{ background: 'var(--bg-muted)' }}
      >
        {rows.map(r => {
          const pct = grandTotal > 0 ? (r.total / grandTotal) * 100 : 0
          if (pct <= 0) return null
          const isHover = hovered === r.key
          return (
            <div
              key={r.key}
              onMouseEnter={() => setHovered(r.key)}
              onMouseLeave={() => setHovered(null)}
              style={{
                width: `${pct}%`,
                background: r.color,
                opacity: hovered && !isHover ? 0.45 : 1,
                transition: 'opacity 0.15s ease, width 0.5s ease',
                cursor: 'pointer',
              }}
              aria-label={`${r.label}: ${$(r.total)}`}
            />
          )
        })}
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 pt-1">
        {rows.map(r => {
          const pct = grandTotal > 0 ? (r.total / grandTotal) * 100 : 0
          const dim = hovered && hovered !== r.key
          return (
            <div
              key={r.key}
              onMouseEnter={() => setHovered(r.key)}
              onMouseLeave={() => setHovered(null)}
              className="flex items-center justify-between text-xs"
              style={{ opacity: dim ? 0.45 : 1, transition: 'opacity 0.15s ease' }}
            >
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ background: r.color }}
                />
                <span className="truncate" style={{ color: 'var(--text-secondary)' }}>
                  {r.label}
                </span>
                {r.count !== null && r.count > 0 && (
                  <span style={{ color: 'var(--text-muted)' }}>({r.count})</span>
                )}
              </div>
              <span className="num font-medium" style={{ color: 'var(--text-primary)' }}>
                {$(r.total)}{' '}
                <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>
                  {pct.toFixed(0)}%
                </span>
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
