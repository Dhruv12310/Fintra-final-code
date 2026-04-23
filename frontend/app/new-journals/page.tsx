'use client'
import PageHeader from '@/components/PageHeader'

import { useState, useEffect } from 'react'
import {
  Plus,
  Upload,
  X,
  Check,
  FileText,
  Loader2,
  AlertCircle,
  Trash2
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface JournalLine {
  id: string
  accountId: string
  accountName: string
  description: string
  debit: number | ''
  credit: number | ''
}

interface JournalEntry {
  id?: string
  date: string
  memo: string
  referenceNumber: string
  lines: JournalLine[]
  attachedFile?: File
  status: 'draft' | 'posted'
}

const createEmptyEntry = (): JournalEntry => ({
  date: new Date().toISOString().split('T')[0],
  memo: '',
  referenceNumber: '',
  lines: [],
  status: 'draft'
})

export default function NewJournals() {
  const { company, loading: authLoading } = useAuth()
  const companyId = company?.id || null
  const [isCreating, setIsCreating] = useState(false)
  const [journalEntry, setJournalEntry] = useState<JournalEntry>(createEmptyEntry())
  const [isOCRProcessing, setIsOCRProcessing] = useState(false)
  const [accounts, setAccounts] = useState<any[]>([])
  const [recentJournals, setRecentJournals] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [toast, setToast] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const resetEntry = () => setJournalEntry(createEmptyEntry())

  useEffect(() => {
    if (!companyId) { setLoading(false); return }
    fetchAccounts(companyId)
    fetchRecentJournals(companyId)
  }, [companyId])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(timer)
  }, [toast])

  const fetchAccounts = async (targetCompanyId: string) => {
    try {
      const response = await api.get(`/accounts/company/${targetCompanyId}`)
      setAccounts(response.map((acc: any) => ({
        id: acc.id, code: acc.account_code, name: acc.account_name, type: acc.account_type
      })))
    } catch (error) { console.error('Failed to fetch accounts:', error) }
  }

  const fetchRecentJournals = async (targetCompanyId: string) => {
    try {
      setLoading(true)
      setRecentJournals(await api.get(`/journals/company/${targetCompanyId}?limit=10`))
    } catch (error) { console.error('Failed to fetch journals:', error) }
    finally { setLoading(false) }
  }

  const addLine = () => {
    setJournalEntry({ ...journalEntry, lines: [...journalEntry.lines, {
      id: Date.now().toString(), accountId: '', accountName: '', description: '', debit: 0, credit: 0
    }]})
  }

  const updateLine = (lineId: string, field: string, value: any) => {
    setJournalEntry({ ...journalEntry, lines: journalEntry.lines.map(line => {
      if (line.id !== lineId) return line
      if (field === 'accountId') {
        const account = accounts.find(a => a.id === value)
        return { ...line, accountId: value, accountName: account?.name || '' }
      }
      if (field === 'debit') {
        const v = value === '' ? '' : Number(value)
        return { ...line, debit: v, credit: v ? 0 : line.credit }
      }
      if (field === 'credit') {
        const v = value === '' ? '' : Number(value)
        return { ...line, credit: v, debit: v ? 0 : line.debit }
      }
      return { ...line, [field]: value }
    })})
  }

  const removeLine = (lineId: string) => {
    setJournalEntry({ ...journalEntry, lines: journalEntry.lines.filter(l => l.id !== lineId) })
  }

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setIsOCRProcessing(true)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const response = await api.postFormData<{
        parsed_fields: { vendor?: string; date?: string; total?: string; amount?: number; memo?: string; invoice_number?: string }
      }>('/parse/', formData)
      const pf = response?.parsed_fields || {}
      const amount = typeof pf.amount === 'number' ? pf.amount : (typeof pf.total === 'string' ? parseFloat(pf.total.replace(/[,$]/g, '')) || 0 : 0)
      const dateNorm = pf.date ? (pf.date.includes('-') && pf.date.length >= 10 ? pf.date : (() => {
        const parts = pf.date!.split(/[/-]/)
        const [m, d, y] = parts
        if (!y) return journalEntry.date
        const yy = y.length === 2 ? `20${y}` : y
        return `${yy}-${(m || '').padStart(2, '0')}-${(d || '').padStart(2, '0')}`
      })()) : journalEntry.date
      setJournalEntry({ ...journalEntry, memo: pf.memo || pf.vendor || '', referenceNumber: pf.invoice_number || '', date: dateNorm, attachedFile: file, lines: [
        { id: Date.now().toString(), accountId: '', accountName: '', description: pf.vendor || 'Expense', debit: 0, credit: amount },
        { id: (Date.now() + 1).toString(), accountId: '', accountName: '', description: 'Cash payment', debit: amount, credit: 0 }
      ]})
      setIsCreating(true)
    } catch (error) {
      console.error('OCR processing failed:', error)
      setToast({ type: 'error', message: 'Failed to process document. Please try again.' })
    } finally { setIsOCRProcessing(false) }
  }

  const calculateTotals = () => {
    const totalDebit = journalEntry.lines.reduce((s, l) => s + (Number(l.debit) || 0), 0)
    const totalCredit = journalEntry.lines.reduce((s, l) => s + (Number(l.credit) || 0), 0)
    return { totalDebit, totalCredit }
  }

  const isBalanced = () => {
    const { totalDebit, totalCredit } = calculateTotals()
    return Math.abs(totalDebit - totalCredit) < 0.01 && totalDebit > 0
  }

  const saveJournalEntry = async (postImmediately = false) => {
    if (!companyId) { setToast({ type: 'error', message: 'Company not ready yet.' }); return }
    if (!isBalanced()) { setToast({ type: 'error', message: 'Journal entry must be balanced (debits = credits)' }); return }
    if (journalEntry.lines.some(l => !l.accountId)) { setToast({ type: 'error', message: 'Please select accounts for every line.' }); return }
    try {
      setSaving(true)
      await api.post('/journals/', {
        company_id: companyId,
        entry_date: journalEntry.date,
        memo: journalEntry.memo,
        reference: journalEntry.referenceNumber,
        lines: journalEntry.lines.map(l => ({
          account_id: l.accountId,
          debit: Number(l.debit) || 0,
          credit: Number(l.credit) || 0,
          description: l.description || undefined
        }))
      })
      setToast({ type: 'success', message: postImmediately ? 'Journal entry posted successfully.' : 'Journal draft saved.' })
      setIsCreating(false)
      resetEntry()
      fetchRecentJournals(companyId)
    } catch (error: any) {
      const detail = error?.response?.data?.detail
      setToast({ type: 'error', message: typeof detail === 'string' ? detail : 'Failed to save journal entry.' })
    } finally { setSaving(false) }
  }

  const deleteJournalEntry = async (journalId: string) => {
    if (!companyId) return
    if (!confirm('Delete this journal entry? This will reverse the account balances.')) return
    try {
      await api.delete(`/journals/${journalId}`)
      setToast({ type: 'success', message: 'Journal entry deleted.' })
      fetchRecentJournals(companyId)
    } catch (error: any) {
      const detail = error?.response?.data?.detail
      setToast({ type: 'error', message: typeof detail === 'string' ? detail : 'Failed to delete journal entry.' })
    }
  }

  const { totalDebit, totalCredit } = calculateTotals()
  const balanced = isBalanced()

  if (!companyId && !authLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] p-8 text-center">
        <div className="empty-state">
          <div className="empty-state-icon"><FileText className="w-5 h-5" /></div>
          <p className="empty-state-title">No company set up yet</p>
          <p className="empty-state-desc">Finish onboarding to use journals.</p>
          <a href="/onboarding" className="btn btn-primary btn-sm mt-4">Complete onboarding</a>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen p-6 space-y-6">

      <PageHeader
        eyebrow="Accounting"
        title="Journal Entries"
        subtitle="Build double-entry transactions manually or from documents"
        actions={<>
          <label className="btn btn-secondary cursor-pointer">
            <Upload className="w-4 h-4" /> Upload Receipt
            <input type="file" accept="image/*,application/pdf" onChange={handleFileUpload} className="hidden" disabled={isOCRProcessing} />
          </label>
          <button onClick={() => setIsCreating(true)} className="btn btn-primary">
            <Plus className="w-4 h-4" /> New Entry
          </button>
        </>}
      />

      {/* Toast */}
      {toast && (
        <div className="px-4 py-3 rounded-lg text-sm font-medium" style={{
          backgroundColor: toast.type === 'success' ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)',
          border: `1px solid ${toast.type === 'success' ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}`,
          color: toast.type === 'success' ? 'var(--success)' : 'var(--neon-red)',
        }}>
          {toast.message}
        </div>
      )}

      {/* OCR Processing Indicator */}
      {isOCRProcessing && (
        <div className="card-flat p-4 flex items-center gap-3">
          <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Processing document…</p>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Extracting transaction details with AI</p>
          </div>
        </div>
      )}

      {/* Journal Entry Form */}
      {isCreating && (
        <div className="panel p-6 space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>New Journal Entry</h2>
            <button onClick={() => setIsCreating(false)} className="btn btn-ghost btn-icon">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Entry Details */}
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" value={journalEntry.date}
                onChange={e => setJournalEntry({ ...journalEntry, date: e.target.value })} />
            </div>
            <div>
              <label className="label">Reference Number</label>
              <input type="text" className="input" value={journalEntry.referenceNumber} placeholder="INV-001"
                onChange={e => setJournalEntry({ ...journalEntry, referenceNumber: e.target.value })} />
            </div>
            <div>
              <label className="label">Memo</label>
              <input type="text" className="input" value={journalEntry.memo} placeholder="Description of transaction"
                onChange={e => setJournalEntry({ ...journalEntry, memo: e.target.value })} />
            </div>
          </div>

          {/* Journal Lines */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Transaction Lines</h3>
              <button onClick={addLine} className="btn btn-ghost btn-sm" style={{ color: 'var(--accent)' }}>
                <Plus className="w-3.5 h-3.5" /> Add Line
              </button>
            </div>

            {/* Table Header */}
            <div className="grid grid-cols-12 gap-3 px-1 py-2 text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)', backgroundColor: 'var(--bg-tertiary)' }}>
              <div className="col-span-3">Account</div>
              <div className="col-span-4">Description</div>
              <div className="col-span-2 text-right">Debit</div>
              <div className="col-span-2 text-right">Credit</div>
              <div className="col-span-1" />
            </div>

            {/* Lines */}
            {journalEntry.lines.map(line => (
              <div key={line.id} className="grid grid-cols-12 gap-3 items-center">
                <div className="col-span-3">
                  <select className="select" value={line.accountId} onChange={e => updateLine(line.id, 'accountId', e.target.value)}>
                    <option value="">Select account…</option>
                    {accounts.map(account => (
                      <option key={account.id} value={account.id}>{account.code} – {account.name}</option>
                    ))}
                  </select>
                </div>
                <div className="col-span-4">
                  <input type="text" className="input" value={line.description} placeholder="Line description"
                    onChange={e => updateLine(line.id, 'description', e.target.value)} />
                </div>
                <div className="col-span-2">
                  <input type="number" step="0.01" className="input text-right" value={line.debit || ''} placeholder="0.00"
                    onChange={e => updateLine(line.id, 'debit', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="col-span-2">
                  <input type="number" step="0.01" className="input text-right" value={line.credit || ''} placeholder="0.00"
                    onChange={e => updateLine(line.id, 'credit', parseFloat(e.target.value) || 0)} />
                </div>
                <div className="col-span-1 flex justify-end">
                  <button onClick={() => removeLine(line.id)} className="btn btn-ghost btn-icon btn-xs" style={{ color: 'var(--neon-red)' }}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Totals */}
          <div style={{ borderTop: '1px solid var(--border-color)', paddingTop: '16px' }}>
            <div className="grid grid-cols-12 gap-3 text-sm font-medium">
              <div className="col-span-7 text-right" style={{ color: 'var(--text-secondary)' }}>Totals:</div>
              <div className="col-span-2">
                <div className="px-3 py-2 rounded-md text-right text-sm font-semibold num"
                  style={{ backgroundColor: totalDebit > 0 ? 'rgba(16,185,129,0.08)' : 'var(--bg-muted)', color: totalDebit > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                  ${totalDebit.toFixed(2)}
                </div>
              </div>
              <div className="col-span-2">
                <div className="px-3 py-2 rounded-md text-right text-sm font-semibold num"
                  style={{ backgroundColor: totalCredit > 0 ? 'rgba(239,68,68,0.08)' : 'var(--bg-muted)', color: totalCredit > 0 ? 'var(--neon-red)' : 'var(--text-muted)' }}>
                  ${totalCredit.toFixed(2)}
                </div>
              </div>
            </div>

            {/* Balance Status */}
            <div className="mt-3 flex items-center gap-2">
              {balanced ? (
                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--success)' }}>
                  <Check className="w-4 h-4" /> Entry is balanced
                </div>
              ) : (
                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--neon-amber)' }}>
                  <AlertCircle className="w-4 h-4" />
                  Out of balance by ${Math.abs(totalDebit - totalCredit).toFixed(2)}
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-3 justify-end">
            <button onClick={() => saveJournalEntry(false)} className="btn btn-secondary" disabled={saving}
              title="Drafts still require balanced debits & credits">
              Save as Draft
            </button>
            <button onClick={() => saveJournalEntry(true)} disabled={!balanced || saving}
              className="btn btn-primary">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Posting…</> : 'Post Entry'}
            </button>
          </div>
        </div>
      )}

      {/* Recent Journals */}
      <div className="panel p-6">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>Recent Journal Entries</h2>
          <span className="section-label">{recentJournals.length} entries</span>
        </div>
        {loading ? (
          <div className="flex justify-center py-12">
            <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--text-muted)' }} />
          </div>
        ) : recentJournals.length > 0 ? (
          <div className="space-y-3">
            {recentJournals.map(journal => (
              <div key={journal.id} className="card-flat p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {journal.entry_date ? new Date(journal.entry_date).toLocaleDateString() : '—'}
                    </p>
                    <p className="text-base font-semibold mt-0.5" style={{ color: 'var(--text-primary)' }}>
                      {journal.journal_number || 'Pending #'}
                    </p>
                    <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>{journal.memo || 'No memo'}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right">
                      <p className="text-lg font-semibold num" style={{ color: 'var(--text-primary)' }}>
                        ${journal.total_debit?.toLocaleString() || '0.00'}
                      </p>
                      <span className={`badge ${journal.status === 'posted' ? 'badge-success' : 'badge-neutral'} mt-1`}>
                        {journal.status || 'draft'}
                      </span>
                    </div>
                    <button onClick={() => deleteJournalEntry(journal.id)} className="btn btn-ghost btn-icon btn-sm"
                      style={{ color: 'var(--text-muted)' }} title="Delete entry">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                {journal.journal_lines && journal.journal_lines.length > 0 && (
                  <div className="space-y-2" style={{ borderTop: '1px solid var(--border-color)', paddingTop: '12px' }}>
                    {journal.journal_lines.slice(0, 3).map((line: any, idx: number) => (
                      <div key={idx} className="flex justify-between text-sm" style={{ color: 'var(--text-secondary)' }}>
                        <span>{line.accounts?.account_name || line.description}</span>
                        <div className="flex gap-6">
                          <span className="w-24 text-right num">{line.debit ? `$${Number(line.debit).toFixed(2)}` : '—'}</span>
                          <span className="w-24 text-right num">{line.credit ? `$${Number(line.credit).toFixed(2)}` : '—'}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <div className="empty-state-icon"><FileText className="w-5 h-5" /></div>
            <p className="empty-state-title">No journal entries yet</p>
            <p className="empty-state-desc">Create your first entry to get started.</p>
          </div>
        )}
      </div>
    </div>
  )
}
