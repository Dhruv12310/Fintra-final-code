'use client'
import PageHeader from '@/components/PageHeader'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Activity, Shield, RefreshCw, KeyRound, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import { api, API_BASE } from '@/lib/api'
import { supabase } from '@/lib/supabase'

type ActivityItem = {
  id: string
  direction: 'inbound' | 'outbound'
  method?: string
  path?: string
  status_code?: number
  duration_ms?: number
  actor_email?: string
  actor_role?: string
  created_at: string
}

type CompanyMember = {
  id: string
  full_name?: string
  email?: string
  role: 'owner' | 'admin' | 'accountant' | 'user' | 'viewer'
}

const ROLE_OPTIONS: CompanyMember['role'][] = ['owner', 'admin', 'accountant', 'user', 'viewer']

export default function AdminPanelPage() {
  const router = useRouter()
  const { user, loading: authLoading } = useAuth()
  const [activity, setActivity] = useState<ActivityItem[]>([])
  const [members, setMembers] = useState<CompanyMember[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filterDirection, setFilterDirection] = useState<'all' | 'inbound' | 'outbound'>('all')

  const canAccessAdmin = useMemo(
    () => ['owner', 'admin'].includes((user?.role || '').toLowerCase()),
    [user?.role]
  )

  const getAdminToken = () => localStorage.getItem('admin_session_token') || ''

  const adminFetch = useCallback(
    async (path: string, init?: RequestInit) => {
      if (!supabase) throw new Error('Supabase is not configured')
      const { data } = await supabase.auth.getSession()
      const accessToken = data.session?.access_token
      const adminToken = getAdminToken()
      if (!accessToken || !adminToken) {
        throw new Error('Missing admin session. Please login again.')
      }

      const response = await fetch(`${API_BASE}${path}`, {
        ...init,
        headers: {
          ...(init?.headers || {}),
          Authorization: `Bearer ${accessToken}`,
          'X-Admin-Session': adminToken,
          'Content-Type': 'application/json',
        },
      })

      if (!response.ok) {
        const err = await response.json().catch(() => ({}))
        throw new Error(err?.detail || `Request failed: ${response.status}`)
      }
      return response.json()
    },
    []
  )

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const currentAdminToken = getAdminToken()
      if (!currentAdminToken) {
        router.push('/admin/login')
        return
      }

      // validate admin token first
      await api.post('/admin/session/validate', { token: currentAdminToken })

      const directionQuery = filterDirection === 'all' ? '' : `&direction=${filterDirection}`
      const activityRes = await adminFetch(`/admin/activity?limit=100&offset=0${directionQuery}`)
      const membersRes = await api.get<{ data: CompanyMember[] }>('/users/manage/company-members')
      setActivity(activityRes.data || [])
      setMembers(membersRes.data || [])
    } catch (err: any) {
      const detail = err?.response?.data?.detail
      const message = detail || err?.message || 'Failed to load admin data'
      setError(message)
      if (message.toLowerCase().includes('admin session') || message.toLowerCase().includes('invalid')) {
        router.push('/admin/login')
      }
    } finally {
      setLoading(false)
    }
  }, [adminFetch, filterDirection, router])

  useEffect(() => {
    if (authLoading) return
    if (!canAccessAdmin) return
    loadData()
  }, [authLoading, canAccessAdmin, loadData])

  const updateRole = async (memberId: string, nextRole: CompanyMember['role']) => {
    try {
      await api.patch(`/users/manage/company-members/${memberId}/role`, { role: nextRole })
      await loadData()
    } catch (err: any) {
      setError(err?.response?.data?.detail || err?.message || 'Role update failed')
    }
  }

  const purgeOldLogs = async () => {
    try {
      await adminFetch('/admin/activity/purge', { method: 'POST', body: JSON.stringify({}) })
      await loadData()
    } catch (err: any) {
      setError(err?.message || 'Failed to purge old logs')
    }
  }

  if (!authLoading && !canAccessAdmin) {
    return (
      <div className="min-h-screen flex items-center justify-center p-8" style={{ backgroundColor: 'var(--bg-primary)' }}>
        <div className="text-center">
          <Shield className="w-14 h-14 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
          <h2 className="text-xl font-semibold mb-2" style={{ color: 'var(--text-primary)' }}>Admin Access Restricted</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Only owner and admin roles can access this panel.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6 space-y-6">
      <PageHeader
        title="Admin Panel"
        subtitle="Company-scoped administration, role controls, and activity logs."
        actions={
          <button onClick={loadData} className="btn">
            <RefreshCw className="w-4 h-4" /> Refresh
          </button>
        }
      />

      {error && (
        <div className="p-3 rounded-lg text-sm" style={{ color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)', backgroundColor: 'rgba(239,68,68,0.08)' }}>
          {error}
        </div>
      )}

      <section
        className="rounded-xl p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
            <Activity className="w-4 h-4" />
            Activity Logs
          </h2>
          <div className="flex items-center gap-2">
            <select
              value={filterDirection}
              onChange={(e) => setFilterDirection(e.target.value as 'all' | 'inbound' | 'outbound')}
              className="px-2 py-1 rounded"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            >
              <option value="all">All</option>
              <option value="inbound">Inbound</option>
              <option value="outbound">Outbound</option>
            </select>
            <button
              onClick={purgeOldLogs}
              className="px-3 py-1 rounded text-sm"
              style={{ border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
            >
              Purge 30d+
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ color: 'var(--text-muted)' }}>
                <th className="text-left py-2">Time</th>
                <th className="text-left py-2">Direction</th>
                <th className="text-left py-2">Method</th>
                <th className="text-left py-2">Path</th>
                <th className="text-left py-2">Status</th>
                <th className="text-left py-2">Actor</th>
              </tr>
            </thead>
            <tbody>
              {activity.map((item) => (
                <tr key={item.id} style={{ borderTop: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  <td className="py-2">{new Date(item.created_at).toLocaleString()}</td>
                  <td className="py-2">{item.direction}</td>
                  <td className="py-2">{item.method || '-'}</td>
                  <td className="py-2">{item.path || '-'}</td>
                  <td className="py-2">{item.status_code ?? '-'}</td>
                  <td className="py-2">{item.actor_email || item.actor_role || '-'}</td>
                </tr>
              ))}
              {!loading && activity.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-3 text-center" style={{ color: 'var(--text-muted)' }}>
                    No activity logs found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section
        className="rounded-xl p-4 space-y-3"
        style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
      >
        <h2 className="font-semibold" style={{ color: 'var(--text-primary)' }}>Company Members & Roles</h2>
        <div className="space-y-2">
          {members.map((member) => (
            <div
              key={member.id}
              className="flex items-center justify-between p-2 rounded"
              style={{ border: '1px solid var(--border-color)' }}
            >
              <div>
                <p style={{ color: 'var(--text-primary)' }}>{member.full_name || member.email || member.id}</p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{member.email}</p>
              </div>
              <select
                value={member.role}
                onChange={(e) => updateRole(member.id, e.target.value as CompanyMember['role'])}
                className="px-2 py-1 rounded"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
              >
                {ROLE_OPTIONS.map((role) => (
                  <option key={role} value={role}>{role}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </section>

      <PermissionsSection />
    </div>
  )
}


// ─── Permission overrides ─────────────────────────────────────────────────

interface PermOverride {
  id: string
  role_name: string
  subject: string
  action: string
  allowed: boolean
}

interface PermResponse {
  subjects: string[]
  actions: string[]
  defaults: Record<string, { subject: string; action: string }[]>
  overrides: PermOverride[]
}

const PERM_ROLES = ['admin', 'accountant', 'user', 'viewer']

function PermissionsSection() {
  const [data, setData] = useState<PermResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [role, setRole] = useState('accountant')
  const [subject, setSubject] = useState('')
  const [action, setAction] = useState('')
  const [allowed, setAllowed] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const r = await api.get<PermResponse>('/admin/permissions')
      setData(r)
      if (!subject) setSubject(r.subjects[0])
      if (!action) setAction(r.actions[0])
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to load permissions')
    } finally {
      setLoading(false)
    }
  }, [subject, action])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  async function add() {
    if (!subject || !action) return
    setSaving(true)
    try {
      await api.put('/admin/permissions', { role_name: role, subject, action, allowed })
      load()
    } catch (e: any) {
      setErr(e?.response?.data?.detail || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  async function remove(o: PermOverride) {
    try {
      await fetch(
        `${process.env.NEXT_PUBLIC_API_BASE || ''}/admin/permissions?role_name=${o.role_name}&subject=${encodeURIComponent(o.subject)}&action=${encodeURIComponent(o.action)}`,
        { method: 'DELETE', credentials: 'include' }
      )
      load()
    } catch {
      load()
    }
  }

  return (
    <section
      className="rounded-xl p-4 space-y-3"
      style={{ backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
    >
      <h2 className="font-semibold flex items-center gap-2" style={{ color: 'var(--text-primary)' }}>
        <KeyRound className="w-4 h-4" />
        Permission Overrides
      </h2>
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Per-role grants or denials on top of the default ability matrix. Overrides apply only to this company.
      </p>

      {err && (
        <div className="p-2 rounded text-xs"
          style={{ color: 'var(--negative)', border: '1px solid var(--border-color)', background: 'var(--negative-soft)' }}>
          {err}
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
            <div className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Role</span>
              <select className="input" value={role} onChange={e => setRole(e.target.value)}>
                {PERM_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Subject</span>
              <select className="input" value={subject} onChange={e => setSubject(e.target.value)}>
                {data.subjects.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>Action</span>
              <select className="input" value={action} onChange={e => setAction(e.target.value)}>
                {data.actions.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>State</span>
              <select className="input" value={allowed ? 'allow' : 'deny'} onChange={e => setAllowed(e.target.value === 'allow')}>
                <option value="allow">Allow</option>
                <option value="deny">Deny</option>
              </select>
            </div>
            <button onClick={add} disabled={saving} className="btn btn-primary h-[34px]">
              <Plus className="w-4 h-4" /> Save
            </button>
          </div>

          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border-color)' }}>
                  {['Role', 'Subject', 'Action', 'State', ''].map(h => (
                    <th key={h} className="text-[10px] uppercase font-semibold px-3 py-2 text-left"
                      style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.overrides.length === 0 ? (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                    No overrides. Default tier abilities apply.
                  </td></tr>
                ) : (
                  data.overrides.map(o => (
                    <tr key={o.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td className="px-3 py-2 capitalize" style={{ color: 'var(--text-primary)' }}>{o.role_name}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{o.subject}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{o.action}</td>
                      <td className="px-3 py-2">
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold uppercase"
                          style={{
                            background: o.allowed ? 'var(--positive-soft)' : 'var(--negative-soft)',
                            color: o.allowed ? 'var(--positive)' : 'var(--negative)',
                          }}>
                          {o.allowed ? 'allow' : 'deny'}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <button onClick={() => remove(o)} title="Remove">
                          <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  )
}
