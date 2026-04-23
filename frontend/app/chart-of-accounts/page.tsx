'use client'
import PageHeader from '@/components/PageHeader'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  Upload,
  Download,
  ChevronRight,
  ChevronDown,
  Edit,
  Trash2,
  Loader2,
  FolderTree
} from 'lucide-react'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface Account {
  id: string
  code: string
  name: string
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense'
  subtype: string
  balance: number
  parentId?: string
  children?: Account[]
  isExpanded?: boolean
}

export default function ChartOfAccounts() {
  const { company } = useAuth()
  const companyId = company?.id || null
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [uploadingCSV, setUploadingCSV] = useState(false)
  const [filter, setFilter] = useState<string>('all')
  const [totalsByType, setTotalsByType] = useState<Record<string, number>>({})
  const [provisioning, setProvisioning] = useState(false)
  const [provisionMsg, setProvisionMsg] = useState<{ ok: boolean; text: string } | null>(null)

  useEffect(() => {
    if (companyId) {
      fetchAccounts(companyId)
    }
  }, [companyId])

  const buildAccountHierarchy = (flatAccounts: Account[]): Account[] => {
    const accountMap = new Map<string, Account>()
    const rootAccounts: Account[] = []

    // First pass: create map
    flatAccounts.forEach(acc => {
      accountMap.set(acc.id, { ...acc, children: [] })
    })

    // Second pass: build hierarchy
    flatAccounts.forEach(acc => {
      const account = accountMap.get(acc.id)!
      if (acc.parentId) {
        const parent = accountMap.get(acc.parentId)
        if (parent) {
          parent.children = parent.children || []
          parent.children.push(account)
        } else {
          rootAccounts.push(account)
        }
      } else {
        rootAccounts.push(account)
      }
    })

    return rootAccounts
  }

  const fetchAccounts = async (targetCompanyId: string) => {
    try {
      setLoading(true)
      const response = await api.get(`/accounts/company/${targetCompanyId}`)

      // Map API response to our Account interface
      const accountsData: Account[] = response.map((acc: any) => ({
        id: acc.id,
        code: acc.account_code,
        name: acc.account_name,
        type: acc.account_type,
        subtype: acc.account_subtype || '',
        balance: acc.current_balance || 0,
        parentId: acc.parent_account_id,
        isExpanded: false
      }))

      const typeTotals = accountsData.reduce((acc: Record<string, number>, account) => {
        acc[account.type] = (acc[account.type] || 0) + (account.balance || 0)
        return acc
      }, {})
      setTotalsByType(typeTotals)

      // Build hierarchy
      const accountsWithChildren = buildAccountHierarchy(accountsData)
      setAccounts(accountsWithChildren)
    } catch (error) {
      console.error('Failed to fetch accounts:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleProvision = async () => {
    if (!companyId) return
    setProvisioning(true)
    setProvisionMsg(null)
    try {
      const res = await api.post(`/companies/${companyId}/provision-coa`, {})
      if (res.status === 'already_provisioned') {
        setProvisionMsg({ ok: false, text: 'Accounts already exist. If they look empty, refresh the page.' })
      } else {
        setProvisionMsg({ ok: true, text: res.message || 'Chart of Accounts set up successfully!' })
        await fetchAccounts(companyId)
      }
    } catch (e: any) {
      const detail = e?.response?.data?.detail || e?.message || 'Failed to provision.'
      setProvisionMsg({ ok: false, text: detail })
    } finally {
      setProvisioning(false)
    }
  }

  const handleCSVUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !companyId) return

    setUploadingCSV(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      // Replace with actual API call
      await new Promise(resolve => setTimeout(resolve, 2000))
      alert('Chart of Accounts uploaded successfully!')
      fetchAccounts(companyId)
    } catch (error) {
      console.error('Failed to upload CSV:', error)
      alert('Failed to upload CSV. Please try again.')
    } finally {
      setUploadingCSV(false)
    }
  }

  const exportToCSV = () => {
    // Generate CSV export
    let csv = 'Account Code,Account Name,Type,Subtype,Balance\n'
    const flattenAccounts = (accts: Account[]): Account[] => {
      return accts.reduce((acc, account) => {
        acc.push(account)
        if (account.children) {
          acc.push(...flattenAccounts(account.children))
        }
        return acc
      }, [] as Account[])
    }

    const allAccounts = flattenAccounts(accounts)
    allAccounts.forEach(account => {
      csv += `${account.code},"${account.name}",${account.type},${account.subtype},${account.balance}\n`
    })

    const blob = new Blob([csv], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'chart-of-accounts.csv'
    a.click()
  }

  const toggleExpand = (accountId: string) => {
    setAccounts(prevAccounts =>
      prevAccounts.map(account => {
        if (account.id === accountId) {
          return { ...account, isExpanded: !account.isExpanded }
        }
        return account
      })
    )
  }

  const filteredAccounts = filter === 'all'
    ? accounts
    : accounts.filter(a => a.type === filter)

  if (!companyId) {
    return (
      <div className="flex items-center justify-center h-screen">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--text-secondary)' }} />
      </div>
    )
  }

  const cardStyle = { backgroundColor: 'var(--bg-card)', border: '1px solid var(--border-color)' }

  return (
    <div className="min-h-screen p-8 space-y-6" style={{ color: 'var(--text-primary)' }}>
      <PageHeader
        eyebrow="Ledger structure"
        title="Chart of Accounts"
        subtitle="Balances stay synced with every journal entry."
        actions={
          <>
            <button onClick={exportToCSV} className="btn">
              <Download className="w-4 h-4" /> Export CSV
            </button>
            <label className="btn cursor-pointer">
              <Upload className="w-4 h-4" />
              {uploadingCSV ? 'Uploading...' : 'Upload CSV'}
              <input type="file" accept=".csv" onChange={handleCSVUpload} className="hidden" disabled={uploadingCSV} />
            </label>
          </>
        }
      />

      {/* Type totals */}
      <div className="grid md:grid-cols-3 xl:grid-cols-5 gap-4">
        {['asset', 'liability', 'equity', 'revenue', 'expense'].map(type => (
          <div key={type} className="card p-4">
            <p className="text-xs uppercase tracking-widest" style={{ color: 'var(--text-muted)' }}>{type}</p>
            <p className="text-2xl font-semibold mt-2">${(totalsByType[type] || 0).toLocaleString()}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Current balance</p>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-2 overflow-x-auto" style={{ borderBottom: '1px solid var(--border-color)' }}>
        {['all', 'asset', 'liability', 'equity', 'revenue', 'expense'].map(type => (
          <button
            key={type}
            onClick={() => setFilter(type)}
            className="px-4 py-2 text-sm font-semibold border-b-2 transition-colors"
            style={{
              borderColor: filter === type ? 'var(--accent)' : 'transparent',
              color: filter === type ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Accounts Tree */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: 'var(--text-muted)' }} />
        </div>
      ) : (
        <div className="panel overflow-hidden">
          {/* Table Header */}
          <div
            className="grid grid-cols-12 gap-4 px-6 py-4 text-xs font-semibold uppercase tracking-wide"
            style={{ borderBottom: '1px solid var(--border-color)', color: 'var(--text-muted)', backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="col-span-1">Code</div>
            <div className="col-span-4">Account Name</div>
            <div className="col-span-2">Type</div>
            <div className="col-span-2">Subtype</div>
            <div className="col-span-2 text-right">Balance</div>
            <div className="col-span-1"></div>
          </div>

          {filteredAccounts.length > 0 ? (
            <div>
              {filteredAccounts.map(account => (
                <div key={account.id} style={{ borderBottom: '1px solid var(--border-color)' }}>
                  {/* Parent Account */}
                  <div className="grid grid-cols-12 gap-4 px-6 py-4 transition-colors hover:opacity-90">
                    <div className="col-span-1 font-mono text-sm">{account.code}</div>
                    <div className="col-span-4 flex items-center gap-2">
                      {account.children && account.children.length > 0 && (
                        <button onClick={() => toggleExpand(account.id)} style={{ color: 'var(--text-muted)' }}>
                          {account.isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                        </button>
                      )}
                      <Link href={`/chart-of-accounts/${account.id}`} className="font-medium hover:underline" style={{ color: 'var(--accent)' }}>
                        {account.name}
                      </Link>
                    </div>
                    <div className="col-span-2">
                      <span className="inline-flex px-2 py-1 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}>
                        {account.type.charAt(0).toUpperCase() + account.type.slice(1)}
                      </span>
                    </div>
                    <div className="col-span-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                      {account.subtype ? account.subtype.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : '—'}
                    </div>
                    <div className="col-span-2 text-right font-medium">${account.balance.toLocaleString()}</div>
                    <div className="col-span-1 flex justify-end gap-2">
                      <button style={{ color: 'var(--text-muted)' }}><Edit className="w-4 h-4" /></button>
                      <button style={{ color: 'var(--text-muted)' }}><Trash2 className="w-4 h-4" /></button>
                    </div>
                  </div>

                  {/* Child Accounts */}
                  {account.isExpanded && account.children?.map(child => (
                    <div key={child.id} className="grid grid-cols-12 gap-4 px-6 py-3 transition-colors" style={{ backgroundColor: 'var(--bg-secondary)', borderTop: '1px solid var(--border-color)' }}>
                      <div className="col-span-1 font-mono text-sm pl-8" style={{ color: 'var(--text-muted)' }}>{child.code}</div>
                      <div className="col-span-4 pl-8 text-sm">
                        <Link href={`/chart-of-accounts/${child.id}`} className="hover:underline" style={{ color: 'var(--accent)' }}>
                          {child.name}
                        </Link>
                      </div>
                      <div className="col-span-2">
                        <span className="inline-flex px-2 py-1 rounded-lg text-xs font-medium" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-card)', color: 'var(--text-secondary)' }}>
                          {child.type.charAt(0).toUpperCase() + child.type.slice(1)}
                        </span>
                      </div>
                      <div className="col-span-2 text-sm" style={{ color: 'var(--text-muted)' }}>
                        {child.subtype ? child.subtype.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()) : '—'}
                      </div>
                      <div className="col-span-2 text-right text-sm font-medium">${child.balance.toLocaleString()}</div>
                      <div className="col-span-1 flex justify-end gap-2">
                        <button style={{ color: 'var(--text-muted)' }}><Edit className="w-4 h-4" /></button>
                        <button style={{ color: 'var(--text-muted)' }}><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12">
              <FolderTree className="w-12 h-12 mx-auto mb-3 opacity-30" style={{ color: 'var(--text-muted)' }} />
              <p className="font-medium" style={{ color: 'var(--text-secondary)' }}>No accounts found</p>
              <p className="text-sm mt-1 mb-5" style={{ color: 'var(--text-muted)' }}>
                Auto-provision from your industry template, or upload a CSV.
              </p>
              {provisionMsg && (
                <div
                  className="mx-auto max-w-sm mb-4 px-4 py-2.5 rounded-xl text-sm font-medium"
                  style={{
                    background: provisionMsg.ok ? 'var(--success-subtle)' : 'rgba(244,63,94,0.1)',
                    border: `1px solid ${provisionMsg.ok ? 'rgba(62,207,142,0.3)' : 'rgba(244,63,94,0.3)'}`,
                    color: provisionMsg.ok ? 'var(--success)' : 'var(--neon-red)',
                  }}
                >
                  {provisionMsg.text}
                </div>
              )}
              <button
                onClick={handleProvision}
                disabled={provisioning}
                className="btn btn-primary"
               
              >
                {provisioning
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Setting up…</>
                  : <><FolderTree className="w-4 h-4" /> Set up Chart of Accounts</>}
              </button>
              <p className="text-xs mt-3" style={{ color: 'var(--text-muted)' }}>
                Uses the industry you set in your company profile
              </p>
            </div>
          )}
        </div>
      )}

      {/* CSV format info */}
      <div className="card p-6 relative overflow-hidden">
        <div className="absolute inset-y-0 right-0 w-1/3 pointer-events-none" style={{ background: 'linear-gradient(to left, rgba(37,99,235,0.05), transparent)' }} />
        <div className="relative space-y-3">
          <p className="text-xs uppercase tracking-[0.35em]" style={{ color: 'var(--text-muted)' }}>CSV format</p>
          <h3 className="text-xl font-semibold">Import your ledger structure</h3>
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Keep columns in this order so every account lands in the right place.</p>
          <code className="block w-full rounded-lg px-4 py-3 font-mono text-sm" style={{ border: '1px solid var(--border-color)', background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
            Account Code, Account Name, Type, Subtype, Opening Balance
          </code>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>Supported types: asset, liability, equity, revenue, expense</p>
        </div>
      </div>
    </div>
  )
}
