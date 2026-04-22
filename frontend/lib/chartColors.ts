export function getCSSVar(name: string, fallback = '#3b82f6'): string {
  if (typeof window === 'undefined') return fallback
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
}

/**
 * Professional finance-SaaS palette. Inspired by Ramp / Stripe Dashboard / Mercury /
 * Linear. Single accent, muted data-viz colors, no neon, no high-saturation hues.
 *
 * Semantic convention:
 *   - revenue / positive : emerald-500  #10b981
 *   - expenses           : slate-400    #94a3b8   (NEUTRAL — pro UIs do not flag
 *                                                  expenses in red; only real issues
 *                                                  like overdue or negative cash.)
 *   - accent / profit    : blue-500     #3b82f6
 *   - danger (overdue)   : red-500      #ef4444
 *   - warning            : amber-500    #f59e0b
 */
export function getChartColors() {
  return {
    revenue:  '#10b981',
    expenses: '#94a3b8',
    accent:   '#3b82f6',
    grid:     'rgba(148,163,184,0.08)',
    text:     '#64748b',
    positive: '#10b981',
    negative: '#ef4444',
    warning:  '#f59e0b',
    orange:   '#f97316',
    danger:   '#ef4444',
    neutral:  '#94a3b8',
  }
}
