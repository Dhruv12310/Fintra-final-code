'use client'

import { useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useAuth } from '@/contexts/AuthContext'
import AgentChat from './AgentChat'

export default function AskAIButton() {
  const [isOpen, setIsOpen] = useState(false)
  const { user } = useAuth()
  const canAccessAI = ['owner', 'admin', 'accountant'].includes((user?.role || '').toLowerCase())

  if (!canAccessAI) return null

  return (
    <>
      <motion.button
        layoutId="ask-ai-pill"
        onClick={() => setIsOpen(true)}
        className="group fixed bottom-6 right-6 z-50 flex items-center gap-2.5 rounded-full transition-colors"
        style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-strong)',
          padding: '8px 14px 8px 8px',
          boxShadow: 'var(--shadow-lg)',
          color: 'var(--text-primary)',
        }}
        whileHover={{ y: -1, boxShadow: 'var(--shadow-xl)' }}
        whileTap={{ scale: 0.98 }}
      >
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full"
          style={{
            background: 'var(--accent)',
            boxShadow: '0 1px 3px rgba(37,99,235,0.3)',
          }}
        >
          <Sparkles className="h-3.5 w-3.5 text-white" strokeWidth={2.25} />
        </span>
        <span className="text-sm font-medium" style={{ letterSpacing: '-0.01em' }}>
          Ask AI
        </span>
        <span
          className="text-xs font-medium num px-1.5 py-0.5 rounded"
          style={{
            color: 'var(--text-muted)',
            background: 'var(--bg-muted)',
            border: '1px solid var(--border-color)',
            fontSize: 10.5,
          }}
        >
          ⌘K
        </span>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 260, damping: 28 }}
            className="fixed bottom-6 right-6 z-50 flex h-[640px] w-[440px] flex-col overflow-hidden"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-strong)',
              borderRadius: 14,
              boxShadow: 'var(--shadow-xl)',
            }}
          >
            <button
              onClick={() => setIsOpen(false)}
              className="absolute top-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-md transition-colors"
              style={{
                color: 'var(--text-muted)',
                background: 'transparent',
              }}
              onMouseEnter={e => {
                const el = e.currentTarget
                el.style.background = 'var(--bg-muted)'
                el.style.color = 'var(--text-primary)'
              }}
              onMouseLeave={e => {
                const el = e.currentTarget
                el.style.background = 'transparent'
                el.style.color = 'var(--text-muted)'
              }}
              aria-label="Close AI"
            >
              <X className="h-3.5 w-3.5" />
            </button>

            <AgentChat />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
