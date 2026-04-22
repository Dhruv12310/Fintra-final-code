'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, HardHat, ChevronRight, TrendingUp, AlertCircle } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface Project {
  id: string
  name: string
  project_number?: string
  contract_value: number
  estimated_total_costs: number
  retention_pct: number
  status: string
  start_date?: string
  end_date?: string
  contacts?: { display_name: string }
}

interface WipEntry {
  period_end: string
  pct_complete: number
  earned_revenue: number
  billed_revenue: number
  over_under_billing: number
  costs_to_date: number
}

const $ = (n: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(n)

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    active: 'var(--neon-emerald)',
    completed: 'var(--neon-cyan)',
    cancelled: 'var(--text-muted)',
  }
  return (
    <span className="text-xs px-2 py-0.5 rounded-full capitalize"
      style={{ background: `${colors[status] || 'var(--text-muted)'}22`, color: colors[status] || 'var(--text-muted)' }}>
      {status}
    </span>
  )
}

function ProjectCard({ project }: { project: Project }) {
  const [wip, setWip] = useState<WipEntry[]>([])
  const latest = wip[0]
  const pct = latest?.pct_complete ?? 0
  const overUnder = latest?.over_under_billing ?? 0

  useEffect(() => {
    api.get<WipEntry[]>(`/projects/${project.id}/wip`)
      .then(d => setWip(d || []))
      .catch(() => {})
  }, [project.id])

  return (
    <div className="rounded-lg p-4 flex flex-col gap-3"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <HardHat size={14} style={{ color: 'var(--neon-cyan)', flexShrink: 0 }} />
            <span className="font-medium text-sm truncate" style={{ color: 'var(--text-primary)' }}>
              {project.name}
            </span>
            {project.project_number && (
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>#{project.project_number}</span>
            )}
          </div>
          {project.contacts?.display_name && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {project.contacts.display_name}
            </p>
          )}
        </div>
        <StatusBadge status={project.status} />
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded px-2 py-1.5" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Contract</p>
          <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            {$(project.contract_value)}
          </p>
        </div>
        <div className="rounded px-2 py-1.5" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>% Complete</p>
          <p className="text-sm font-semibold" style={{ color: 'var(--neon-cyan)' }}>
            {pct.toFixed(0)}%
          </p>
        </div>
        <div className="rounded px-2 py-1.5" style={{ background: 'var(--bg-secondary)' }}>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {overUnder >= 0 ? 'Under-billed' : 'Over-billed'}
          </p>
          <p className="text-sm font-semibold"
            style={{ color: overUnder >= 0 ? 'var(--neon-emerald)' : 'var(--neon-fuchsia)' }}>
            {$(Math.abs(overUnder))}
          </p>
        </div>
      </div>

      {pct > 0 && (
        <div>
          <div className="flex justify-between text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
            <span>Progress</span>
            <span>{pct.toFixed(1)}%</span>
          </div>
          <div className="h-1.5 rounded-full" style={{ background: 'var(--border-color)' }}>
            <div className="h-full rounded-full transition-all"
              style={{ width: `${Math.min(pct, 100)}%`, background: 'var(--neon-cyan)' }} />
          </div>
        </div>
      )}

      {project.retention_pct > 0 && (
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Retention: {project.retention_pct}%
        </p>
      )}
    </div>
  )
}

function NewProjectModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', project_number: '', contract_value: '', estimated_total_costs: '', retention_pct: '0', start_date: '', end_date: ''
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function save() {
    if (!form.name || !form.contract_value || !form.estimated_total_costs) {
      setError('Name, contract value, and estimated cost are required.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.post('/projects', {
        name: form.name,
        project_number: form.project_number || undefined,
        contract_value: parseFloat(form.contract_value),
        estimated_total_costs: parseFloat(form.estimated_total_costs),
        retention_pct: parseFloat(form.retention_pct || '0'),
        start_date: form.start_date || undefined,
        end_date: form.end_date || undefined,
      })
      onCreated()
      onClose()
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Failed to create project')
    } finally {
      setSaving(false)
    }
  }

  const field = (label: string, key: keyof typeof form, type = 'text', placeholder = '') => (
    <div>
      <label className="block text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{label}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(p => ({ ...p, [key]: e.target.value }))}
        placeholder={placeholder}
        className="w-full text-sm rounded px-3 py-2 outline-none"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}
      />
    </div>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
      <div className="w-full max-w-md rounded-xl p-6 flex flex-col gap-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <h2 className="font-semibold text-lg" style={{ color: 'var(--text-primary)' }}>New Project</h2>

        {field('Project Name *', 'name', 'text', 'e.g. Main St. Office Renovation')}
        {field('Project Number', 'project_number', 'text', 'e.g. P-2026-001')}

        <div className="grid grid-cols-2 gap-3">
          {field('Contract Value *', 'contract_value', 'number', '0')}
          {field('Estimated Total Cost *', 'estimated_total_costs', 'number', '0')}
        </div>
        <div className="grid grid-cols-2 gap-3">
          {field('Retention %', 'retention_pct', 'number', '0')}
          {field('Start Date', 'start_date', 'date')}
        </div>

        {error && <p className="text-xs" style={{ color: 'var(--neon-fuchsia)' }}>{error}</p>}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded"
            style={{ color: 'var(--text-muted)', border: '1px solid var(--border-color)' }}>
            Cancel
          </button>
          <button onClick={save} disabled={saving} className="text-sm px-4 py-2 rounded font-medium"
            style={{ background: 'var(--neon-cyan)', color: '#000' }}>
            {saving ? 'Saving…' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default function ProjectsPage() {
  const { company } = useAuth()
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  const industry = (company as any)?.industry || ''
  const isConstruction = industry === 'Construction'

  const load = useCallback(async () => {
    try {
      const data = await api.get<Project[]>('/projects')
      setProjects(data || [])
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>Projects</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            WIP schedules, retention tracking, and job-cost rollups
          </p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-2 text-sm px-4 py-2 rounded-lg font-medium"
          style={{ background: 'var(--neon-cyan)', color: '#000' }}>
          <Plus size={14} />
          New Project
        </button>
      </div>

      {!isConstruction && (
        <div className="mb-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm"
          style={{ background: 'var(--neon-cyan)11', border: '1px solid var(--neon-cyan)33', color: 'var(--neon-cyan)' }}>
          <TrendingUp size={14} />
          Projects and WIP tracking are optimized for Construction. Set your company industry to Construction for full vertical close support.
        </div>
      )}

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-40 rounded-lg animate-pulse" style={{ background: 'var(--bg-card)' }} />
          ))}
        </div>
      ) : projects.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-24 gap-3" style={{ color: 'var(--text-muted)' }}>
          <HardHat size={40} />
          <p className="text-sm">No projects yet</p>
          <button onClick={() => setShowNew(true)}
            className="text-xs px-3 py-1.5 rounded mt-1"
            style={{ background: 'var(--neon-cyan)22', color: 'var(--neon-cyan)', border: '1px solid var(--neon-cyan)33' }}>
            Create your first project
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {projects.map(p => <ProjectCard key={p.id} project={p} />)}
        </div>
      )}

      {showNew && <NewProjectModal onClose={() => setShowNew(false)} onCreated={load} />}
    </div>
  )
}
