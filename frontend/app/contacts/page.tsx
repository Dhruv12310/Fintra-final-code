'use client'
import PageHeader from '@/components/PageHeader'

import { useState, useEffect, useMemo } from 'react'
import {
  Users, Loader2, Plus, X, Search, MoreHorizontal,
  ArrowUp, ArrowDown, ArrowUpDown, Mail, Phone,
  Building2, User, Edit2, Trash2,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

function TypeBadge({ type }: { type: string }) {
  const cls: Record<string, string> = {
    customer: 'badge badge-info',
    vendor:   'badge badge-purple',
    both:     'badge badge-success',
  }
  return <span className={`${cls[type] || cls.customer} capitalize`}>{type}</span>
}

export default function ContactsPage() {
  const { company, loading: authLoading } = useAuth()
  const companyId = company?.id || null

  const [contacts, setContacts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)

  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [sortField, setSortField] = useState('display_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const [showModal, setShowModal] = useState(false)
  const [editContact, setEditContact] = useState<any>(null)
  const [form, setForm] = useState({ display_name: '', contact_type: 'customer', email: '', phone: '', address: '', notes: '' })
  const [saving, setSaving] = useState(false)
  const [menuOpen, setMenuOpen] = useState<string | null>(null)

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    fetchContacts()
  }, [companyId])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    const close = () => setMenuOpen(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  const fetchContacts = async () => {
    setLoading(true)
    const data = await api.get('/contacts/').catch(() => [])
    setContacts(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  const openCreate = () => {
    setEditContact(null)
    setForm({ display_name: '', contact_type: 'customer', email: '', phone: '', address: '', notes: '' })
    setShowModal(true)
  }

  const openEdit = (c: any) => {
    setEditContact(c)
    setForm({ display_name: c.display_name || '', contact_type: c.contact_type || 'customer', email: c.email || '', phone: c.phone || '', address: c.address || '', notes: c.notes || '' })
    setShowModal(true)
    setMenuOpen(null)
  }

  const handleSave = async () => {
    if (!form.display_name.trim()) { setToast({ ok: false, msg: 'Name is required.' }); return }
    setSaving(true)
    try {
      const payload = Object.fromEntries(Object.entries(form).filter(([, v]) => v !== ''))
      if (editContact) {
        await api.patch(`/contacts/${editContact.id}`, payload)
        setToast({ ok: true, msg: 'Contact updated.' })
      } else {
        await api.post('/contacts/', payload)
        setToast({ ok: true, msg: 'Contact created.' })
      }
      setShowModal(false)
      await fetchContacts()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to save contact.' })
    } finally { setSaving(false) }
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return
    try {
      await api.delete(`/contacts/${id}`)
      setToast({ ok: true, msg: `"${name}" deleted.` })
      await fetchContacts()
    } catch {
      setToast({ ok: false, msg: 'Cannot delete — contact may have linked invoices or bills.' })
    }
    setMenuOpen(null)
  }

  const typeCounts = useMemo(() => {
    const c: Record<string, number> = { all: contacts.length, customer: 0, vendor: 0, both: 0 }
    contacts.forEach(ct => { c[ct.contact_type] = (c[ct.contact_type] || 0) + 1 })
    return c
  }, [contacts])

  const filtered = useMemo(() => {
    let r = [...contacts]
    if (typeFilter !== 'all') r = r.filter(c => c.contact_type === typeFilter)
    if (debouncedSearch) {
      const q = debouncedSearch.toLowerCase()
      r = r.filter(c =>
        (c.display_name || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q)
      )
    }
    r.sort((a, b) => {
      const av = (a[sortField] || '').toLowerCase()
      const bv = (b[sortField] || '').toLowerCase()
      if (av === bv) return 0
      return (av < bv ? -1 : 1) * (sortDir === 'asc' ? 1 : -1)
    })
    return r
  }, [contacts, typeFilter, debouncedSearch, sortField, sortDir])

  const sortToggle = (field: string) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const SortIcon = ({ field }: { field: string }) => {
    if (sortField !== field) return <ArrowUpDown className="w-3 h-3 opacity-40" />
    return sortDir === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />
  }

  if (loading) return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex gap-1.5">
        {[0,1,2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full animate-pulse"
            style={{ backgroundColor: 'var(--accent)', animationDelay: `${i*0.15}s` }} />
        ))}
      </div>
    </div>
  )

  if (!companyId && !authLoading) return (
    <div className="empty-state">
      <div className="empty-state-icon"><Users className="h-5 w-5" /></div>
      <p className="empty-state-title">No company set up</p>
      <p className="empty-state-desc">Complete onboarding to manage contacts.</p>
      <a href="/onboarding" className="btn btn-primary btn-sm mt-4">Complete onboarding</a>
    </div>
  )

  return (
    <div className="min-h-screen p-6 space-y-6">

      <PageHeader
        eyebrow="CRM"
        title="Contacts"
        subtitle="Manage your customers and vendors"
        actions={<button onClick={openCreate} className="btn btn-primary btn-sm"><Plus className="w-4 h-4" /> New Contact</button>}
      />

      {/* Toast */}
      {toast && (
        <div className="px-4 py-3 rounded-lg text-sm font-medium" style={{
          backgroundColor: toast.ok ? 'rgba(52,211,153,0.1)' : 'rgba(239,68,68,0.1)',
          border: `1px solid ${toast.ok ? 'rgba(52,211,153,0.3)' : 'rgba(239,68,68,0.3)'}`,
          color: toast.ok ? 'var(--success)' : 'var(--neon-red)',
        }}>
          {toast.msg}
        </div>
      )}

      {/* Contact List */}
      <div className="panel overflow-hidden">

        {/* Type tabs */}
        <div className="flex items-center gap-1 px-4 pt-3 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-color)' }}>
          {[
            { key: 'all', label: 'All' },
            { key: 'customer', label: 'Customers' },
            { key: 'vendor', label: 'Vendors' },
            { key: 'both', label: 'Both' },
          ].map(tab => {
            const active = typeFilter === tab.key
            const count = typeCounts[tab.key] || 0
            return (
              <button key={tab.key} onClick={() => setTypeFilter(tab.key)}
                className="relative shrink-0 px-3 py-2 text-sm font-medium transition-all"
                style={{
                  color: active ? 'var(--accent)' : 'var(--text-muted)',
                  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
                  marginBottom: '-1px',
                }}>
                {tab.label}
                {count > 0 && (
                  <span className="ml-1.5 px-1.5 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor: active ? 'var(--accent-subtle)' : 'var(--bg-muted)',
                      color: active ? 'var(--accent)' : 'var(--text-muted)',
                    }}>
                    {count}
                  </span>
                )}
              </button>
            )
          })}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-3 px-4 py-3" style={{ borderBottom: '1px solid var(--border-color)' }}>
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: 'var(--text-muted)' }} />
            <input
              className="input input-sm pl-9"
              placeholder="Search by name, email, phone…" value={search} onChange={e => setSearch(e.target.value)}
            />
          </div>
          {(search || typeFilter !== 'all') && (
            <button onClick={() => { setSearch(''); setTypeFilter('all') }} className="btn btn-ghost btn-sm">
              Clear
            </button>
          )}
          <span className="ml-auto text-xs" style={{ color: 'var(--text-muted)' }}>
            {filtered.length} {filtered.length === 1 ? 'contact' : 'contacts'}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Users className="w-12 h-12 mx-auto mb-3" style={{ color: 'var(--text-muted)' }} />
            {contacts.length === 0 ? (
              <>
                <p className="text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>No contacts yet</p>
                <p className="text-sm mb-4" style={{ color: 'var(--text-secondary)' }}>Add your first customer or vendor to get started.</p>
                <button onClick={openCreate} className="btn btn-primary btn-sm">
                  <Plus className="w-4 h-4" /> New Contact
                </button>
              </>
            ) : (
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>No contacts match your search.</p>
            )}
          </div>
        ) : (
          <>
            {/* Table header */}
            <div className="grid items-center px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
              style={{ gridTemplateColumns: '1.5fr 1fr 1fr 120px 80px 48px', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
              <button className="flex items-center gap-1 text-left hover:opacity-80 transition" onClick={() => sortToggle('display_name')}>
                Name <SortIcon field="display_name" />
              </button>
              <button className="flex items-center gap-1 text-left hover:opacity-80 transition" onClick={() => sortToggle('email')}>
                Email <SortIcon field="email" />
              </button>
              <div>Phone</div>
              <div>Type</div>
              <div>Actions</div>
              <div />
            </div>

            {filtered.map(contact => (
              <div key={contact.id} className="grid items-center px-4 py-3.5 transition"
                style={{ gridTemplateColumns: '1.5fr 1fr 1fr 120px 80px 48px', borderBottom: '1px solid var(--border-color)' }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.backgroundColor = 'var(--bg-muted)'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.backgroundColor = ''}>
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-semibold shrink-0 text-white"
                    style={{ backgroundColor: 'var(--accent)' }}>
                    {contact.display_name?.[0]?.toUpperCase() || '?'}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{contact.display_name}</p>
                    {contact.address && <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{contact.address}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {contact.email ? (
                    <>
                      <Mail className="w-3 h-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm truncate" style={{ color: 'var(--text-secondary)' }}>{contact.email}</span>
                    </>
                  ) : <span className="text-sm" style={{ color: 'var(--text-muted)' }}>—</span>}
                </div>
                <div className="flex items-center gap-1.5">
                  {contact.phone ? (
                    <>
                      <Phone className="w-3 h-3 shrink-0" style={{ color: 'var(--text-muted)' }} />
                      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{contact.phone}</span>
                    </>
                  ) : <span className="text-sm" style={{ color: 'var(--text-muted)' }}>—</span>}
                </div>
                <TypeBadge type={contact.contact_type} />
                <div className="flex items-center gap-1">
                  <button onClick={() => openEdit(contact)}
                    className="btn btn-ghost btn-icon btn-xs" title="Edit">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => handleDelete(contact.id, contact.display_name)}
                    className="btn btn-ghost btn-icon btn-xs" title="Delete">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div />
              </div>
            ))}
          </>
        )}
      </div>

      {/* ══ CREATE / EDIT MODAL ══ */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)' }}
          onClick={e => { if (e.target === e.currentTarget) setShowModal(false) }}>
          <div className="w-full max-w-lg panel">
            <div className="flex items-center justify-between px-6 py-4" style={{ borderBottom: '1px solid var(--border-color)' }}>
              <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
                {editContact ? 'Edit Contact' : 'New Contact'}
              </h2>
              <button onClick={() => setShowModal(false)} style={{ color: 'var(--text-muted)' }}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-4">
              {/* Type selector */}
              <div>
                <label className="label">Type</label>
                <div className="flex gap-2">
                  {['customer', 'vendor', 'both'].map(t => (
                    <button key={t} onClick={() => setForm(f => ({ ...f, contact_type: t }))}
                      className="flex-1 btn btn-sm capitalize"
                      style={form.contact_type === t ? {
                        backgroundColor: 'var(--accent-subtle)',
                        borderColor: 'var(--accent)',
                        color: 'var(--accent)',
                      } : {}}>
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="label">Display name <span style={{ color: 'var(--neon-red)' }}>*</span></label>
                <input className="input" placeholder="Company or person name" value={form.display_name} onChange={e => setForm(f => ({ ...f, display_name: e.target.value }))} />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" placeholder="email@example.com" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" placeholder="+1 (555) 000-0000" value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="label">Address</label>
                <input className="input" placeholder="Street, City, State, ZIP" value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} />
              </div>

              <div>
                <label className="label">Notes</label>
                <textarea rows={2} className="textarea" style={{ resize: 'none' }}
                  placeholder="Internal notes (not visible to contact)"
                  value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
            </div>

            <div className="flex items-center justify-end gap-3 px-6 py-4" style={{ borderTop: '1px solid var(--border-color)' }}>
              <button onClick={() => setShowModal(false)} className="btn btn-secondary btn-sm">Cancel</button>
              <button onClick={handleSave} disabled={saving || !form.display_name.trim()} className="btn btn-primary btn-sm">
                {saving ? <span className="flex items-center gap-1.5"><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</span> : (editContact ? 'Save changes' : 'Create contact')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
