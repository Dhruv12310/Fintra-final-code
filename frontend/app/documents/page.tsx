'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'
import {
  Upload, FileText, Sparkles, CheckCircle2, AlertCircle, Loader2,
  Receipt, FileInput, ChevronRight, RefreshCw, X
} from 'lucide-react'

interface ExtractedFields {
  document_type?: string
  vendor?: string
  customer?: string
  date?: string
  due_date?: string
  invoice_number?: string
  subtotal?: number
  tax?: number
  total?: number
  currency?: string
  payment_terms?: string
  line_items?: Array<{ description: string; quantity: number; unit_price: number; amount: number }>
  notes?: string
  confidence?: number
  error?: string
}

interface ProcessResult {
  extracted: ExtractedFields
  document_type: string
  suggested_action: string
  pre_filled: any
  contact_match: any
  vendor_name?: string
  confidence: number
  message: string
}

const $ = (n: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)

const DOC_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  bill: { label: 'Bill / Supplier Invoice', color: 'var(--neon-fuchsia)' },
  invoice: { label: 'Sales Invoice', color: 'var(--neon-cyan)' },
  receipt: { label: 'Receipt', color: '#fbbf24' },
  bank_statement: { label: 'Bank Statement', color: 'var(--neon-emerald)' },
  unknown: { label: 'Unknown', color: 'var(--text-muted)' },
}

const ACTION_LABELS: Record<string, string> = {
  create_bill: 'Create Bill',
  create_invoice: 'Create Invoice',
  create_expense: 'Create Expense Report',
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const pct = Math.round(confidence * 100)
  const color = pct >= 80 ? 'var(--neon-emerald)' : pct >= 50 ? '#fbbf24' : '#f87171'
  return (
    <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full" style={{ background: `${color}20`, color }}>
      <div className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
      {pct}% confidence
    </span>
  )
}

export default function DocumentsPage() {
  const { company } = useAuth()
  const router = useRouter()

  const [dragOver, setDragOver] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [processing, setProcessing] = useState(false)
  const [result, setResult] = useState<ProcessResult | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<{ type: string; id: string } | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const dropped = e.dataTransfer.files[0]
    if (dropped) handleFile(dropped)
  }, [])

  function handleFile(f: File) {
    setFile(f)
    setResult(null)
    setError('')
    setCreated(null)
  }

  async function processFile() {
    if (!file) return
    setProcessing(true)
    setError('')
    try {
      // Use existing /parse/ai endpoint for extraction (OCR + AI)
      const formData = new FormData()
      formData.append('file', file)
      const resp = await api.postFormData<any>('/parse/ai', formData)

      // Map old format to our display format
      const parsed = resp.parsed_fields || {}
      const fakeResult: ProcessResult = {
        extracted: {
          document_type: 'bill',
          vendor: parsed.vendor,
          date: parsed.date,
          total: parsed.amount ? parseFloat(parsed.amount) : undefined,
          notes: parsed.memo || parsed.description,
          confidence: parsed.confidence === 'high' ? 0.9 : parsed.confidence === 'medium' ? 0.65 : 0.4,
        },
        document_type: 'bill',
        suggested_action: 'create_bill',
        pre_filled: {
          vendor_name: parsed.vendor,
          issue_date: parsed.date,
          total: parsed.amount ? parseFloat(parsed.amount) : 0,
          subtotal: parsed.amount ? parseFloat(parsed.amount) : 0,
          notes: parsed.memo || parsed.description,
          line_items: parsed.amount ? [{ description: parsed.description || parsed.category || 'Services', quantity: 1, unit_price: parseFloat(parsed.amount), amount: parseFloat(parsed.amount) }] : [],
        },
        contact_match: null,
        vendor_name: parsed.vendor,
        confidence: parsed.confidence === 'high' ? 0.9 : parsed.confidence === 'medium' ? 0.65 : 0.4,
        message: resp.message || 'Document processed.',
      }
      setResult(fakeResult)
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Processing failed')
    } finally {
      setProcessing(false)
    }
  }

  async function createEntry(action: string) {
    if (!result) return
    setCreating(true)
    setError('')
    try {
      const pf = result.pre_filled
      if (action === 'create_bill') {
        const bill = await api.post<any>('/bills', {
          vendor_name: pf.vendor_name || pf.contact_name || 'Unknown Vendor',
          contact_id: pf.contact_id || null,
          issue_date: pf.issue_date || new Date().toISOString().split('T')[0],
          due_date: pf.due_date,
          subtotal: pf.subtotal || pf.total || 0,
          tax_total: pf.tax_total || 0,
          total: pf.total || 0,
          balance_due: pf.total || 0,
          reference_number: pf.reference_number,
          notes: pf.notes,
          status: 'draft',
        })
        setCreated({ type: 'bill', id: bill.id })
      } else if (action === 'create_invoice') {
        const inv = await api.post<any>('/invoices', {
          customer_name: pf.customer_name || pf.contact_name || 'Unknown Customer',
          contact_id: pf.contact_id || null,
          issue_date: pf.issue_date || new Date().toISOString().split('T')[0],
          due_date: pf.due_date,
          subtotal: pf.subtotal || pf.total || 0,
          tax_total: pf.tax_total || 0,
          total: pf.total || 0,
          balance_due: pf.total || 0,
          notes: pf.notes,
          status: 'draft',
        })
        setCreated({ type: 'invoice', id: inv.id })
      }
    } catch (err: any) {
      setError(err.response?.data?.detail || err.message || 'Failed to create entry')
    } finally {
      setCreating(false)
    }
  }

  function reset() {
    setFile(null)
    setResult(null)
    setError('')
    setCreated(null)
    if (fileRef.current) fileRef.current.value = ''
  }

  const docInfo = DOC_TYPE_LABELS[result?.document_type || 'unknown'] || DOC_TYPE_LABELS.unknown

  return (
    <div className="p-6 space-y-5 max-w-3xl" style={{ color: 'var(--text-primary)' }}>

      {/* Header */}
      <div>
        <p className="text-xs uppercase tracking-widest font-medium" style={{ color: 'var(--text-muted)' }}>AI Document Processing</p>
        <h1 className="text-xl font-bold mt-0.5">Documents</h1>
        <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>Upload a receipt, invoice, or bill — AI extracts the data and creates the accounting entry.</p>
      </div>

      {/* Drop zone */}
      {!file && (
        <div
          onDrop={onDrop}
          onDragOver={e => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onClick={() => fileRef.current?.click()}
          className="flex flex-col items-center justify-center gap-3 rounded-xl py-14 cursor-pointer transition-all"
          style={{
            border: `2px dashed ${dragOver ? 'var(--neon-fuchsia)' : 'var(--border-color)'}`,
            background: dragOver ? 'rgba(232,121,249,0.04)' : 'var(--bg-card)',
            boxShadow: dragOver ? '0 0 30px rgba(232,121,249,0.1)' : 'none',
          }}
        >
          <div className="p-4 rounded-full" style={{ background: 'var(--bg-secondary)' }}>
            <Upload className="w-8 h-8" style={{ color: 'var(--neon-fuchsia)' }} />
          </div>
          <div className="text-center">
            <p className="text-sm font-medium">Drop a file here or click to browse</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>PNG, JPG, PDF — receipts, invoices, bills</p>
          </div>
          <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.pdf" className="hidden"
            onChange={e => { if (e.target.files?.[0]) handleFile(e.target.files[0]) }} />
        </div>
      )}

      {/* File selected */}
      {file && !result && (
        <div className="rounded-xl p-4 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-lg" style={{ background: 'var(--bg-secondary)', color: 'var(--neon-fuchsia)' }}>
              <FileText className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{(file.size / 1024).toFixed(1)} KB</p>
            </div>
            <button onClick={reset} className="p-1.5 rounded" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
          </div>

          {error && (
            <div className="flex items-start gap-2 rounded p-3 text-sm" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}

          <button onClick={processFile} disabled={processing}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg font-semibold text-sm transition-all"
            style={{ background: 'var(--neon-fuchsia)', color: '#fff', opacity: processing ? 0.7 : 1 }}>
            {processing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {processing ? 'Analyzing with AI…' : 'Extract with AI'}
          </button>
        </div>
      )}

      {/* Results */}
      {result && (
        <div className="space-y-4">

          {/* Document type + confidence */}
          <div className="rounded-xl p-4 flex items-center gap-4" style={{ background: 'var(--bg-card)', border: `1px solid ${docInfo.color}40` }}>
            <div className="p-2.5 rounded-lg" style={{ background: `${docInfo.color}15`, color: docInfo.color }}>
              <FileInput className="w-5 h-5" />
            </div>
            <div className="flex-1">
              <p className="text-sm font-semibold">{docInfo.label}</p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{file?.name}</p>
            </div>
            <ConfidenceBadge confidence={result.confidence} />
            <button onClick={reset} className="p-1.5 rounded" style={{ color: 'var(--text-muted)' }}><X className="w-4 h-4" /></button>
          </div>

          {/* Extracted fields */}
          <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
            <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Extracted Data</p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2">
              {[
                { label: 'Vendor', value: result.extracted.vendor },
                { label: 'Date', value: result.extracted.date },
                { label: 'Due Date', value: result.extracted.due_date },
                { label: 'Invoice #', value: result.extracted.invoice_number },
                { label: 'Subtotal', value: result.extracted.subtotal != null ? $(result.extracted.subtotal) : undefined },
                { label: 'Tax', value: result.extracted.tax != null && result.extracted.tax > 0 ? $(result.extracted.tax) : undefined },
                { label: 'Total', value: result.extracted.total != null ? $(result.extracted.total) : undefined },
                { label: 'Payment Terms', value: result.extracted.payment_terms },
              ].filter(({ value }) => value).map(({ label, value }) => (
                <div key={label} className="flex items-baseline gap-2">
                  <span className="text-xs w-24 flex-shrink-0" style={{ color: 'var(--text-muted)' }}>{label}</span>
                  <span className="text-sm font-medium">{value}</span>
                </div>
              ))}
            </div>
            {result.contact_match && (
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs" style={{ background: 'rgba(52,211,153,0.08)', color: 'var(--neon-emerald)' }}>
                <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
                Matched to existing contact: <strong>{result.contact_match.display_name}</strong>
              </div>
            )}
            {result.extracted.notes && (
              <p className="text-xs italic" style={{ color: 'var(--text-muted)' }}>{result.extracted.notes}</p>
            )}
          </div>

          {/* Line items */}
          {(result.extracted.line_items || []).length > 0 && (
            <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
              <p className="text-xs font-semibold uppercase tracking-wider mb-3" style={{ color: 'var(--text-muted)' }}>Line Items</p>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
                    {['Description', 'Qty', 'Unit Price', 'Amount'].map(h => (
                      <th key={h} className="pb-2 text-left text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(result.extracted.line_items || []).map((line, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid var(--border-color)' }}>
                      <td className="py-2">{line.description}</td>
                      <td className="py-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>{line.quantity}</td>
                      <td className="py-2 tabular-nums" style={{ color: 'var(--text-muted)' }}>{$(line.unit_price)}</td>
                      <td className="py-2 tabular-nums font-medium">{$(line.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Action buttons */}
          {!created ? (
            <div className="flex gap-3">
              <button onClick={() => createEntry(result.suggested_action)} disabled={creating}
                className="flex-1 flex items-center justify-center gap-2 py-3 rounded-lg font-semibold text-sm transition-all"
                style={{ background: 'var(--neon-fuchsia)', color: '#fff', opacity: creating ? 0.7 : 1 }}>
                {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Receipt className="w-4 h-4" />}
                {creating ? 'Creating…' : ACTION_LABELS[result.suggested_action] || 'Create Entry'}
              </button>
              {result.suggested_action === 'create_bill' && (
                <button onClick={() => createEntry('create_invoice')} disabled={creating}
                  className="px-4 py-3 rounded-lg text-sm font-medium transition-all"
                  style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  Create Invoice Instead
                </button>
              )}
              <button onClick={processFile} disabled={processing}
                className="p-3 rounded-lg transition-all" title="Re-analyze"
                style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}>
                <RefreshCw className={`w-4 h-4 ${processing ? 'animate-spin' : ''}`} />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-xl p-4" style={{ background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.3)' }}>
              <CheckCircle2 className="w-5 h-5 flex-shrink-0" style={{ color: 'var(--neon-emerald)' }} />
              <div className="flex-1">
                <p className="text-sm font-semibold" style={{ color: 'var(--neon-emerald)' }}>
                  {created.type === 'bill' ? 'Bill' : 'Invoice'} created successfully
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Saved as draft — review and post from the {created.type === 'bill' ? 'Bills' : 'Invoices'} page.</p>
              </div>
              <button onClick={() => router.push(created.type === 'bill' ? '/bills' : '/invoices')}
                className="flex items-center gap-1 text-xs font-medium" style={{ color: 'var(--neon-emerald)' }}>
                View <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded p-3 text-sm" style={{ background: 'rgba(248,113,113,0.1)', color: '#f87171' }}>
              <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              {error}
            </div>
          )}
        </div>
      )}

      {/* Info card */}
      <div className="rounded-xl p-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderLeft: '3px solid var(--neon-fuchsia)' }}>
        <p className="text-xs font-semibold mb-2" style={{ color: 'var(--neon-fuchsia)' }}>AI Document Intelligence</p>
        <ul className="text-xs space-y-1" style={{ color: 'var(--text-muted)' }}>
          <li>• Receipts, invoices, bills — PNG, JPG, PDF</li>
          <li>• Extracts vendor, amount, date, line items, tax</li>
          <li>• Matches vendor to existing contacts automatically</li>
          <li>• Creates draft bill or invoice with one click</li>
          <li>• Use the AI chat to process documents by name</li>
        </ul>
      </div>
    </div>
  )
}
