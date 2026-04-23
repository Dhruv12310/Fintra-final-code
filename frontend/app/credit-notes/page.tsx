'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { FileMinus, Plus, X, Loader2, CheckCircle, Send } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface Contact {
  id: string
  display_name: string
  email?: string
  contact_type: string
}

interface Account {
  id: string
  account_code: string
  account_name: string
  account_type: string
}

interface CreditLine {
  key: string
  line_number: number
  description: string
  quantity: number
  unit_price: number
  revenue_account_id: string
}

interface CreditNote {
  id: string
  credit_number: string
  credit_date: string
  status: 'draft' | 'posted' | 'applied' | 'void'
  reason?: string | null
  total: number
  amount_applied: number
  balance_remaining: number
  customer_id: string
  contacts?: { display_name: string; email?: string }
}

interface OpenInvoice {
  id: string
  invoice_number: string
  invoice_date: string
  balance_due: number
  customer_id: string
}

const $ = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

const fmtDate = (d?: string) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { bg: string; color: string }> = {
    draft:   { bg: 'rgba(148,163,184,0.12)', color: 'var(--text-muted)' },
    posted:  { bg: 'rgba(52,211,153,0.12)',  color: 'var(--positive)' },
    applied: { bg: 'rgba(99,102,241,0.12)',  color: '#818cf8' },
    void:    { bg: 'rgba(239,68,68,0.12)',   color: 'var(--negative)' },
  }
  const s = map[status] || map.draft
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase"
      style={{ background: s.bg, color: s.color, letterSpacing: '0.05em' }}
    >
      {status}
    </span>
  )
}

function newLine(num: number, accountId: string): CreditLine {
  return {
    key: `${Date.now()}-${Math.random()}`,
    line_number: num,
    description: '',
    quantity: 1,
    unit_price: 0,
    revenue_account_id: accountId,
  }
}

export default function CreditNotesPage() {
  const { company, loading: authLoading } = useAuth()
  const companyId = company?.id || null

  const [creditNotes, setCreditNotes] = useState<CreditNote[]>([])
  const [customers, setCustomers] = useState<Contact[]>([])
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)

  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const today = new Date().toISOString().split('T')[0]
  const [customerId, setCustomerId] = useState('')
  const [creditDate, setCreditDate] = useState(today)
  const [reason, setReason] = useState('')
  const [memo, setMemo] = useState('')
  const [lines, setLines] = useState<CreditLine[]>([])

  // Apply modal state
  const [applyModal, setApplyModal] = useState<CreditNote | null>(null)
  const [applyInvoices, setApplyInvoices] = useState<OpenInvoice[]>([])
  const [applyTarget, setApplyTarget] = useState('')
  const [applyAmount, setApplyAmount] = useState('')
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const [cns, contactsR, accountsR] = await Promise.all([
        api.get('/credit-notes/'),
        api.get('/contacts/'),
        api.get(`/accounts/company/${companyId}`),
      ])
      setCreditNotes(cns || [])
      setCustomers((contactsR || []).filter((c: Contact) => ['customer', 'both'].includes(c.contact_type)))
      setRevenueAccounts((accountsR || []).filter((a: Account) => a.account_type === 'revenue'))
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to load' })
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => {
    if (!authLoading && companyId) load()
  }, [authLoading, companyId, load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  function openForm() {
    setCustomerId('')
    setCreditDate(today)
    setReason('')
    setMemo('')
    const defaultAcct = revenueAccounts[0]?.id || ''
    setLines([newLine(1, defaultAcct)])
    setShowForm(true)
  }

  const total = useMemo(
    () => lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unit_price) || 0), 0),
    [lines]
  )

  async function save() {
    if (!customerId || lines.length === 0 || total <= 0) {
      setToast({ ok: false, msg: 'Customer, at least one line, and total > 0 are required' })
      return
    }
    setSaving(true)
    try {
      await api.post('/credit-notes/', {
        customer_id: customerId,
        credit_date: creditDate,
        reason: reason || null,
        memo: memo || null,
        lines: lines.map(l => ({
          line_number: l.line_number,
          description: l.description,
          quantity: l.quantity,
          unit_price: l.unit_price,
          amount: l.quantity * l.unit_price,
          revenue_account_id: l.revenue_account_id,
        })),
      })
      setShowForm(false)
      setToast({ ok: true, msg: 'Credit note created' })
      load()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to create' })
    } finally {
      setSaving(false)
    }
  }

  async function postCN(id: string) {
    setBusyId(id)
    try {
      await api.patch(`/credit-notes/${id}`, { status: 'posted' })
      setToast({ ok: true, msg: 'Posted to ledger' })
      load()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to post' })
    } finally {
      setBusyId(null)
    }
  }

  async function openApply(cn: CreditNote) {
    setApplyModal(cn)
    setApplyTarget('')
    setApplyAmount('')
    try {
      const all = await api.get('/invoices/')
      const open = (all || []).filter(
        (i: any) =>
          i.customer_id === cn.customer_id &&
          (i.status === 'sent' || i.status === 'posted') &&
          Number(i.balance_due || 0) > 0
      )
      setApplyInvoices(open)
    } catch {
      setApplyInvoices([])
    }
  }

  async function confirmApply() {
    if (!applyModal || !applyTarget) return
    const amt = Number(applyAmount)
    if (!amt || amt <= 0) {
      setToast({ ok: false, msg: 'Enter a positive amount' })
      return
    }
    setApplying(true)
    try {
      await api.post(`/credit-notes/${applyModal.id}/apply`, {
        invoice_id: applyTarget,
        amount_applied: amt,
      })
      setApplyModal(null)
      setToast({ ok: true, msg: 'Credit applied' })
      load()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to apply' })
    } finally {
      setApplying(false)
    }
  }

  if (!companyId && !authLoading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]" style={{ color: 'var(--text-muted)' }}>
        Complete onboarding to use credit notes.
      </div>
    )
  }

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-4">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FileMinus className="w-6 h-6" style={{ color: 'var(--accent)' }} />
          <div>
            <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Credit Notes</h1>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Reduce a customer's outstanding balance</p>
          </div>
        </div>
        <button
          onClick={openForm}
          className="flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg"
          style={{ background: 'var(--accent)', color: '#fff' }}
        >
          <Plus className="w-4 h-4" /> New credit note
        </button>
      </header>

      {toast && (
        <div
          className="px-3 py-2 rounded-lg text-sm"
          style={{
            background: toast.ok ? 'var(--positive-soft)' : 'var(--negative-soft)',
            color: toast.ok ? 'var(--positive)' : 'var(--negative)',
            border: '1px solid var(--border-color)',
          }}
        >
          {toast.msg}
        </div>
      )}

      <div
        className="rounded-lg overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
      >
        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-5 h-5 animate-spin inline" style={{ color: 'var(--text-muted)' }} /></div>
        ) : creditNotes.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No credit notes yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border-color)' }}>
                  {['Number', 'Date', 'Customer', 'Total', 'Applied', 'Remaining', 'Status', 'Actions'].map((h, i) => (
                    <th key={h}
                      className="text-[10px] uppercase font-semibold px-3 py-2"
                      style={{ color: 'var(--text-muted)', textAlign: i >= 3 && i <= 5 ? 'right' : i === 7 ? 'right' : 'left', letterSpacing: '0.06em' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {creditNotes.map(cn => (
                  <tr key={cn.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                    <td className="px-3 py-2 num" style={{ color: 'var(--text-primary)' }}>{cn.credit_number}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{fmtDate(cn.credit_date)}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-primary)' }}>{cn.contacts?.display_name || '—'}</td>
                    <td className="px-3 py-2 num text-right" style={{ color: 'var(--text-primary)' }}>{$(Number(cn.total))}</td>
                    <td className="px-3 py-2 num text-right" style={{ color: 'var(--text-muted)' }}>{$(Number(cn.amount_applied))}</td>
                    <td className="px-3 py-2 num text-right font-semibold" style={{ color: 'var(--text-primary)' }}>{$(Number(cn.balance_remaining))}</td>
                    <td className="px-3 py-2"><StatusBadge status={cn.status} /></td>
                    <td className="px-3 py-2 text-right">
                      {cn.status === 'draft' && (
                        <button
                          onClick={() => postCN(cn.id)}
                          disabled={busyId === cn.id}
                          className="text-xs px-2 py-1 rounded inline-flex items-center gap-1"
                          style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                        >
                          {busyId === cn.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />} Post
                        </button>
                      )}
                      {(cn.status === 'posted' || cn.status === 'applied') && Number(cn.balance_remaining) > 0 && (
                        <button
                          onClick={() => openApply(cn)}
                          className="text-xs px-2 py-1 rounded inline-flex items-center gap-1"
                          style={{ background: 'var(--accent-subtle)', color: 'var(--accent)', border: '1px solid var(--border-color)' }}
                        >
                          <CheckCircle className="w-3 h-3" /> Apply
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Create form modal */}
      {showForm && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-2xl rounded-xl p-5 space-y-4 max-h-[90vh] overflow-auto" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>New credit note</h2>
              <button onClick={() => setShowForm(false)}><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <Field label="Customer *">
                <select className="input" value={customerId} onChange={e => setCustomerId(e.target.value)}>
                  <option value="">Choose...</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.display_name}</option>)}
                </select>
              </Field>
              <Field label="Date">
                <input type="date" className="input" value={creditDate} onChange={e => setCreditDate(e.target.value)} />
              </Field>
              <Field label="Reason" full>
                <input className="input" placeholder="Return, discount, write-off..." value={reason} onChange={e => setReason(e.target.value)} />
              </Field>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs uppercase font-semibold" style={{ color: 'var(--text-muted)', letterSpacing: '0.06em' }}>Lines</span>
                <button
                  onClick={() => setLines([...lines, newLine(lines.length + 1, revenueAccounts[0]?.id || '')])}
                  className="text-xs px-2 py-1 rounded inline-flex items-center gap-1"
                  style={{ background: 'var(--bg-muted)', color: 'var(--text-primary)', border: '1px solid var(--border-color)' }}
                >
                  <Plus className="w-3 h-3" /> Add line
                </button>
              </div>
              {lines.map((l, idx) => (
                <div key={l.key} className="grid grid-cols-12 gap-2 items-center">
                  <input
                    className="input col-span-5"
                    placeholder="Description"
                    value={l.description}
                    onChange={e => setLines(lines.map((x, i) => i === idx ? { ...x, description: e.target.value } : x))}
                  />
                  <input
                    type="number" step="0.01" className="input col-span-2 text-right num"
                    value={l.quantity}
                    onChange={e => setLines(lines.map((x, i) => i === idx ? { ...x, quantity: Number(e.target.value) } : x))}
                  />
                  <input
                    type="number" step="0.01" className="input col-span-2 text-right num"
                    value={l.unit_price}
                    onChange={e => setLines(lines.map((x, i) => i === idx ? { ...x, unit_price: Number(e.target.value) } : x))}
                  />
                  <select
                    className="input col-span-2 text-xs"
                    value={l.revenue_account_id}
                    onChange={e => setLines(lines.map((x, i) => i === idx ? { ...x, revenue_account_id: e.target.value } : x))}
                  >
                    <option value="">Account...</option>
                    {revenueAccounts.map(a => <option key={a.id} value={a.id}>{a.account_code} {a.account_name}</option>)}
                  </select>
                  <button onClick={() => setLines(lines.filter((_, i) => i !== idx))} className="col-span-1 flex justify-center">
                    <X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} />
                  </button>
                </div>
              ))}
            </div>

            <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--border-color)' }}>
              <span className="text-sm" style={{ color: 'var(--text-muted)' }}>Total</span>
              <span className="text-lg font-semibold num" style={{ color: 'var(--text-primary)' }}>{$(total)}</span>
            </div>

            <div className="flex justify-end gap-2">
              <button onClick={() => setShowForm(false)} className="btn">Cancel</button>
              <button onClick={save} disabled={saving} className="btn btn-primary">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save draft'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Apply modal */}
      {applyModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4" style={{ background: 'rgba(0,0,0,0.6)' }}>
          <div className="w-full max-w-md rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Apply {applyModal.credit_number}</h2>
              <button onClick={() => setApplyModal(null)}><X className="w-4 h-4" style={{ color: 'var(--text-muted)' }} /></button>
            </div>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Remaining credit: <span className="num font-medium" style={{ color: 'var(--text-primary)' }}>{$(Number(applyModal.balance_remaining))}</span>
            </p>
            <Field label="Invoice">
              <select className="input" value={applyTarget} onChange={e => setApplyTarget(e.target.value)}>
                <option value="">Choose open invoice...</option>
                {applyInvoices.map(i => (
                  <option key={i.id} value={i.id}>
                    {i.invoice_number} - {fmtDate(i.invoice_date)} - {$(Number(i.balance_due))}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Amount to apply">
              <input
                type="number" step="0.01" className="input num"
                value={applyAmount}
                onChange={e => setApplyAmount(e.target.value)}
              />
            </Field>
            <div className="flex justify-end gap-2">
              <button onClick={() => setApplyModal(null)} className="btn">Cancel</button>
              <button onClick={confirmApply} disabled={applying || !applyTarget} className="btn btn-primary">
                {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Apply'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Field({ label, full, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <div className={`flex flex-col gap-1 ${full ? 'col-span-2' : ''}`}>
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </div>
  )
}
