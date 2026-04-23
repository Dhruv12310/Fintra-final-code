'use client'

import { useState, useEffect } from 'react'
import { api } from '@/lib/api'
import { useTheme } from '@/contexts/ThemeContext'
import { Brain, TrendingUp, Send, Sparkles, ExternalLink, DollarSign, BarChart2, Target, Lightbulb, List, Rocket } from 'lucide-react'

type AIMode = 'local' | 'research'

interface Message {
  role: 'user' | 'assistant'
  content: string
  citations?: string[]
  timestamp: Date
  mode?: AIMode
}

export default function EnhancedAIConsole() {
  const { theme } = useTheme()
  const [mode, setMode] = useState<AIMode>('local')
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [researchCapabilities, setResearchCapabilities] = useState<any>(null)

  useEffect(() => {
    // Load research capabilities
    const loadCapabilities = async () => {
      try {
        const caps = await api.get('/ai/research/capabilities')
        setResearchCapabilities(caps)
      } catch (error) {
        console.error('Failed to load capabilities:', error)
      }
    }
    loadCapabilities()
  }, [])

  const sendMessage = async (message: string, quickAction?: string) => {
    if (!message.trim() && !quickAction) return

    const userMessage = message || quickAction || ''
    setMessages(prev => [...prev, {
      role: 'user',
      content: userMessage,
      timestamp: new Date(),
      mode
    }])

    setInput('')
    setLoading(true)

    try {
      let response: any

      if (mode === 'local') {
        // OpenAI - Local financial analysis
        response = await api.post('/ai/query', {
          question: userMessage
        })

        setMessages(prev => [...prev, {
          role: 'assistant',
          content: response.answer || response.response || 'No response received.',
          timestamp: new Date(),
          mode: 'local'
        }])

      } else {
        // Perplexity - Market research
        if (quickAction === 'benchmarks') {
          response = await api.post('/ai/research/industry-benchmarks')
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response.benchmarks,
            citations: response.citations,
            timestamp: new Date(),
            mode: 'research'
          }])
        } else if (quickAction === 'competitors') {
          response = await api.post('/ai/research/competitor-analysis')
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response.analysis,
            citations: response.citations,
            timestamp: new Date(),
            mode: 'research'
          }])
        } else if (quickAction === 'tax') {
          response = await api.post('/ai/research/tax-updates')
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response.updates,
            citations: response.citations,
            timestamp: new Date(),
            mode: 'research'
          }])
        } else if (quickAction === 'growth') {
          response = await api.post('/ai/research/growth-recommendations')
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: response.recommendations,
            citations: response.citations,
            timestamp: new Date(),
            mode: 'research'
          }])
        } else {
          // Generic query - prompt to use quick actions
          setMessages(prev => [...prev, {
            role: 'assistant',
            content: 'For market research, please use one of the quick action buttons above. Switch to "Local Analysis" mode if you want to ask questions about your own financial data.',
            timestamp: new Date(),
            mode: 'research'
          }])
        }
      }
    } catch (error: any) {
      console.error('AI query failed:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Error: ${error.response?.data?.detail || error.message || 'Failed to get response. Please try again.'}`,
        timestamp: new Date(),
        mode
      }])
    } finally {
      setLoading(false)
    }
  }

  const LOCAL_PROMPTS = [
    { icon: DollarSign,  label: 'Top Expenses', prompt: 'What are my top 5 expenses this month?' },
    { icon: BarChart2,   label: 'Cash Flow',    prompt: 'How is my cash flow looking?' },
    { icon: TrendingUp,  label: 'Revenue',      prompt: 'What are my revenue trends?' },
    { icon: Sparkles,    label: 'Anomalies',    prompt: 'Are there any unusual transactions?' },
    { icon: Lightbulb,   label: 'Savings',      prompt: 'Where can I cut costs?' },
    { icon: Target,      label: 'Goals',        prompt: 'Am I on track to meet my goals?' }
  ]

  const RESEARCH_PROMPTS = [
    {
      icon: BarChart2,
      label: 'Industry Benchmarks',
      action: 'benchmarks',
      description: 'Compare your metrics to industry averages',
      available: researchCapabilities?.capabilities?.industry_benchmarks?.available
    },
    {
      icon: Target,
      label: 'Competitor Analysis',
      action: 'competitors',
      description: 'Analyze your competitive landscape',
      available: researchCapabilities?.capabilities?.competitor_analysis?.available
    },
    {
      icon: List,
      label: 'Tax Updates',
      action: 'tax',
      description: 'Latest tax compliance requirements',
      available: researchCapabilities?.capabilities?.tax_updates?.available
    },
    {
      icon: Rocket,
      label: 'Growth Strategies',
      action: 'growth',
      description: 'Personalized growth recommendations',
      available: researchCapabilities?.capabilities?.growth_recommendations?.available
    }
  ]

  return (
    <div
      className="flex flex-col h-full rounded-xl overflow-hidden"
      style={{
        backgroundColor: 'var(--bg-card)',
        border: '1px solid var(--border-color)'
      }}
    >
      {/* Header */}
      <div className="p-5 border-b" style={{ borderColor: 'var(--border-color)' }}>
        <div className="flex items-center gap-3 mb-4">
          <div
            className="p-2 rounded-lg"
            style={{ backgroundColor: 'var(--accent-subtle)', color: 'var(--accent)' }}
          >
            <Brain className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          </div>
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>Fintra AI Copilot</h2>
        </div>

        {/* Mode Toggle */}
        <div
          className="flex gap-1 p-1 rounded-lg"
          style={{ backgroundColor: 'var(--bg-primary)' }}
        >
          <button
            onClick={() => setMode('local')}
            className="flex-1 px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2"
            style={{
              backgroundColor: mode === 'local' ? 'var(--accent-subtle)' : 'transparent',
              color: mode === 'local' ? 'var(--accent)' : 'var(--text-secondary)',
              border: mode === 'local' ? '1px solid var(--accent)' : '1px solid transparent'
            }}
          >
            <Brain className="w-4 h-4" />
            Local Analysis
          </button>
          <button
            onClick={() => setMode('research')}
            className="flex-1 px-4 py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2"
            style={{
              backgroundColor: mode === 'research' ? 'var(--success-subtle)' : 'transparent',
              color: mode === 'research' ? 'var(--neon-emerald)' : 'var(--text-secondary)',
              border: mode === 'research' ? '1px solid var(--neon-emerald)' : '1px solid transparent'
            }}
          >
            <TrendingUp className="w-4 h-4" />
            Market Intel
          </button>
        </div>

        <p className="text-sm mt-3" style={{ color: 'var(--text-muted)' }}>
          {mode === 'local'
            ? 'Ask questions about your financial data, transactions, and trends (powered by OpenAI)'
            : 'Get real-time market insights, benchmarks, and competitor analysis (powered by Perplexity)'}
        </p>
      </div>

      {/* Quick Actions */}
      <div className="p-4 border-b" style={{ borderColor: 'var(--border-color)', backgroundColor: 'var(--bg-secondary)' }}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>Quick Actions</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {mode === 'local' ? (
            LOCAL_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => sendMessage(prompt.prompt)}
                className="p-3 rounded-lg text-left transition-all hover:scale-[1.02]"
                style={{
                  backgroundColor: 'var(--bg-card)',
                  border: '1px solid var(--border-color)'
                }}
                disabled={loading}
              >
                <prompt.icon className="w-4 h-4 mb-1.5" style={{ color: 'var(--accent)' }} />
                <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{prompt.label}</div>
              </button>
            ))
          ) : (
            RESEARCH_PROMPTS.map((prompt, i) => (
              <button
                key={i}
                onClick={() => prompt.available && sendMessage('', prompt.action)}
                className="p-3 rounded-lg text-left transition-all"
                style={{
                  backgroundColor: prompt.available ? 'var(--bg-card)' : 'var(--bg-primary)',
                  border: '1px solid var(--border-color)',
                  opacity: prompt.available ? 1 : 0.5,
                  cursor: prompt.available ? 'pointer' : 'not-allowed'
                }}
                disabled={loading || !prompt.available}
                title={prompt.available ? prompt.description : 'Complete your company profile to unlock'}
              >
                <prompt.icon className="w-4 h-4 mb-1.5" style={{ color: 'var(--accent)' }} />
                <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>{prompt.label}</div>
                {!prompt.available && (
                  <div className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>Profile needed</div>
                )}
              </button>
            ))
          )}
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="text-center py-12">
            <div
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{
                backgroundColor: 'var(--accent-subtle)',
                opacity: 1
              }}
            >
              <Brain className="w-8 h-8" style={{ color: 'var(--accent)' }} />
            </div>
            <p className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
              {mode === 'local'
                ? 'Ask me about your finances!'
                : 'Get real-time market intelligence!'}
            </p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {mode === 'local'
                ? 'Use the quick actions above or type your own question'
                : 'Click a quick action to get insights with citations'}
            </p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div
              key={i}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className="max-w-[85%] p-4 rounded-xl"
                style={{
                  background: msg.role === 'user' ? 'var(--accent-subtle)' : 'var(--bg-secondary)',
                  color: msg.role === 'user' ? 'var(--accent-text)' : 'var(--text-primary)',
                  border: msg.role === 'user' ? '1px solid rgba(37,99,235,0.2)' : '1px solid var(--border-color)'
                }}
              >
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.content}</div>

                {msg.citations && msg.citations.length > 0 && (
                  <div
                    className="mt-3 pt-3"
                    style={{ borderTop: '1px solid var(--border-color)' }}
                  >
                    <div className="text-xs font-medium mb-2 flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
                      <ExternalLink className="w-3 h-3" />
                      Sources
                    </div>
                    <div className="space-y-1">
                      {msg.citations.map((citation, idx) => (
                        <div key={idx} className="text-xs">
                          <a
                            href={citation}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:underline"
                            style={{ color: 'var(--accent)' }}
                          >
                            [{idx + 1}] {citation.length > 50 ? citation.substring(0, 50) + '...' : citation}
                          </a>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs mt-2" style={{ opacity: 0.6 }}>
                  {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  {msg.mode && (
                    <span className="ml-2">
                      • {msg.mode === 'local' ? 'OpenAI' : 'Perplexity'}
                    </span>
                  )}
                </div>
              </div>
            </div>
          ))
        )}

        {loading && (
          <div className="flex justify-start">
            <div
              className="p-4 rounded-xl"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                border: '1px solid var(--border-color)'
              }}
            >
              <div className="flex items-center gap-3">
                <div className="flex gap-1">
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent)', animationDelay: '0ms' }}></div>
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent)', animationDelay: '150ms' }}></div>
                  <div className="w-2 h-2 rounded-full animate-bounce" style={{ backgroundColor: 'var(--accent)', animationDelay: '300ms' }}></div>
                </div>
                <span className="text-sm" style={{ color: 'var(--text-muted)' }}>
                  {mode === 'local' ? 'Analyzing your data...' : 'Researching market data...'}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="p-4 border-t" style={{ borderColor: 'var(--border-color)' }}>
        <form
          onSubmit={(e) => {
            e.preventDefault()
            sendMessage(input)
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              mode === 'local'
                ? 'Ask about your finances...'
                : 'Use quick actions for market research...'
            }
            className="input flex-1"
            disabled={loading}
          />
          <button
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-3 rounded-lg font-medium transition-all hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 flex items-center gap-2"
            style={{
              background: 'var(--accent)',
              color: '#fff'
            }}
          >
            <Send className="w-4 h-4" />
          </button>
        </form>

        <p className="text-xs text-center mt-3" style={{ color: 'var(--text-muted)' }}>
          {mode === 'local'
            ? 'Powered by OpenAI GPT-4o-mini • Analyzes your financial data'
            : 'Powered by Perplexity AI • Real-time web search with citations'}
        </p>
      </div>
    </div>
  )
}
