'use client'

import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/PageHeader'
import { AlertTriangle, CheckCircle, XCircle, Clock, RefreshCw, Bell, BellOff } from 'lucide-react'
import { api } from '@/lib/api'

interface Alert {
  id: string
  trigger_name: string
  severity: 'info' | 'warning' | 'critical'
  title: string
  body: string
  related_entity_type?: string
  related_entity_id?: string
  action_payload?: Record<string, any>
  status: 'open' | 'accepted' | 'dismissed' | 'snoozed'
  created_at: string
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: 'var(--accent)',
  warning: '#f59e0b',
  info: 'var(--accent)',
}

const TRIGGER_LABELS: Record<string, string> = {
  duplicate_bill: 'Duplicate Bill',
  anomaly_txn: 'Anomaly',
  overdue_invoice: 'Overdue Invoice',
}

function SeverityIcon({ severity }: { severity: string }) {
  const color = SEVERITY_COLORS[severity] || 'var(--text-muted)'
  if (severity === 'critical') return <AlertTriangle size={16} style={{ color }} />
  if (severity === 'warning') return <AlertTriangle size={16} style={{ color }} />
  return <Bell size={16} style={{ color }} />
}

function AlertCard({ alert, onAction, isDismissed }: { alert: Alert; onAction: () => void; isDismissed?: boolean }) {
  const [loading, setLoading] = useState(false)
  const color = isDismissed ? 'var(--border-color)' : (SEVERITY_COLORS[alert.severity] || 'var(--accent)')

  async function act(status: string) {
    setLoading(true)
    try {
      await api.post(`/alerts/${alert.id}/action`, { status })
      onAction()
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  const hasDunning = alert.trigger_name === 'overdue_invoice' && alert.action_payload?.customer_email
  const hasBillHold = alert.trigger_name === 'duplicate_bill'
  const emailSentAt = alert.action_payload?.email_sent_at

  return (
    <div
      className="rounded-lg p-4 flex flex-col gap-2"
      style={{
        background: 'var(--bg-card)',
        border: `1px solid ${color}33`,
        borderLeft: `3px solid ${color}`,
        opacity: isDismissed ? 0.75 : 1,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-2 min-w-0">
          <SeverityIcon severity={alert.severity} />
          <div className="min-w-0">
            <p className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>
              {alert.title}
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {TRIGGER_LABELS[alert.trigger_name] || alert.trigger_name} ·{' '}
              {new Date(alert.created_at).toLocaleDateString()}
            </p>
          </div>
        </div>
      </div>

      {alert.body && (
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
          {alert.body}
        </p>
      )}

      {!isDismissed && hasDunning && alert.action_payload?.email_body && (
        <pre
          className="text-xs p-3 rounded overflow-auto max-h-48"
          style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', fontFamily: 'inherit', whiteSpace: 'pre-wrap' }}
        >
          {alert.action_payload.email_body}
        </pre>
      )}

      {isDismissed ? (
        <div className="flex items-center gap-1.5 text-xs mt-1"
          style={{ color: emailSentAt ? 'var(--neon-emerald)' : 'var(--text-muted)' }}>
          {emailSentAt ? (
            <>
              <CheckCircle size={11} />
              Reminder email sent on {new Date(emailSentAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </>
          ) : (
            <>
              <XCircle size={11} />
              Dismissed
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
          {hasDunning ? (
            <button
              onClick={() => act('accepted')}
              disabled={loading}
              className="btn btn-primary btn-xs"
            >
              <CheckCircle size={12} />
              Send Email
            </button>
          ) : hasBillHold ? (
            <button
              onClick={() => act('accepted')}
              disabled={loading}
              className="btn btn-primary btn-xs"
            >
              <CheckCircle size={12} />
              Release &amp; Post
            </button>
          ) : null}

          <button
            onClick={() => act('dismissed')}
            disabled={loading}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded font-medium"
            style={{ background: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}
          >
            <XCircle size={12} />
            Dismiss
          </button>

          <button
            onClick={() => act('snoozed')}
            disabled={loading}
            className="flex items-center gap-1 text-xs px-3 py-1.5 rounded"
            style={{ color: 'var(--text-muted)' }}
          >
            <Clock size={12} />
            Snooze
          </button>
        </div>
      )}
    </div>
  )
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [filter, setFilter] = useState<'open' | 'dismissed'>('open')

  const load = useCallback(async () => {
    try {
      const data = await api.get<Alert[]>('/alerts', { status: filter })
      setAlerts(data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => { load() }, [load])

  async function runSentinel() {
    setRunning(true)
    try {
      await api.post('/alerts/run-sentinel')
      await load()
    } catch (e) {
      console.error(e)
    } finally {
      setRunning(false)
    }
  }

  const critical = alerts.filter(a => a.severity === 'critical').length
  const warning = alerts.filter(a => a.severity === 'warning').length

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <PageHeader
        title="Alerts"
        subtitle="Proactive GL intelligence — duplicates, anomalies, AR reminders"
        actions={<>
          {(critical > 0 || warning > 0) && (
            <div className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium"
              style={{ background: critical > 0 ? 'var(--accent-subtle)' : 'rgba(245,158,11,0.1)', color: critical > 0 ? 'var(--accent)' : '#f59e0b' }}>
              <AlertTriangle size={12} />
              {critical > 0 ? `${critical} critical` : `${warning} warnings`}
            </div>
          )}
          <button onClick={runSentinel} disabled={running} className="btn btn-secondary btn-sm">
            <RefreshCw size={12} className={running ? 'animate-spin' : ''} />
            {running ? 'Scanning…' : 'Run Scan'}
          </button>
        </>}
      />

      <div className="flex gap-2 mb-4">
        {(['open', 'dismissed'] as const).map(f => (
          <button
            key={f}
            onClick={() => { setFilter(f); setLoading(true) }}
            className="text-xs px-3 py-1.5 rounded capitalize"
            style={{
              background: filter === f ? 'var(--accent)22' : 'var(--bg-card)',
              color: filter === f ? 'var(--accent)' : 'var(--text-muted)',
              border: `1px solid ${filter === f ? 'var(--accent)' : 'var(--border-color)'}`,
            }}
          >
            {f}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-24 rounded-lg animate-pulse" style={{ background: 'var(--bg-card)' }} />
          ))}
        </div>
      ) : alerts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3"
          style={{ color: 'var(--text-muted)' }}>
          <BellOff size={32} />
          <p className="text-sm">No {filter} alerts</p>
          {filter === 'open' && (
            <button onClick={runSentinel} disabled={running}
              className="text-xs px-3 py-1.5 rounded mt-1"
              style={{ background: 'var(--accent)22', color: 'var(--accent)', border: '1px solid var(--accent)33' }}>
              Run a scan
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {alerts.map(alert => (
            <AlertCard key={alert.id} alert={alert} onAction={load} isDismissed={filter === 'dismissed'} />
          ))}
        </div>
      )}
    </div>
  )
}
