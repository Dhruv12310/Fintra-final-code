'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useAuth } from '@/contexts/AuthContext'
import { api } from '@/lib/api'
import { useTheme } from '@/contexts/ThemeContext'
import { ArrowRight, ArrowLeft, CheckCircle2, Sun, Moon, Loader2 } from 'lucide-react'

// ─── Constants ────────────────────────────────────────────────────────────────

const INDUSTRIES = [
  'SaaS / Software', 'E-commerce / Retail', 'Professional Services',
  'Healthcare', 'Manufacturing', 'Food & Beverage', 'Real Estate',
  'Construction', 'Marketing / Advertising', 'Education', 'Consulting', 'Other',
]

const BUSINESS_TYPES = [
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'llc',             label: 'LLC' },
  { value: 's_corp',          label: 'S-Corporation' },
  { value: 'corporation',     label: 'C-Corporation' },
  { value: 'partnership',     label: 'Partnership' },
  { value: 'other',           label: 'Not sure / Other / None' },
]

const US_STATES = [
  'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA',
  'KS','KY','LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ',
  'NM','NY','NC','ND','OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT',
  'VA','WA','WV','WI','WY',
]

const STEPS = [
  { num: 1, title: 'Company info',         subtitle: 'Basic details about your business'   },
  { num: 2, title: 'Legal info',           subtitle: 'For tax and compliance purposes'      },
  { num: 3, title: 'Customer contact',     subtitle: 'How customers reach you'              },
]

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const router = useRouter()
  const { user, refreshUser } = useAuth()
  const { theme, toggleTheme } = useTheme()

  const [step,    setStep]    = useState(0)   // 0 = landing, 1-3 = forms, 4 = done
  const [loading, setLoading] = useState(false)
  const [initLoading, setInitLoading] = useState(true)
  const [companyId, setCompanyId]     = useState('')
  const [mounted, setMounted]         = useState(false)
  const [error,   setError]           = useState('')

  const [form, setForm] = useState({
    // Step 1 — Company info
    name:        '',
    email:       '',
    phone:       '',
    address:     '',
    city:        '',
    state:       '',
    zip_code:    '',
    website:     '',
    industry:    '',

    // Step 2 — Legal info
    legal_business_name: '',
    tax_id:              '',
    business_type:       '',
    legal_address:       '',

    // Step 3 — Customer contact
    customer_email:   '',
    customer_address: '',

    onboarding_completed: false,
    onboarding_step: 1,
  })

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!user) { setInitLoading(false); return }
    const load = async () => {
      try {
        const res = await api.get('/companies/')
        if (res.data?.length > 0) {
          const co = res.data[0]
          if (co.onboarding_completed) { router.replace('/new-dashboard'); return }
          setCompanyId(co.id)
          setForm(prev => ({ ...prev, ...co }))
          if (co.onboarding_step) setStep(Math.min(Number(co.onboarding_step), 4))
        }
      } catch (e) { console.error(e) }
      finally { setInitLoading(false) }
    }
    load()
  }, [user])

  const set = useCallback((k: string, v: any) => {
    setForm(p => ({ ...p, [k]: v }))
    setError('')
  }, [])

  // Only name + email are required (step 1); legal_business_name is required (step 2)
  const canProceed = useCallback(() => {
    if (step === 1) return !!((form.name || '').trim() && (form.email || '').trim())
    if (step === 2) return !!((form.legal_business_name || '').trim())
    return true
  }, [step, form])

  const save = async (targetStep: number, complete = false): Promise<boolean> => {
    setLoading(true); setError('')
    try {
      const raw = { ...form, onboarding_step: targetStep, onboarding_completed: complete }
      // Strip empty strings so we never send columns that may not exist in the schema cache yet
      const payload = Object.fromEntries(
        Object.entries(raw).filter(([, v]) => v !== '' && v !== null && v !== undefined)
      )
      if (companyId) {
        await api.patch(`/companies/${companyId}`, payload)
        await refreshUser()
      } else {
        const res = await api.post('/companies/', payload)
        if (res.status === 'success' && res.data?.[0]?.id) {
          const id = res.data[0].id
          setCompanyId(id)
          if (user) await api.patch(`/users/${user.id}`, { company_id: id })
          await refreshUser()
        } else throw new Error('Failed to create company')
      }
      return true
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || 'Failed to save. Please try again.')
      return false
    } finally { setLoading(false) }
  }

  const next = async () => {
    const ok = await save(step + 1)
    if (ok) setStep(s => s + 1)
  }

  const prev = () => { setError(''); setStep(s => (s === 1 ? 0 : s - 1)) }

  const finish = async () => {
    const ok = await save(4, true)
    if (ok) { await refreshUser(); router.push('/new-dashboard') }
  }

  // ─── Styles ───────────────────────────────────────────────────────────────
  const inp = `w-full px-4 py-3 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/40 transition-all`
  const inpStyle = {
    backgroundColor: 'var(--bg-primary)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-primary)',
  }

  const Label = ({ text, required }: { text: string; required?: boolean }) => (
    <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
      {text}{required && <span className="text-pink-500 ml-0.5">*</span>}
    </label>
  )

  if (!mounted || initLoading) return (
    <div className="flex items-center justify-center h-screen" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <Loader2 className="w-6 h-6 animate-spin" style={{ color: 'var(--neon-cyan)' }} />
    </div>
  )

  return (
    <div className="min-h-screen flex items-center justify-center p-4 relative" style={{ backgroundColor: 'var(--bg-primary)' }}>

      {/* Neon glows */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden">
        <div className="absolute -top-32 left-1/4 h-96 w-96 rounded-full blur-[200px]"
          style={{ backgroundColor: 'var(--neon-fuchsia)', opacity: 'var(--glow-opacity)' }} />
        <div className="absolute top-1/3 right-0 h-80 w-80 rounded-full blur-[180px]"
          style={{ backgroundColor: 'var(--neon-cyan)', opacity: 'var(--glow-opacity)' }} />
        <div className="absolute bottom-10 left-10 h-72 w-72 rounded-full blur-[160px]"
          style={{ backgroundColor: 'var(--neon-emerald)', opacity: 'var(--glow-opacity)' }} />
      </div>

      {/* Theme toggle */}
      <button onClick={toggleTheme} className="fixed top-4 right-4 p-2 rounded-lg z-50"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border-color)' }}>
        {theme === 'dark'
          ? <Sun className="w-5 h-5" style={{ color: 'var(--neon-cyan)' }} />
          : <Moon className="w-5 h-5" style={{ color: 'var(--neon-fuchsia)' }} />}
      </button>

      {/* Card */}
      <div className="max-w-xl w-full rounded-2xl p-8 md:p-10 relative z-10 border"
        style={{
          backgroundColor: 'var(--bg-card)',
          borderColor: 'var(--border-color)',
          boxShadow: theme === 'dark'
            ? '0 0 60px rgba(217,70,239,0.12), 0 0 100px rgba(34,211,238,0.08)'
            : '0 20px 60px rgba(0,0,0,0.08)',
        }}>

        {/* ── Landing ── */}
        {step === 0 && (
          <div className="text-center py-4 space-y-6">
            <div>
              <h1 className="text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
                Set up your company
              </h1>
              <p className="mt-3 text-base" style={{ color: 'var(--text-secondary)' }}>
                Just 3 short steps. Only your <strong>company name</strong> and <strong>email</strong> are required — everything else is optional and can be changed later.
              </p>
            </div>

            {/* Step preview */}
            <div className="space-y-3 text-left">
              {STEPS.map(s => (
                <div key={s.num} className="flex items-center gap-4 p-4 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                  <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0 text-white"
                    style={{ background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-fuchsia))' }}>
                    {s.num}
                  </div>
                  <div>
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{s.title}</p>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{s.subtitle}</p>
                  </div>
                </div>
              ))}
            </div>

            <button onClick={() => setStep(1)}
              className="w-full py-3 rounded-xl font-semibold text-white flex items-center justify-center gap-2 hover:opacity-90 transition"
              style={{ background: 'linear-gradient(90deg, var(--neon-fuchsia), var(--neon-cyan))' }}>
              Get started <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* ── Form steps 1–3 ── */}
        {step >= 1 && step <= 3 && (
          <>
            {/* Progress */}
            <div className="mb-8">
              <div className="flex gap-1.5 mb-5">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex-1 h-1 rounded-full transition-all duration-500"
                    style={{
                      background: i <= step
                        ? 'linear-gradient(90deg, var(--neon-cyan), var(--neon-fuchsia))'
                        : theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                    }} />
                ))}
              </div>
              <p className="text-xs font-medium uppercase tracking-widest mb-1" style={{ color: 'var(--text-muted)' }}>
                Step {step} of 3
              </p>
              <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                {STEPS[step - 1].title}
              </h2>
              <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
                {STEPS[step - 1].subtitle}
              </p>
            </div>

            {/* Error */}
            {error && (
              <div className="mb-5 p-3 rounded-xl text-sm"
                style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444' }}>
                {error}
              </div>
            )}

            {/* ── Step 1: Company info ── */}
            {step === 1 && (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2">
                    <Label text="Company name" required />
                    <input className={inp} style={inpStyle} placeholder="Acme Inc."
                      value={form.name} onChange={e => set('name', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label text="Business email" required />
                    <input className={inp} style={inpStyle} type="email" placeholder="hello@acme.com"
                      value={form.email} onChange={e => set('email', e.target.value)} />
                  </div>
                  <div>
                    <Label text="Phone" />
                    <input className={inp} style={inpStyle} type="tel" placeholder="6505550100"
                      value={form.phone} onChange={e => set('phone', e.target.value)} />
                  </div>
                  <div>
                    <Label text="Industry" />
                    <select className={inp} style={inpStyle}
                      value={form.industry} onChange={e => set('industry', e.target.value)}>
                      <option value="">Select industry</option>
                      {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <Label text="Website" />
                    <input className={inp} style={inpStyle} type="url" placeholder="https://acme.com"
                      value={form.website} onChange={e => set('website', e.target.value)} />
                  </div>
                  <div className="col-span-2">
                    <Label text="Street address" />
                    <input className={inp} style={inpStyle} placeholder="123 Main St Ste 100"
                      value={form.address} onChange={e => set('address', e.target.value)} />
                  </div>
                  <div>
                    <Label text="City" />
                    <input className={inp} style={inpStyle} placeholder="Columbus"
                      value={form.city} onChange={e => set('city', e.target.value)} />
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label text="State" />
                      <select className={inp} style={inpStyle}
                        value={form.state} onChange={e => set('state', e.target.value)}>
                        <option value="">—</option>
                        {US_STATES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div>
                      <Label text="ZIP" />
                      <input className={inp} style={inpStyle} placeholder="43207"
                        value={form.zip_code} onChange={e => set('zip_code', e.target.value)} />
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ── Step 2: Legal info ── */}
            {step === 2 && (
              <div className="space-y-4">
                <div>
                  <Label text="Legal business name" required />
                  <input className={inp} style={inpStyle} placeholder="Acme Inc. (as registered)"
                    value={form.legal_business_name} onChange={e => set('legal_business_name', e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label text="EIN / SSN" />
                    <input className={inp} style={inpStyle} placeholder="XX-XXXXXXX"
                      value={form.tax_id} onChange={e => set('tax_id', e.target.value)} />
                  </div>
                  <div>
                    <Label text="Business type" />
                    <select className={inp} style={inpStyle}
                      value={form.business_type} onChange={e => set('business_type', e.target.value)}>
                      <option value="">Select type</option>
                      {BUSINESS_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                  </div>
                </div>
                <div>
                  <Label text="Legal address" />
                  <textarea className={inp} style={{ ...inpStyle, resize: 'none' } as any} rows={3}
                    placeholder={"123 MAIN ST STE 100\nCOLUMBUS, OH 43207"}
                    value={form.legal_address} onChange={e => set('legal_address', e.target.value)} />
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Only your legal business name is required. EIN / SSN is stored securely and never shared.
                </p>
              </div>
            )}

            {/* ── Step 3: Customer contact ── */}
            {step === 3 && (
              <div className="space-y-4">
                <div className="p-4 rounded-xl text-sm" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-secondary)' }}>
                  This is how customers get in touch with you — may appear on invoices and billing documents. Both fields are optional.
                </div>
                <div>
                  <Label text="Customer email" />
                  <input className={inp} style={inpStyle} type="email" placeholder="billing@acme.com"
                    value={form.customer_email} onChange={e => set('customer_email', e.target.value)} />
                </div>
                <div>
                  <Label text="Customer address" />
                  <textarea className={inp} style={{ ...inpStyle, resize: 'none' } as any} rows={3}
                    placeholder={"123 Main St Ste 100\nColumbus, OH 43207"}
                    value={form.customer_address} onChange={e => set('customer_address', e.target.value)} />
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between mt-8 gap-4">
              <button onClick={prev} disabled={loading}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium transition disabled:opacity-40"
                style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)', color: 'var(--text-primary)' }}>
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              <button onClick={next} disabled={!canProceed() || loading}
                className="flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ background: 'linear-gradient(135deg, var(--neon-cyan), var(--neon-fuchsia))' }}>
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</>
                  : step === 3
                    ? <>Almost done <ArrowRight className="w-4 h-4" /></>
                    : <>Continue <ArrowRight className="w-4 h-4" /></>}
              </button>
            </div>

            {!canProceed() && (
              <p className="text-xs text-center mt-3 text-pink-500">
                Please fill in the required fields marked with *
              </p>
            )}
          </>
        )}

        {/* ── Step 4: Done ── */}
        {step === 4 && (
          <div className="text-center space-y-6 py-4">
            <div className="flex justify-center">
              <div className="p-5 rounded-full"
                style={{ background: 'linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan))', boxShadow: '0 0 40px rgba(52,211,153,0.35)' }}>
                <CheckCircle2 className="w-14 h-14 text-white" />
              </div>
            </div>
            <div>
              <h2 className="text-2xl font-bold" style={{ color: 'var(--text-primary)' }}>
                You're all set{form.name ? `, ${form.name}` : ''}!
              </h2>
              <p className="mt-2 text-base" style={{ color: 'var(--text-secondary)' }}>
                Your company profile is ready. You can always update any details from your profile page.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-left">
              {[
                { e: '📊', t: 'Financial Reports',  d: 'P&L, Balance Sheet, Cash Flow'   },
                { e: '🧾', t: 'Invoices & Bills',   d: 'AR / AP with auto-journal'        },
                { e: '📈', t: 'AI Insights',         d: 'Powered by your business data'   },
                { e: '📋', t: 'Chart of Accounts',   d: 'Pre-built for your industry'     },
              ].map(f => (
                <div key={f.t} className="p-4 rounded-xl"
                  style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border-color)' }}>
                  <div className="text-xl mb-1">{f.e}</div>
                  <div className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{f.t}</div>
                  <div className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>{f.d}</div>
                </div>
              ))}
            </div>
            <button onClick={finish} disabled={loading}
              className="w-full py-3.5 rounded-xl font-bold text-white flex items-center justify-center gap-2 hover:opacity-90 disabled:opacity-50 transition"
              style={{ background: 'linear-gradient(135deg, var(--neon-emerald), var(--neon-cyan))' }}>
              {loading
                ? <><Loader2 className="w-5 h-5 animate-spin" /> Setting up your dashboard...</>
                : <>Go to Dashboard <ArrowRight className="w-5 h-5" /></>}
            </button>
          </div>
        )}

      </div>
    </div>
  )
}
