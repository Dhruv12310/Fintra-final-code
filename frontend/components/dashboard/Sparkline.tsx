'use client'

interface Props {
  values: number[]
  color?: string
  width?: number
  height?: number
  strokeWidth?: number
  fill?: boolean
}

export function Sparkline({
  values,
  color = 'var(--accent)',
  width = 120,
  height = 36,
  strokeWidth = 1.5,
  fill = true,
}: Props) {
  if (!values || values.length < 2) {
    return <div style={{ width, height }} />
  }

  const min = Math.min(...values)
  const max = Math.max(...values)
  const range = max - min || 1
  const stepX = width / (values.length - 1)
  const padY = strokeWidth + 2

  const points = values.map((v, i) => {
    const x = i * stepX
    const y = height - padY - ((v - min) / range) * (height - padY * 2)
    return [x, y] as const
  })

  const path = points
    .map(([x, y], i) => (i === 0 ? `M ${x.toFixed(2)} ${y.toFixed(2)}` : `L ${x.toFixed(2)} ${y.toFixed(2)}`))
    .join(' ')

  const fillPath = fill
    ? `${path} L ${(width).toFixed(2)} ${height} L 0 ${height} Z`
    : ''

  const gradId = `sparkline-grad-${Math.random().toString(36).slice(2, 9)}`

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ overflow: 'visible', display: 'block' }}
    >
      {fill && (
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
      )}
      {fill && <path d={fillPath} fill={`url(#${gradId})`} />}
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r={2.2}
        fill={color}
      />
    </svg>
  )
}
