'use client'

import { useCallback, useEffect, useState } from 'react'
import { Globe, Plus, Trash2, Loader2, Download } from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface Rate {
  id: string
  base_currency: string
  quote_currency: string
  rate: number
  as_of_date: string
  source?: string
}

const COMMON = ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'INR', 'CHF', 'CNY', 'MXN']

const fmtDate = (d?: string) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '\u2014'

export default function ExchangeRatesPage() {
  const { company, loading: authLoading } = useAuth()
  const companyId = company?.id || null
  const baseCurrency = (company as any)?.base_currency || 'USD'

  const [rates, setRates] = useState<Rate[]>([])
  const [loading, setLoading] = useState(true)
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null)

  const today = new Date().toISOString().split('T')[0]
  const [base, setBase] = useState(baseCurrency)
  const [quote, setQuote] = useState('EUR')
  const [rate, setRate] = useState('')
  const [asOf, setAsOf] = useState(today)
  const [saving, setSaving] = useState(false)
  const [fetchingLive, setFetchingLive] = useState(false)

  const load = useCallback(async () => {
    if (!companyId) return
    setLoading(true)
    try {
      const r = await api.get('/exchange-rates/')
      setRates(r || [])
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to load' })
    } finally {
      setLoading(false)
    }
  }, [companyId])

  useEffect(() => { if (!authLoading && companyId) load() }, [authLoading, companyId, load])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 4000)
    return () => clearTimeout(t)
  }, [toast])

  async function add() {
    const r = Number(rate)
    if (!r || r <= 0) {
      setToast({ ok: false, msg: 'Rate must be positive' })
      return
    }
    if (base === quote) {
      setToast({ ok: false, msg: 'Base and quote must differ' })
      return
    }
    setSaving(true)
    try {
      await api.post('/exchange-rates/', {
        base_currency: base, quote_currency: quote, rate: r, as_of_date: asOf,
      })
      setRate('')
      setToast({ ok: true, msg: 'Rate saved' })
      load()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to save' })
    } finally {
      setSaving(false)
    }
  }

  async function fetchLive() {
    if (base === quote) {
      setToast({ ok: false, msg: 'Base and quote must differ' })
      return
    }
    setFetchingLive(true)
    try {
      const r = await api.get(
        `/exchange-rates/live?base=${encodeURIComponent(base)}&quote=${encodeURIComponent(quote)}&as_of=${encodeURIComponent(asOf)}`
      )
      setRate(String(r.rate))
      setToast({ ok: true, msg: `Fetched: 1 ${r.base} = ${Number(r.rate).toFixed(6)} ${r.quote}` })
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'No rate available' })
    } finally {
      setFetchingLive(false)
    }
  }

  async function fetchAndSave() {
    if (base === quote) {
      setToast({ ok: false, msg: 'Base and quote must differ' })
      return
    }
    setFetchingLive(true)
    try {
      await api.post('/exchange-rates/live/save', {
        base, quote, as_of: asOf,
      })
      setRate('')
      setToast({ ok: true, msg: 'Saved' })
      load()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to fetch and save' })
    } finally {
      setFetchingLive(false)
    }
  }

  async function del(id: string) {
    try {
      await api.delete(`/exchange-rates/${id}`)
      load()
    } catch (e: any) {
      setToast({ ok: false, msg: e?.response?.data?.detail || 'Failed to delete' })
    }
  }

  if (!companyId && !authLoading) {
    return <div className="flex items-center justify-center min-h-[60vh]" style={{ color: 'var(--text-muted)' }}>Complete onboarding first.</div>
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-4">
      <header className="flex items-center gap-3">
        <Globe className="w-6 h-6" style={{ color: 'var(--accent)' }} />
        <div>
          <h1 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>Exchange Rates</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Manual FX rates. Used when posting in foreign currencies. Base currency: <span className="num font-medium">{baseCurrency}</span>
          </p>
        </div>
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

      <div className="rounded-lg p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="Base">
            <input
              className="input num"
              placeholder="USD"
              value={base}
              onChange={e => setBase(e.target.value.toUpperCase())}
              maxLength={3}
              list="fx-currencies"
            />
          </Field>
          <Field label="Quote">
            <input
              className="input num"
              placeholder="EUR"
              value={quote}
              onChange={e => setQuote(e.target.value.toUpperCase())}
              maxLength={3}
              list="fx-currencies"
            />
          </Field>
          <Field label="Rate">
            <input
              type="number" step="0.000001"
              className="input num"
              placeholder="1.000000"
              value={rate}
              onChange={e => setRate(e.target.value)}
            />
          </Field>
          <Field label="As of">
            <input type="date" className="input" value={asOf} onChange={e => setAsOf(e.target.value)} />
          </Field>
        </div>

        <div className="flex flex-wrap gap-2 justify-end">
          <button
            onClick={fetchLive}
            disabled={fetchingLive}
            className="btn"
            title="Look up the live rate from public FX sources without saving"
          >
            {fetchingLive ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Download className="w-4 h-4" /> Fetch live</>}
          </button>
          <button
            onClick={fetchAndSave}
            disabled={fetchingLive}
            className="btn btn-secondary"
            title="Fetch live and save in one step"
          >
            {fetchingLive ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Fetch and save'}
          </button>
          <button onClick={add} disabled={saving} className="btn btn-primary">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <><Plus className="w-4 h-4" /> Save manual rate</>}
          </button>
        </div>

        <datalist id="fx-currencies">
          {COMMON.map(c => <option key={c} value={c} />)}
        </datalist>
      </div>

      <div className="rounded-lg overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}>
        {loading ? (
          <div className="p-12 text-center"><Loader2 className="w-5 h-5 animate-spin inline" style={{ color: 'var(--text-muted)' }} /></div>
        ) : rates.length === 0 ? (
          <div className="p-12 text-center text-sm" style={{ color: 'var(--text-muted)' }}>No exchange rates yet.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-muted)', borderBottom: '1px solid var(--border-color)' }}>
                {['Base', 'Quote', 'Rate', 'As Of', 'Source', ''].map((h, i) => (
                  <th key={h} className="text-[10px] uppercase font-semibold px-3 py-2"
                    style={{ color: 'var(--text-muted)', textAlign: i === 2 ? 'right' : 'left', letterSpacing: '0.06em' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rates.map(r => (
                <tr key={r.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  <td className="px-3 py-2 num" style={{ color: 'var(--text-primary)' }}>{r.base_currency}</td>
                  <td className="px-3 py-2 num" style={{ color: 'var(--text-primary)' }}>{r.quote_currency}</td>
                  <td className="px-3 py-2 num text-right" style={{ color: 'var(--text-primary)' }}>{Number(r.rate).toFixed(6)}</td>
                  <td className="px-3 py-2" style={{ color: 'var(--text-muted)' }}>{fmtDate(r.as_of_date)}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>{r.source || 'manual'}</td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => del(r.id)} title="Delete">
                      <Trash2 className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      {children}
    </div>
  )
}
