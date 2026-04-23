'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

interface MonthlyRow {
  month: string
  label: string
  short: string
  revenue: number
  expenses: number
  net: number
}

type Range = '3M' | '6M' | 'YTD' | '12M' | 'ALL'

interface Props {
  monthlyData: MonthlyRow[]
  height?: number
  defaultRange?: Range
}

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

const RANGES: { key: Range; label: string }[] = [
  { key: '3M', label: '3M' },
  { key: '6M', label: '6M' },
  { key: 'YTD', label: 'YTD' },
  { key: '12M', label: '12M' },
  { key: 'ALL', label: 'All' },
]

function readVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

function monthFirstDay(monthKey: string): string {
  if (monthKey.length === 7) return `${monthKey}-01`
  return monthKey
}

export function HeroRevenueChart({ monthlyData, height = 240, defaultRange = '12M' }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)
  const seriesRef = useRef<{ rev: any; exp: any } | null>(null)
  const [range, setRange] = useState<Range>(defaultRange)
  const [hoverPoint, setHoverPoint] = useState<{
    label: string
    revenue: number
    expenses: number
  } | null>(null)

  const filtered = useMemo(() => {
    if (!monthlyData?.length) return []
    if (range === 'ALL') return monthlyData
    const now = new Date()
    const cutoff = new Date(now.getFullYear(), now.getMonth(), 1)
    if (range === 'YTD') cutoff.setMonth(0)
    else if (range === '3M') cutoff.setMonth(now.getMonth() - 2)
    else if (range === '6M') cutoff.setMonth(now.getMonth() - 5)
    else if (range === '12M') cutoff.setMonth(now.getMonth() - 11)
    const cutoffKey = `${cutoff.getFullYear()}-${String(cutoff.getMonth() + 1).padStart(2, '0')}`
    return monthlyData.filter(m => m.month >= cutoffKey)
  }, [monthlyData, range])

  const totals = useMemo(() => {
    const rev = filtered.reduce((s, r) => s + (r.revenue || 0), 0)
    const exp = filtered.reduce((s, r) => s + (r.expenses || 0), 0)
    return { rev, exp, net: rev - exp }
  }, [filtered])

  useEffect(() => {
    if (!ref.current) return
    let disposed = false

    ;(async () => {
      const lib: any = await import('lightweight-charts')
      if (disposed || !ref.current) return

      const accent = readVar('--accent', '#2563eb')
      const positive = readVar('--positive', '#10b981')
      const negative = readVar('--negative', '#ef4444')
      const border = readVar('--border-color', '#e2e8f0')
      const textMuted = readVar('--text-muted', '#94a3b8')
      const cardBg = readVar('--bg-card', '#ffffff')

      const chart = lib.createChart(ref.current, {
        width: ref.current.clientWidth,
        height,
        layout: {
          background: { color: 'transparent' },
          textColor: textMuted,
          fontFamily: "'DM Sans', system-ui, sans-serif",
          fontSize: 11,
          attributionLogo: false,
        },
        grid: {
          horzLines: { color: border, style: 0 },
          vertLines: { color: 'transparent' },
        },
        rightPriceScale: {
          borderColor: 'transparent',
          scaleMargins: { top: 0.15, bottom: 0.05 },
        },
        timeScale: {
          borderColor: 'transparent',
          timeVisible: false,
          secondsVisible: false,
          fixLeftEdge: true,
          fixRightEdge: true,
        },
        crosshair: {
          mode: 1,
          vertLine: { color: textMuted, width: 1, style: 2, labelVisible: false },
          horzLine: { color: textMuted, width: 1, style: 2, labelVisible: false },
        },
        handleScroll: false,
        handleScale: false,
      })
      chartRef.current = chart

      // v5 API: chart.addSeries(SeriesType, options)
      // v4 fallback: chart.addAreaSeries(options) / chart.addLineSeries(options)
      const c = chart as any
      const areaOpts = {
        topColor: hexToRgba(positive, 0.28),
        bottomColor: hexToRgba(positive, 0.02),
        lineColor: positive,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: cardBg,
        crosshairMarkerBackgroundColor: positive,
      }
      const lineOpts = {
        color: negative,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        lineStyle: 2,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: cardBg,
        crosshairMarkerBackgroundColor: negative,
      }

      const revSeries = lib.AreaSeries
        ? c.addSeries(lib.AreaSeries, areaOpts)
        : c.addAreaSeries(areaOpts)
      const expSeries = lib.LineSeries
        ? c.addSeries(lib.LineSeries, lineOpts)
        : c.addLineSeries(lineOpts)

      seriesRef.current = { rev: revSeries, exp: expSeries }

      const labelByTime = new Map<string, string>()
      const revData = filtered.map(r => {
        const time = monthFirstDay(r.month)
        labelByTime.set(time, r.label || r.short)
        return { time, value: r.revenue || 0 }
      })
      const expData = filtered.map(r => ({
        time: monthFirstDay(r.month),
        value: r.expenses || 0,
      }))

      revSeries.setData(revData)
      expSeries.setData(expData)
      chart.timeScale().fitContent()

      chart.subscribeCrosshairMove((p: any) => {
        if (!p?.time || !p?.seriesData) {
          setHoverPoint(null)
          return
        }
        const r = p.seriesData.get(revSeries) as any
        const e = p.seriesData.get(expSeries) as any
        setHoverPoint({
          label: labelByTime.get(String(p.time)) || String(p.time),
          revenue: r?.value ?? 0,
          expenses: e?.value ?? 0,
        })
      })

      const ro = new ResizeObserver(() => {
        if (ref.current) chart.applyOptions({ width: ref.current.clientWidth })
      })
      ro.observe(ref.current)

      return () => {
        ro.disconnect()
      }
    })()

    return () => {
      disposed = true
      try { chartRef.current?.remove() } catch {}
      chartRef.current = null
      seriesRef.current = null
    }
  }, [filtered, height])

  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex flex-col gap-1">
          <p
            className="font-semibold uppercase"
            style={{ color: 'var(--text-muted)', fontSize: 10.5, letterSpacing: '0.08em' }}
          >
            Revenue
          </p>
          <div className="flex items-baseline gap-3">
            <span
              className="num-display"
              style={{ color: 'var(--text-primary)', fontSize: 26, lineHeight: 1.1 }}
            >
              {$(hoverPoint?.revenue ?? totals.rev)}
            </span>
            <span
              className="text-xs"
              style={{ color: 'var(--text-muted)' }}
            >
              {hoverPoint ? hoverPoint.label : `vs ${$(totals.exp)} expenses`}
            </span>
          </div>
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--positive)' }} />
              Revenue
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ background: 'var(--negative)' }} />
              Expenses
            </span>
          </div>
        </div>

        <div
          className="inline-flex items-center rounded-md"
          style={{
            background: 'var(--bg-muted)',
            border: '1px solid var(--border-color)',
            padding: 2,
            height: 28,
          }}
        >
          {RANGES.map(r => {
            const active = r.key === range
            return (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className="text-xs font-medium transition-colors rounded"
                style={{
                  background: active ? 'var(--bg-card)' : 'transparent',
                  color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                  border: active ? '1px solid var(--border-color)' : '1px solid transparent',
                  padding: '0 9px',
                  height: 22,
                  boxShadow: active ? 'var(--shadow-xs)' : 'none',
                }}
              >
                {r.label}
              </button>
            )
          })}
        </div>
      </div>

      <div ref={ref} style={{ width: '100%', height }} />
      <div ref={tooltipRef} />
    </div>
  )
}

function hexToRgba(hex: string, alpha: number): string {
  const v = hex.trim()
  if (v.startsWith('rgb')) {
    if (v.startsWith('rgba')) return v
    return v.replace('rgb(', 'rgba(').replace(')', `, ${alpha})`)
  }
  const h = v.replace('#', '')
  const norm = h.length === 3 ? h.split('').map(c => c + c).join('') : h
  const r = parseInt(norm.slice(0, 2), 16)
  const g = parseInt(norm.slice(2, 4), 16)
  const b = parseInt(norm.slice(4, 6), 16)
  if ([r, g, b].some(Number.isNaN)) return `rgba(37,99,235,${alpha})`
  return `rgba(${r},${g},${b},${alpha})`
}
