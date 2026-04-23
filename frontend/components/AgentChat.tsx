'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Sparkles, Send, Loader2, CheckCircle2, XCircle,
  ChevronDown, ChevronRight, Wrench, AlertCircle,
  RotateCcw, Plus,
} from 'lucide-react'
import { api, API_BASE } from '@/lib/api'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'

// ── Types ──────────────────────────────────────────────────────────

interface TextMessage {
  id: string
  role: 'user' | 'assistant'
  type: 'text'
  content: string
}

interface ToolCallMessage {
  id: string
  role: 'assistant'
  type: 'tool_call'
  toolName: string
  args: Record<string, unknown>
  result?: Record<string, unknown>
  collapsed: boolean
}

interface JournalEntryPreview {
  type: 'journal_entry'
  date: string
  memo: string
  lines: Array<{
    account: { id: string; name: string }
    debit: number
    credit: number
  }>
  balance_check: {
    debits_total: number
    credits_total: number
    balanced: boolean
  }
  warnings: string[]
  unusual_patterns: string[]
}

type PreviewData = JournalEntryPreview | Record<string, unknown> | null

interface ConfirmationMessage {
  id: string
  role: 'assistant'
  type: 'confirmation'
  actionId: string
  preview: PreviewData
  message: string
  status: 'pending' | 'approved' | 'rejected'
}

interface ErrorMessage {
  id: string
  role: 'assistant'
  type: 'error'
  content: string
}

type ChatMessage = TextMessage | ToolCallMessage | ConfirmationMessage | ErrorMessage

// ── Helpers ────────────────────────────────────────────────────────

function uid() {
  return Math.random().toString(36).slice(2)
}

const SUGGESTED_PROMPTS = [
  "What's my current cash balance?",
  "Show me overdue invoices",
  "Categorize all pending bank transactions",
  "Create a journal entry for rent expense $3,000",
  "Set up monthly recurring rent of $3,000",
  "Reconcile my checking account for this month",
]

// ── Sub-components ─────────────────────────────────────────────────

function ToolCallBubble({ msg, onToggle }: {
  msg: ToolCallMessage
  onToggle: () => void
}) {
  const toolLabel = msg.toolName.replace(/_/g, ' ')
  const hasResult = !!msg.result

  return (
    <div className="flex justify-start mb-2">
      <div
        className="max-w-[85%] rounded-xl px-3 py-2 text-xs cursor-pointer select-none"
        style={{
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-color)',
          color: 'var(--text-muted)',
        }}
        onClick={onToggle}
      >
        <div className="flex items-center gap-2">
          {hasResult ? (
            <CheckCircle2 className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--neon-emerald)' }} />
          ) : (
            <Loader2 className="w-3 h-3 flex-shrink-0 animate-spin" style={{ color: 'var(--accent)' }} />
          )}
          <Wrench className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--accent)' }} />
          <span className="font-medium" style={{ color: 'var(--accent)' }}>{toolLabel}</span>
          {msg.collapsed ? <ChevronRight className="w-3 h-3 ml-auto" /> : <ChevronDown className="w-3 h-3 ml-auto" />}
        </div>

        {!msg.collapsed && (
          <div className="mt-2 space-y-1.5" style={{ borderTop: '1px solid var(--border-color)', paddingTop: 8 }}>
            {Object.keys(msg.args).length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Arguments</p>
                <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {JSON.stringify(msg.args, null, 2)}
                </pre>
              </div>
            )}
            {msg.result && (
              <div>
                <p className="text-[10px] uppercase tracking-wider mb-1" style={{ color: 'var(--text-muted)' }}>Result</p>
                <pre className="text-[10px] overflow-x-auto whitespace-pre-wrap" style={{ color: 'var(--text-secondary)' }}>
                  {JSON.stringify(msg.result, null, 2)}
                </pre>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function fmt(n: number) {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function JournalPreviewTable({ preview }: { preview: JournalEntryPreview }) {
  return (
    <div className="mt-3 rounded-lg overflow-hidden" style={{ border: '1px solid var(--border-color)' }}>
      {/* Meta row */}
      <div
        className="px-3 py-2 flex items-center justify-between text-xs"
        style={{ background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border-color)' }}
      >
        <span style={{ color: 'var(--text-muted)' }}>{preview.date}</span>
        <span className="font-medium" style={{ color: 'var(--text-primary)' }}>{preview.memo}</span>
      </div>

      {/* Lines table */}
      <table className="w-full text-xs">
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border-color)' }}>
            <th className="px-3 py-1.5 text-left font-medium" style={{ color: 'var(--text-muted)' }}>Account</th>
            <th className="px-3 py-1.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>Debit</th>
            <th className="px-3 py-1.5 text-right font-medium" style={{ color: 'var(--text-muted)' }}>Credit</th>
          </tr>
        </thead>
        <tbody>
          {preview.lines.map((line, i) => (
            <tr
              key={i}
              style={{
                borderBottom: i < preview.lines.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}
            >
              <td className="px-3 py-1.5" style={{ color: 'var(--text-primary)' }}>
                {line.account.name}
              </td>
              <td
                className="px-3 py-1.5 text-right font-mono"
                style={{ color: line.debit ? 'var(--neon-cyan)' : 'transparent' }}
              >
                {line.debit ? `$${fmt(line.debit)}` : '—'}
              </td>
              <td
                className="px-3 py-1.5 text-right font-mono"
                style={{ color: line.credit ? 'var(--neon-fuchsia)' : 'transparent' }}
              >
                {line.credit ? `$${fmt(line.credit)}` : '—'}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '1px solid var(--border-color)' }}>
            <td className="px-3 py-1.5 text-xs font-semibold" style={{ color: 'var(--neon-emerald)' }}>
              ✓ Balanced
            </td>
            <td className="px-3 py-1.5 text-right font-mono font-semibold" style={{ color: 'var(--neon-cyan)' }}>
              ${fmt(preview.balance_check.debits_total)}
            </td>
            <td className="px-3 py-1.5 text-right font-mono font-semibold" style={{ color: 'var(--neon-fuchsia)' }}>
              ${fmt(preview.balance_check.credits_total)}
            </td>
          </tr>
        </tfoot>
      </table>

      {/* Warnings */}
      {preview.warnings?.length > 0 && (
        <div
          className="px-3 py-2 space-y-0.5"
          style={{ borderTop: '1px solid var(--border-color)', background: 'rgba(251,191,36,0.04)' }}
        >
          {preview.warnings.map((w, i) => (
            <p key={i} className="text-xs" style={{ color: '#fbbf24' }}>⚠️ {w}</p>
          ))}
        </div>
      )}

      {/* Unusual patterns */}
      {preview.unusual_patterns?.length > 0 && (
        <div
          className="px-3 py-2 space-y-0.5"
          style={{ borderTop: '1px solid var(--border-color)', background: 'var(--bg-secondary)' }}
        >
          {preview.unusual_patterns.map((p, i) => (
            <p key={i} className="text-xs" style={{ color: 'var(--text-muted)' }}>🔍 {p}</p>
          ))}
        </div>
      )}
    </div>
  )
}

function PreviewBlock({ preview }: { preview: PreviewData }) {
  if (!preview) return null
  if ((preview as JournalEntryPreview).type === 'journal_entry') {
    return <JournalPreviewTable preview={preview as JournalEntryPreview} />
  }
  return (
    <pre
      className="mt-2 text-xs p-2.5 rounded-lg whitespace-pre-wrap font-mono leading-relaxed"
      style={{
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-color)',
        color: 'var(--text-primary)',
      }}
    >
      {JSON.stringify(preview, null, 2)}
    </pre>
  )
}

function ConfirmationCard({ msg, onApprove, onReject }: {
  msg: ConfirmationMessage
  onApprove: () => void
  onReject: () => void
}) {
  const isDone = msg.status !== 'pending'

  return (
    <div className="flex justify-start mb-3">
      <div
        className="max-w-[90%] rounded-xl overflow-hidden"
        style={{
          border: `1px solid ${
            msg.status === 'approved' ? 'rgba(52,211,153,0.3)' :
            msg.status === 'rejected' ? 'rgba(248,113,113,0.2)' :
            'rgba(37,99,235,0.2)'
          }`,
          background: msg.status === 'approved'
            ? 'rgba(52,211,153,0.05)'
            : msg.status === 'rejected'
            ? 'rgba(248,113,113,0.05)'
            : 'rgba(37,99,235,0.05)',
        }}
      >
        {/* Header */}
        <div
          className="px-4 py-2.5 flex items-center gap-2"
          style={{
            background: msg.status === 'approved'
              ? 'rgba(52,211,153,0.08)'
              : msg.status === 'rejected'
              ? 'rgba(248,113,113,0.08)'
              : 'rgba(37,99,235,0.08)',
            borderBottom: '1px solid rgba(255,255,255,0.05)',
          }}
        >
          {msg.status === 'approved' ? (
            <CheckCircle2 className="w-4 h-4" style={{ color: 'var(--neon-emerald)' }} />
          ) : msg.status === 'rejected' ? (
            <XCircle className="w-4 h-4" style={{ color: '#f87171' }} />
          ) : (
            <AlertCircle className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          )}
          <span className="text-xs font-semibold" style={{
            color: msg.status === 'approved' ? 'var(--neon-emerald)' :
                   msg.status === 'rejected' ? '#f87171' :
                   'var(--accent)'
          }}>
            {msg.status === 'approved' ? 'Action Approved' :
             msg.status === 'rejected' ? 'Action Rejected' :
             'Confirm Action'}
          </span>
        </div>

        {/* Message + Preview */}
        <div className="px-4 py-3">
          <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{msg.message}</p>
          <PreviewBlock preview={msg.preview} />
        </div>

        {/* Actions */}
        {!isDone && (
          <div className="px-4 pb-3 flex gap-2">
            <button
              onClick={onApprove}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all hover:opacity-90"
              style={{ background: 'var(--neon-emerald)', color: '#000' }}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              Approve
            </button>
            <button
              onClick={onReject}
              className="flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg transition-all"
              style={{ background: 'rgba(248,113,113,0.12)', color: '#f87171', border: '1px solid rgba(248,113,113,0.25)' }}
            >
              <XCircle className="w-3.5 h-3.5" />
              Reject
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function TextBubble({ msg }: { msg: TextMessage }) {
  const isUser = msg.role === 'user'
  return (
    <div className={`flex mb-2 ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
        style={{
          background: isUser ? 'var(--accent-subtle)' : 'var(--bg-card)',
          border: isUser ? '1px solid rgba(37,99,235,0.2)' : '1px solid var(--border-color)',
          color: isUser ? 'var(--accent-text)' : 'var(--text-primary)',
          borderBottomRightRadius: isUser ? 4 : 12,
          borderBottomLeftRadius: isUser ? 12 : 4,
        }}
      >
        {msg.content}
      </div>
    </div>
  )
}

// ── Main Component ─────────────────────────────────────────────────

export default function AgentChat({ initialSessionId }: { initialSessionId?: string }) {
  const { company } = useAuth()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [sessionId, setSessionId] = useState<string | null>(initialSessionId || null)
  const [streaming, setStreaming] = useState(false)
  const [currentText, setCurrentText] = useState('')
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const readerRef = useRef<ReadableStreamDefaultReader | null>(null)

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [])

  useEffect(() => { scrollToBottom() }, [messages, currentText])

  function addMessage(msg: ChatMessage) {
    setMessages(prev => [...prev, msg])
  }

  function updateMessage(id: string, updater: (m: ChatMessage) => ChatMessage) {
    setMessages(prev => prev.map(m => m.id === id ? updater(m) : m))
  }

  async function sendMessage(text: string, confirmActionId?: string) {
    if (!text.trim() && !confirmActionId) return
    if (streaming) return

    if (text.trim()) {
      addMessage({ id: uid(), role: 'user', type: 'text', content: text.trim() })
      setInput('')
    }
    setStreaming(true)
    setCurrentText('')

    let localSessionId = sessionId
    let assistantTextId = uid()
    let assistantText = ''
    let toolCallId: string | null = null

    try {
      const { data: { session } } = await supabase!.auth.getSession()
      const token = session?.access_token || null
      const response = await fetch(`${API_BASE}/agent/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          message: text.trim() || '__confirm__',
          session_id: localSessionId,
          confirm_action_id: confirmActionId,
        }),
      })

      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status}`)
      }

      const reader = response.body.getReader()
      readerRef.current = reader
      const decoder = new TextDecoder()
      let buf = ''

      while (true) {
        const { value, done } = await reader.read()
        if (done) break

        buf += decoder.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() || ''

        for (const part of parts) {
          if (!part.startsWith('data: ')) continue
          const jsonStr = part.slice(6).trim()
          if (!jsonStr) continue
          let event: Record<string, unknown>
          try { event = JSON.parse(jsonStr) } catch { continue }

          const type = event.type as string

          if (type === 'text') {
            const chunk = event.content as string
            assistantText += chunk
            setCurrentText(assistantText)

          } else if (type === 'tool_call') {
            // Flush accumulated text first
            if (assistantText.trim()) {
              addMessage({ id: assistantTextId, role: 'assistant', type: 'text', content: assistantText.trim() })
              assistantText = ''
              assistantTextId = uid()
              setCurrentText('')
            }
            toolCallId = uid()
            addMessage({
              id: toolCallId,
              role: 'assistant',
              type: 'tool_call',
              toolName: event.name as string,
              args: (event.args as Record<string, unknown>) || {},
              collapsed: true,
            })

          } else if (type === 'tool_result') {
            if (toolCallId) {
              const result = event.result as Record<string, unknown>
              updateMessage(toolCallId, m => ({
                ...(m as ToolCallMessage),
                result,
                collapsed: true,
              }))
              toolCallId = null
            }

          } else if (type === 'confirmation_request') {
            // Flush text
            if (assistantText.trim()) {
              addMessage({ id: assistantTextId, role: 'assistant', type: 'text', content: assistantText.trim() })
              assistantText = ''
              assistantTextId = uid()
              setCurrentText('')
            }
            addMessage({
              id: uid(),
              role: 'assistant',
              type: 'confirmation',
              actionId: event.action_id as string,
              preview: (event.preview as PreviewData) ?? null,
              message: event.message as string || 'Confirm this action?',
              status: 'pending',
            })

          } else if (type === 'done') {
            if (event.session_id) {
              setSessionId(event.session_id as string)
              localSessionId = event.session_id as string
            }
            if (assistantText.trim()) {
              addMessage({ id: assistantTextId, role: 'assistant', type: 'text', content: assistantText.trim() })
              assistantText = ''
              setCurrentText('')
            }

          } else if (type === 'error') {
            if (assistantText.trim()) {
              addMessage({ id: assistantTextId, role: 'assistant', type: 'text', content: assistantText.trim() })
              setCurrentText('')
            }
            addMessage({
              id: uid(),
              role: 'assistant',
              type: 'error',
              content: event.message as string || 'Something went wrong.',
            })
          }
        }
      }
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Failed to connect to agent.'
      addMessage({ id: uid(), role: 'assistant', type: 'error', content: errMsg })
    } finally {
      if (assistantText.trim()) {
        addMessage({ id: assistantTextId, role: 'assistant', type: 'text', content: assistantText.trim() })
      }
      setCurrentText('')
      setStreaming(false)
      readerRef.current = null
      inputRef.current?.focus()
    }
  }

  async function handleApprove(confirmMsg: ConfirmationMessage) {
    updateMessage(confirmMsg.id, m => ({ ...(m as ConfirmationMessage), status: 'approved' }))
    await sendMessage('', confirmMsg.actionId)
  }

  async function handleReject(confirmMsg: ConfirmationMessage) {
    updateMessage(confirmMsg.id, m => ({ ...(m as ConfirmationMessage), status: 'rejected' }))
    try {
      await api.delete(`/agent/actions/${confirmMsg.actionId}`)
    } catch { /* ignore */ }
    addMessage({ id: uid(), role: 'assistant', type: 'text', content: 'Action cancelled.' })
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage(input)
    }
  }

  function newChat() {
    setMessages([])
    setSessionId(null)
    setCurrentText('')
    setInput('')
  }

  const isEmpty = messages.length === 0 && !streaming

  return (
    <div className="flex flex-col h-full" style={{ color: 'var(--text-primary)' }}>

      {/* ── Header ── */}
      <div
        className="flex items-center justify-between px-5 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--border-color)' }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="flex h-8 w-8 items-center justify-center rounded-xl"
            style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(37,99,235,0.2)' }}
          >
            <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>Fintra AI</p>
            <p className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {streaming ? 'Thinking…' : 'Your accounting copilot'}
            </p>
          </div>
        </div>
        <button
          onClick={newChat}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-opacity hover:opacity-70"
          style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-color)', color: 'var(--text-muted)' }}
        >
          <Plus className="w-3.5 h-3.5" />
          New Chat
        </button>
      </div>

      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {isEmpty && (
          <div className="flex flex-col items-center justify-center h-full gap-6 pb-8">
            <div>
              <div
                className="mx-auto flex h-16 w-16 items-center justify-center rounded-xl mb-4"
                style={{ background: 'var(--accent-subtle)', border: '1px solid rgba(37,99,235,0.15)' }}
              >
                <Sparkles className="w-7 h-7" style={{ color: 'var(--accent)' }} />
              </div>
              <h2 className="text-center text-base font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                How can I help with {company?.name || 'your finances'}?
              </h2>
              <p className="text-center text-xs" style={{ color: 'var(--text-muted)' }}>
                I can answer questions, create entries, categorize transactions, and more.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2 w-full max-w-md">
              {SUGGESTED_PROMPTS.map(prompt => (
                <button
                  key={prompt}
                  onClick={() => sendMessage(prompt)}
                  className="text-left px-4 py-2.5 text-xs rounded-xl transition-all hover:scale-[1.01]"
                  style={{
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border-color)',
                    color: 'var(--text-secondary)',
                  }}
                >
                  {prompt}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => {
          if (msg.type === 'text') {
            return <TextBubble key={msg.id} msg={msg} />
          }
          if (msg.type === 'tool_call') {
            return (
              <ToolCallBubble
                key={msg.id}
                msg={msg}
                onToggle={() => updateMessage(msg.id, m => ({
                  ...(m as ToolCallMessage),
                  collapsed: !(m as ToolCallMessage).collapsed,
                }))}
              />
            )
          }
          if (msg.type === 'confirmation') {
            return (
              <ConfirmationCard
                key={msg.id}
                msg={msg}
                onApprove={() => handleApprove(msg)}
                onReject={() => handleReject(msg)}
              />
            )
          }
          if (msg.type === 'error') {
            return (
              <div key={msg.id} className="flex justify-start mb-2">
                <div
                  className="max-w-[80%] flex items-start gap-2 rounded-xl px-3 py-2.5 text-sm"
                  style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', color: '#f87171' }}
                >
                  <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                  {msg.content}
                </div>
              </div>
            )
          }
          return null
        })}

        {/* Live streaming text */}
        {currentText && (
          <div className="flex justify-start mb-2">
            <div
              className="max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap"
              style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border-color)',
                color: 'var(--text-primary)',
                borderBottomLeftRadius: 4,
              }}
            >
              {currentText}
              <span
                className="inline-block w-1.5 h-3.5 ml-0.5 animate-pulse rounded-sm"
                style={{ background: 'var(--accent)', verticalAlign: 'middle' }}
              />
            </div>
          </div>
        )}

        {/* Thinking indicator */}
        {streaming && !currentText && (
          <div className="flex justify-start mb-2">
            <div
              className="flex items-center gap-2 rounded-xl px-4 py-2.5"
              style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', borderBottomLeftRadius: 4 }}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin" style={{ color: 'var(--accent)' }} />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>Thinking…</span>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* ── Input ── */}
      <div className="flex-shrink-0 px-4 pb-4 pt-2" style={{ borderTop: '1px solid var(--border-color)' }}>
        <div
          className="flex items-end gap-2 rounded-xl px-3 py-2"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)' }}
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything about your finances… (Enter to send, Shift+Enter for newline)"
            disabled={streaming}
            rows={1}
            className="flex-1 resize-none text-sm outline-none bg-transparent leading-relaxed"
            style={{
              color: 'var(--text-primary)',
              maxHeight: 120,
              overflowY: 'auto',
            }}
            onInput={e => {
              const el = e.currentTarget
              el.style.height = 'auto'
              el.style.height = Math.min(el.scrollHeight, 120) + 'px'
            }}
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={streaming || !input.trim()}
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl transition-all disabled:opacity-40"
            style={{
              background: streaming || !input.trim()
                ? 'var(--bg-secondary)'
                : 'var(--accent)',
              color: streaming || !input.trim() ? 'var(--text-muted)' : '#fff',
            }}
          >
            {streaming
              ? <Loader2 className="w-4 h-4 animate-spin" />
              : <Send className="w-4 h-4" />
            }
          </button>
        </div>
        <p className="text-center text-[10px] mt-1.5" style={{ color: 'var(--text-muted)' }}>
          AI can make mistakes. Always review before posting financial entries.
        </p>
      </div>
    </div>
  )
}
