'use client'

import { useEffect, useMemo, useRef } from 'react'

interface CashFlowRow {
  short: string
  inflows: number
  outflows: number
  net: number
}

interface Props {
  data: CashFlowRow[] | null
  height?: number
}

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(n)

function readCssVar(name: string, fallback: string) {
  if (typeof window === 'undefined') return fallback
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function CashFlowWaterfall({ data, height = 220 }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)

  const summary = useMemo(() => {
    if (!data || data.length === 0) return null
    const totalIn = data.reduce((s, r) => s + (r.inflows || 0), 0)
    const totalOut = data.reduce((s, r) => s + (r.outflows || 0), 0)
    const closing = totalIn - totalOut
    return { totalIn, totalOut, closing }
  }, [data])

  useEffect(() => {
    if (!ref.current || !summary) return
    let disposed = false
    let resizeObs: ResizeObserver | null = null

    ;(async () => {
      const echarts = await import('echarts/core')
      const { BarChart } = await import('echarts/charts')
      const {
        GridComponent,
        TooltipComponent,
        DatasetComponent,
        TransformComponent,
      } = await import('echarts/components')
      const { CanvasRenderer } = await import('echarts/renderers')
      echarts.use([
        BarChart,
        GridComponent,
        TooltipComponent,
        DatasetComponent,
        TransformComponent,
        CanvasRenderer,
      ])

      if (disposed || !ref.current) return

      const positive = readCssVar('--positive', '#10b981')
      const negative = readCssVar('--negative', '#ef4444')
      const textMuted = readCssVar('--text-muted', '#94a3b8')
      const textPrimary = readCssVar('--text-primary', '#0f172a')
      const border = readCssVar('--border-color', '#e2e8f0')
      const cardBg = readCssVar('--bg-card', '#ffffff')

      const opening = 0
      const inflows = summary.totalIn
      const outflows = summary.totalOut
      const closing = summary.closing

      const labels = ['Opening', 'Inflows', 'Outflows', 'Closing']
      const placeholder = [
        0,
        opening,
        opening + inflows - outflows,
        0,
      ]
      const values = [opening, inflows, outflows, closing]
      const colors = [
        textMuted,
        positive,
        negative,
        closing >= 0 ? positive : negative,
      ]

      const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' })
      chartRef.current = chart

      chart.setOption({
        animation: true,
        animationDuration: 600,
        animationEasing: 'cubicOut',
        grid: { left: 8, right: 16, top: 16, bottom: 24, containLabel: true },
        tooltip: {
          trigger: 'axis',
          axisPointer: { type: 'shadow' },
          backgroundColor: cardBg,
          borderColor: border,
          borderWidth: 1,
          padding: [8, 10],
          textStyle: { color: textPrimary, fontSize: 12 },
          formatter: (params: any) => {
            const idx = params?.[0]?.dataIndex ?? 0
            const label = labels[idx]
            const value = values[idx]
            const sign = idx === 2 ? '-' : idx === 1 ? '+' : ''
            return `<div style="font-weight:600;margin-bottom:2px">${label}</div>
                    <div style="color:${colors[idx]}">${sign}${$(value)}</div>`
          },
        },
        xAxis: {
          type: 'category',
          data: labels,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: border } },
          axisLabel: { color: textMuted, fontSize: 11 },
        },
        yAxis: {
          type: 'value',
          axisLine: { show: false },
          axisTick: { show: false },
          splitLine: { lineStyle: { color: border, opacity: 0.5 } },
          axisLabel: {
            color: textMuted,
            fontSize: 11,
            formatter: (v: number) =>
              Math.abs(v) >= 1000
                ? `$${(v / 1000).toFixed(0)}K`
                : `$${v}`,
          },
        },
        series: [
          {
            name: 'placeholder',
            type: 'bar',
            stack: 'wf',
            silent: true,
            itemStyle: { color: 'transparent' },
            emphasis: { itemStyle: { color: 'transparent' } },
            data: placeholder,
            barWidth: '42%',
          },
          {
            name: 'value',
            type: 'bar',
            stack: 'wf',
            barWidth: '42%',
            label: {
              show: true,
              position: 'top',
              color: textPrimary,
              fontSize: 11,
              fontWeight: 600,
              formatter: (p: any) => $(values[p.dataIndex]),
            },
            itemStyle: {
              borderRadius: [3, 3, 0, 0],
              color: (p: any) => colors[p.dataIndex] as string,
            },
            data: values,
          },
        ],
      })

      resizeObs = new ResizeObserver(() => chart.resize())
      resizeObs.observe(ref.current)
    })()

    return () => {
      disposed = true
      resizeObs?.disconnect()
      chartRef.current?.dispose?.()
      chartRef.current = null
    }
  }, [summary])

  if (!data) {
    return (
      <div
        className="animate-pulse rounded"
        style={{ height, background: 'var(--bg-muted)' }}
      />
    )
  }

  if (!summary || (summary.totalIn === 0 && summary.totalOut === 0)) {
    return (
      <div
        className="flex items-center justify-center text-sm"
        style={{ height, color: 'var(--text-muted)' }}
      >
        No cash movement in the last 6 months
      </div>
    )
  }

  return <div ref={ref} style={{ width: '100%', height }} />
}
