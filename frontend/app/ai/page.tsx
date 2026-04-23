'use client'

import { useAuth } from '@/contexts/AuthContext'
import AgentChat from '@/components/AgentChat'

export default function AIPage() {
  const { user } = useAuth()
  const canAccess = ['owner', 'admin', 'accountant'].includes((user?.role || '').toLowerCase())

  if (!canAccess) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          AI access requires accountant role or higher.
        </p>
      </div>
    )
  }

  return (
    <div style={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
      <AgentChat />
    </div>
  )
}
