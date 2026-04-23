'use client'
import PageHeader from '@/components/PageHeader'

import { useState, useEffect, useCallback } from 'react'
import { Plug, RefreshCw, Unlink, CheckCircle2, AlertCircle, Clock, ExternalLink, Loader2, Download, Briefcase, Users, PieChart, type LucideIcon } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface Integration {
  id: string
  provider: string
  status: 'active' | 'pending' | 'error' | 'disconnected'
  last_sync_at: string | null
  connected_at: string
}

const PROVIDER_META: Record<string, { label: string; logo: LucideIcon; description: string; color: string }> = {
  quickbooks: {
    label: 'QuickBooks Online',
    logo: Briefcase,
    description: 'Import your chart of accounts, customers, vendors, invoices & bills from QBO.',
    color: 'var(--accent-subtle)',
  },
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { cls: string; label: string }> = {
    active:       { cls: 'badge badge-success', label: 'Connected' },
    pending:      { cls: 'badge badge-warning',  label: 'Pending' },
    error:        { cls: 'badge badge-danger',   label: 'Error' },
    disconnected: { cls: 'badge badge-neutral',  label: 'Disconnected' },
  }
  const m = map[status] || map.disconnected
  return <span className={m.cls}>{m.label}</span>
}

function fmtDate(d: string | null) {
  if (!d) return '—'
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function IntegrationsPage() {
  const { company } = useAuth()
  const [integrations, setIntegrations] = useState<Integration[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [connecting, setConnecting] = useState<string | null>(null)
  const [disconnecting, setDisconnecting] = useState<string | null>(null)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)

  const showToast = (ok: boolean, msg: string) => {
    setToast({ ok, msg })
    setTimeout(() => setToast(null), 4000)
  }

  const load = useCallback(async () => {
    try {
      const res = await api.get('/integrations')
      setIntegrations(res.data || [])
    } catch {
      // ignore
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const connectedProviders = new Set(integrations.filter(i => i.status === 'active').map(i => i.provider))

  const handleConnect = async (provider: string) => {
    setConnecting(provider)
    try {
      const res = await api.post(`/integrations/${provider}/connect`)
      const authUrl: string = res.data.auth_url
      // Open OAuth popup
      const popup = window.open(authUrl, `${provider}_oauth`, 'width=600,height=700,scrollbars=yes')
      // Poll for popup close
      const poll = setInterval(() => {
        if (popup?.closed) {
          clearInterval(poll)
          setConnecting(null)
          load()
          showToast(true, `${provider} connected! You can now import your data.`)
        }
      }, 500)
    } catch (e: any) {
      showToast(false, e?.response?.data?.detail || 'Failed to start OAuth flow')
      setConnecting(null)
    }
  }

  const handleSync = async (provider: string) => {
    setSyncing(provider)
    try {
      const res = await api.post(`/integrations/${provider}/sync`)
      const total = Object.values(res.data.results || {}).reduce((s: number, v: any) => s + (v.synced || 0), 0)
      showToast(true, `Sync complete — ${total} records updated.`)
      load()
    } catch (e: any) {
      showToast(false, e?.response?.data?.detail || 'Sync failed')
    } finally {
      setSyncing(null)
    }
  }

  const handleImport = async (provider: string) => {
    setImporting(true)
    try {
      const res = await api.post(`/integrations/${provider === 'quickbooks' ? 'quickbooks/import' : `${provider}/sync`}`)
      showToast(true, res.data.message || 'Import complete.')
      load()
    } catch (e: any) {
      showToast(false, e?.response?.data?.detail || 'Import failed')
    } finally {
      setImporting(false)
    }
  }

  const handleDisconnect = async (provider: string) => {
    if (!confirm(`Disconnect ${provider}? Your imported data will remain, but syncing will stop.`)) return
    setDisconnecting(provider)
    try {
      await api.delete(`/integrations/${provider}/disconnect`)
      showToast(true, `${provider} disconnected.`)
      load()
    } catch (e: any) {
      showToast(false, e?.response?.data?.detail || 'Disconnect failed')
    } finally {
      setDisconnecting(null)
    }
  }

  const card: React.CSSProperties = {
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: 16,
    padding: 24,
  }

  return (
    <div style={{ padding: '32px 32px 48px', maxWidth: 900 }}>
      <PageHeader
        title="Integrations"
        subtitle="Connect your existing tools. Fintra imports your data and keeps it in sync — so you can manage everything in one place."
      />

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
          <Loader2 size={24} style={{ color: 'var(--accent)', animation: 'spin 1s linear infinite' }} />
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* QuickBooks */}
          <ProviderCard
            provider="quickbooks"
            meta={PROVIDER_META.quickbooks}
            connection={integrations.find(i => i.provider === 'quickbooks')}
            isConnected={connectedProviders.has('quickbooks')}
            connecting={connecting === 'quickbooks'}
            syncing={syncing === 'quickbooks'}
            importing={importing}
            disconnecting={disconnecting === 'quickbooks'}
            onConnect={() => handleConnect('quickbooks')}
            onSync={() => handleSync('quickbooks')}
            onImport={() => handleImport('quickbooks')}
            onDisconnect={() => handleDisconnect('quickbooks')}
          />

          {/* Coming Soon cards */}
          <ComingSoonCard
            logo={Users}
            label="Payroll Module"
            description="Run payroll, manage employees, and auto-journal payroll entries — built natively into Fintra."
            badge="Coming in Phase 4"
          />
          <ComingSoonCard
            logo={PieChart}
            label="Cap Table & Equity"
            description="Track founders, employees, and investors. Manage option grants and vesting schedules."
            badge="Coming in Phase 4"
          />
        </div>
      )}

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 9999,
          backgroundColor: toast.ok ? 'var(--success-subtle)' : 'rgba(244,63,94,0.1)',
          border: `1px solid ${toast.ok ? 'rgba(62,207,142,0.4)' : 'rgba(244,63,94,0.3)'}`,
          color: toast.ok ? 'var(--success)' : 'var(--neon-red)',
          padding: '12px 20px', borderRadius: 12, fontSize: 14, fontWeight: 500,
          display: 'flex', alignItems: 'center', gap: 8, maxWidth: 360,
        }}>
          {toast.ok ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </div>
  )
}

function ProviderCard({ provider, meta, connection, isConnected, connecting, syncing, importing, disconnecting, onConnect, onSync, onImport, onDisconnect }: {
  provider: string
  meta: typeof PROVIDER_META[string]
  connection?: Integration
  isConnected: boolean
  connecting: boolean
  syncing: boolean
  importing: boolean
  disconnecting: boolean
  onConnect: () => void
  onSync: () => void
  onImport: () => void
  onDisconnect: () => void
}) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: 16,
      padding: 24,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 20,
    }}>
      {/* Logo */}
      <div style={{
        width: 52, height: 52, borderRadius: 14,
        backgroundColor: meta.color,
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <meta.logo size={22} style={{ color: 'var(--accent)' }} />
      </div>

      {/* Info */}
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{meta.label}</span>
          {isConnected && <StatusBadge status="active" />}
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: '0 0 12px' }}>{meta.description}</p>

        {isConnected && connection && (
          <div style={{ display: 'flex', gap: 16, fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={12} /> Last sync: {fmtDate(connection.last_sync_at)}
            </span>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              Connected: {fmtDate(connection.connected_at)}
            </span>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {!isConnected ? (
            <button
              onClick={onConnect}
              disabled={connecting}
              style={{
                padding: '8px 18px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)',
                border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', gap: 6,
                opacity: connecting ? 0.6 : 1,
              }}
            >
              {connecting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Plug size={14} />}
              {connecting ? 'Connecting…' : `Connect ${meta.label}`}
            </button>
          ) : (
            <>
              <button
                onClick={onImport}
                disabled={importing}
                style={{
                  padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)',
                  border: '1px solid var(--accent)', display: 'flex', alignItems: 'center', gap: 6,
                  opacity: importing ? 0.6 : 1,
                }}
              >
                {importing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Download size={13} />}
                {importing ? 'Importing…' : 'Full Import'}
              </button>
              <button
                onClick={onSync}
                disabled={syncing}
                style={{
                  padding: '8px 16px', borderRadius: 10, fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  backgroundColor: 'var(--success-subtle)', color: 'var(--success)',
                  border: '1px solid rgba(62,207,142,0.25)', display: 'flex', alignItems: 'center', gap: 6,
                  opacity: syncing ? 0.6 : 1,
                }}
              >
                {syncing ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <RefreshCw size={13} />}
                {syncing ? 'Syncing…' : 'Sync Now'}
              </button>
              <button
                onClick={onDisconnect}
                disabled={disconnecting}
                style={{
                  padding: '8px 14px', borderRadius: 10, fontSize: 13, fontWeight: 500, cursor: 'pointer',
                  backgroundColor: 'rgba(244,63,94,0.08)', color: 'var(--neon-red)',
                  border: '1px solid rgba(244,63,94,0.2)', display: 'flex', alignItems: 'center', gap: 6,
                  opacity: disconnecting ? 0.6 : 1,
                }}
              >
                {disconnecting ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Unlink size={13} />}
                Disconnect
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function ComingSoonCard({ logo: Logo, label, description, badge }: {
  logo: LucideIcon; label: string; description: string; badge: string
}) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-card)',
      border: '1px solid var(--border-color)',
      borderRadius: 16,
      padding: 24,
      display: 'flex',
      alignItems: 'flex-start',
      gap: 20,
      opacity: 0.6,
    }}>
      <div style={{
        width: 52, height: 52, borderRadius: 14,
        backgroundColor: 'var(--bg-muted)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
      }}>
        <Logo size={22} style={{ color: 'var(--text-muted)' }} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
          <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>{label}</span>
          <span className="badge badge-neutral">{badge}</span>
        </div>
        <p style={{ color: 'var(--text-secondary)', fontSize: 13, margin: 0 }}>{description}</p>
      </div>
    </div>
  )
}
