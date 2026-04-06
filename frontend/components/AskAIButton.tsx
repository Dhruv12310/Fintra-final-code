'use client'

import { useEffect, useState } from 'react'
import { Sparkles, X, Send, Loader2, Trash2 } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { api } from '@/lib/api'
import { useAuth } from '@/contexts/AuthContext'

interface Message {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

const CHAT_CACHE_KEY = 'endless_ai_chat_';
const CHAT_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CachedChat {
  messages: Message[];
  timestamp: number;
}

const sanitizeAIResponse = (text: string) =>
  text
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/\*/g, '')
    .replace(/\s+\n/g, '\n')
    .trim()

export default function AskAIButton() {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const { company } = useAuth()
  const companyContextId = company?.id ?? null
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [attemptedFallback, setAttemptedFallback] = useState(false)

  // Load chat from cache when company ID is available
  useEffect(() => {
    if (companyId) {
      loadChatFromCache(companyId);
    }
  }, [companyId]);

  // Save chat to cache whenever messages change
  useEffect(() => {
    if (companyId && messages.length > 0) {
      saveChatToCache(companyId, messages);
    }
  }, [messages, companyId]);

  useEffect(() => {
    if (companyContextId) {
      setCompanyId(companyContextId)
      return
    }

    if (companyId || attemptedFallback) return

    const fetchFallbackCompany = async () => {
      try {
        const companies = await api.get('/companies/')
        if (companies.data && companies.data.length > 0) {
          setCompanyId(companies.data[0].id)
        }
      } catch (err) {
        console.error('Unable to resolve company for AI assistant:', err)
      } finally {
        setAttemptedFallback(true)
      }
    }

    fetchFallbackCompany()
  }, [companyContextId, companyId, attemptedFallback])

  const loadChatFromCache = (companyId: string) => {
    try {
      const cacheKey = `${CHAT_CACHE_KEY}${companyId}`;
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return;

      const parsed: CachedChat = JSON.parse(cached);
      const now = Date.now();

      // Check if cache is expired
      if (now - parsed.timestamp > CHAT_CACHE_DURATION) {
        localStorage.removeItem(cacheKey);
        return;
      }

      // Restore messages with Date objects
      const restoredMessages = parsed.messages.map(msg => ({
        ...msg,
        timestamp: new Date(msg.timestamp)
      }));
      setMessages(restoredMessages);
    } catch (error) {
      console.error('Failed to load chat from cache:', error);
    }
  };

  const saveChatToCache = (companyId: string, messages: Message[]) => {
    try {
      const cacheKey = `${CHAT_CACHE_KEY}${companyId}`;
      const cached: CachedChat = {
        messages,
        timestamp: Date.now()
      };
      localStorage.setItem(cacheKey, JSON.stringify(cached));
    } catch (error) {
      console.error('Failed to save chat to cache:', error);
    }
  };

  const clearChat = () => {
    if (!companyId) return;
    const cacheKey = `${CHAT_CACHE_KEY}${companyId}`;
    localStorage.removeItem(cacheKey);
    setMessages([]);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    if (!companyId) {
      setMessages(prev => [
        ...prev,
        {
          role: 'assistant',
          content: 'Connect a company to unlock AI insights. Complete onboarding so I know which books to analyze!',
          timestamp: new Date()
        }
      ])
      return
    }

    const userMessage: Message = {
      role: 'user',
      content: input,
      timestamp: new Date()
    }

    setMessages(prev => [...prev, userMessage])
    setInput('')
    setIsLoading(true)

    try {
      const response = await api.post('/ai/query', {
        company_id: companyId,
        question: input.trim()
      })
      const aiMessage: Message = {
        role: 'assistant',
        content: sanitizeAIResponse(response.answer || 'I apologize, but I couldn\'t process that request.'),
        timestamp: new Date()
      }
      setMessages(prev => [...prev, aiMessage])
    } catch (error: any) {
      console.error('AI chat error:', error)
      const detail = error?.response?.data?.detail
      const readableDetail = typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : null
      const errorMessage: Message = {
        role: 'assistant',
        content: sanitizeAIResponse(
          readableDetail
            ? `Sorry, I encountered an error: ${readableDetail}`
            : 'Sorry, I encountered an error. Please try again.'
        ),
        timestamp: new Date()
      }
      setMessages(prev => [...prev, errorMessage])
    } finally {
      setIsLoading(false)
    }
  }

  const quickQuestions = [
    "What's my financial health this month?",
    "Show me top expenses",
    "Explain this transaction",
    "Predict next month's expenses"
  ]

  return (
    <>
      <motion.button
        layoutId="ask-ai-pill"
        onClick={() => setIsOpen(true)}
        className="group fixed bottom-6 right-6 z-50 flex items-center gap-3 rounded-full border border-white/20 bg-slate-950/70 px-6 py-3 text-white shadow-[0_20px_60px_rgba(129,80,255,0.35)] backdrop-blur-xl"
        whileHover={{ scale: 1.04, boxShadow: '0 25px 80px rgba(129,80,255,0.55)' }}
        whileTap={{ scale: 0.97 }}
      >
        <span className="relative flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-r from-fuchsia-500 to-sky-500">
          <div className="absolute inset-0 rounded-2xl blur-md bg-gradient-to-r from-fuchsia-500/70 to-sky-500/70" />
          <Sparkles className="relative h-4 w-4 text-white" />
        </span>
        <span className="font-semibold tracking-wide">Ask Fintra AI</span>
        <span className="text-xs text-white/60 group-hover:text-white/80">⌘K</span>
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 30, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 200, damping: 25 }}
            className="fixed bottom-6 right-6 z-50 flex h-[600px] w-[420px] flex-col overflow-hidden rounded-[32px] border border-white/10 bg-gradient-to-br from-slate-950/95 via-slate-900/90 to-slate-950/80 text-slate-100 shadow-[0_35px_140px_rgba(2,6,23,0.75)] backdrop-blur-3xl"
          >
            <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(236,72,153,0.25),_transparent_45%)]" />
            <div className="relative flex items-center justify-between border-b border-white/10 px-5 py-4">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/20 bg-white/5">
                  <Sparkles className="h-5 w-5 text-fuchsia-200" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs uppercase tracking-[0.4em] text-white/60">Copilot</p>
                    {messages.length > 0 && (
                      <span className="text-[0.6rem] px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                        Chat saved
                      </span>
                    )}
                  </div>
                  <h3 className="text-lg font-semibold text-white">Realtime finance analyst</h3>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {messages.length > 0 && (
                  <motion.button
                    onClick={clearChat}
                    className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-white/70 transition hover:text-red-400 hover:border-red-400/30"
                    whileHover={{ scale: 1.05 }}
                    title="Clear chat history"
                  >
                    <Trash2 className="h-4 w-4" />
                  </motion.button>
                )}
                <motion.button
                  onClick={() => setIsOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-2xl border border-white/15 bg-white/5 text-white/70 transition hover:text-white"
                  whileHover={{ rotate: 90 }}
                  aria-label="Close AI console"
                >
                  <X className="h-4 w-4" />
                </motion.button>
              </div>
            </div>

            <div className="relative flex-1 space-y-4 overflow-y-auto px-5 py-4 custom-scrollbar">
              {messages.length === 0 && (
                <div className="space-y-4 text-sm text-white/70">
                  <p className="text-center">
                    {companyId
                      ? "I'm synced with your ledgers. Ask about burn, runway, or any anomaly."
                      : 'Loading your demo company. Seed data to start the conversation.'}
                  </p>
                  <div className="space-y-2">
                    <p className="text-xs uppercase tracking-[0.4em] text-white/50">Try</p>
                    <div className="grid gap-2">
                      {quickQuestions.map((question, idx) => (
                        <button
                          key={idx}
                          onClick={() => setInput(question)}
                          className="rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-left text-sm transition hover:border-fuchsia-400/40 hover:bg-white/10"
                        >
                          {question}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {messages.map((message, idx) => (
                <motion.div
                  key={`${message.role}-${idx}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[80%] rounded-3xl px-4 py-3 text-sm leading-relaxed shadow-2xl ${
                      message.role === 'user'
                        ? 'bg-gradient-to-r from-fuchsia-500/80 to-cyan-500/80 text-white'
                        : 'border border-white/10 bg-white/5 text-slate-100'
                    }`}
                  >
                    <p className="whitespace-pre-wrap">{message.content}</p>
                    <p className="mt-2 text-xs text-white/60">
                      {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </motion.div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/70">
                    <Loader2 className="mr-2 inline-block h-4 w-4 animate-spin align-middle" />
                    Crunching ledgers...
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSubmit} className="relative border-t border-white/10 px-5 py-4">
              <div className="flex gap-2 rounded-full border border-white/15 bg-white/5 p-1.5">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Ask about your finances..."
                  className="flex-1 bg-transparent px-3 text-sm text-white placeholder:text-white/40 focus:outline-none"
                  disabled={isLoading || !companyId}
                />
                <motion.button
                  type="submit"
                  disabled={isLoading || !input.trim() || !companyId}
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-white shadow-[0_10px_40px_rgba(147,51,234,0.4)] disabled:opacity-40"
                  whileTap={{ scale: 0.9 }}
                >
                  <Send className="h-4 w-4" />
                </motion.button>
              </div>
              {!companyId && (
                <p className="mt-2 text-xs text-amber-300">
                  Waiting on demo books. Run a seed script to let Copilot analyze balances.
                </p>
              )}
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
