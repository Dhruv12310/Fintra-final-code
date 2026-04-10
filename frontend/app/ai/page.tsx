"use client";

import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { Loader2, Sparkles, Target, BarChart3, Globe, Zap, RefreshCw, TrendingUp } from "lucide-react";

interface InsightCard {
  title: string;
  content: string;
  category: "benchmark" | "growth" | "competitive" | "financial";
  icon: React.ReactNode;
}

const CACHE_KEY_PREFIX = 'ai_insights_';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

interface CachedInsights {
  insights: InsightCard[];
  accountCount: number;
  journalCount: number;
  timestamp: number;
}

export default function AIConsolePage() {
  const { company, user } = useAuth();
  const companyId = company?.id || null;
  const canAccessAI = ["owner", "admin", "accountant"].includes((user?.role || "").toLowerCase());
  const [loading, setLoading] = useState(false);
  const [insights, setInsights] = useState<InsightCard[]>([]);
  const [accountCount, setAccountCount] = useState(0);
  const [journalCount, setJournalCount] = useState(0);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    if (companyId) {
      // Try to load from cache first
      const cached = loadFromCache(companyId);
      if (cached) {
        setInsights(cached.insights);
        setAccountCount(cached.accountCount);
        setJournalCount(cached.journalCount);
        setLastUpdated(new Date(cached.timestamp));
      } else {
        // No cache or expired, load fresh insights
        loadInsights();
      }
    }
  }, [companyId]);

  const loadFromCache = (companyId: string): CachedInsights | null => {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${companyId}`;
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;

      const parsed: CachedInsights = JSON.parse(cached);
      const now = Date.now();

      // Check if cache is expired (older than 24 hours)
      if (now - parsed.timestamp > CACHE_DURATION) {
        localStorage.removeItem(cacheKey);
        return null;
      }

      return parsed;
    } catch (error) {
      console.error("Failed to load from cache:", error);
      return null;
    }
  };

  const saveToCache = (companyId: string, data: CachedInsights) => {
    try {
      const cacheKey = `${CACHE_KEY_PREFIX}${companyId}`;
      localStorage.setItem(cacheKey, JSON.stringify(data));
    } catch (error) {
      console.error("Failed to save to cache:", error);
    }
  };

  const clearCache = () => {
    if (!companyId) return;
    const cacheKey = `${CACHE_KEY_PREFIX}${companyId}`;
    localStorage.removeItem(cacheKey);
  };

  const loadInsights = async (forceRefresh = false) => {
    if (!companyId) return;

    // If not forcing refresh, check cache first
    if (!forceRefresh) {
      const cached = loadFromCache(companyId);
      if (cached) {
        setInsights(cached.insights);
        setAccountCount(cached.accountCount);
        setJournalCount(cached.journalCount);
        setLastUpdated(new Date(cached.timestamp));
        return;
      }
    }

    setLoading(true);

    try {
      // Load multiple insights in parallel
      const [benchmarkResult, growthResult, competitiveResult] = await Promise.all([
        // Industry benchmarks
        api.post<{ answer: string; account_count: number; journal_count: number }>("/ai/query", {
          company_id: companyId,
          question: "What are the industry benchmarks for my business?"
        }).catch(() => null),

        // Growth recommendations
        api.post<{ answer: string; account_count: number; journal_count: number }>("/ai/query", {
          company_id: companyId,
          question: "How can I grow my business?"
        }).catch(() => null),

        // Online presence
        api.post<{ answer: string; account_count: number; journal_count: number }>("/ai/query", {
          company_id: companyId,
          question: "Can you find my online reviews and presence?"
        }).catch(() => null)
      ]);

      const newInsights: InsightCard[] = [];
      let newAccountCount = 0;
      let newJournalCount = 0;

      if (benchmarkResult) {
        newInsights.push({
          title: "Industry Benchmarks",
          content: benchmarkResult.answer,
          category: "benchmark",
          icon: <BarChart3 className="w-5 h-5" />
        });
        newAccountCount = benchmarkResult.account_count;
        newJournalCount = benchmarkResult.journal_count;
      }

      if (growthResult) {
        newInsights.push({
          title: "Growth Opportunities",
          content: growthResult.answer,
          category: "growth",
          icon: <TrendingUp className="w-5 h-5" />
        });
      }

      if (competitiveResult) {
        newInsights.push({
          title: "Online Presence & Reputation",
          content: competitiveResult.answer,
          category: "competitive",
          icon: <Globe className="w-5 h-5" />
        });
      }

      const now = Date.now();
      setInsights(newInsights);
      setAccountCount(newAccountCount);
      setJournalCount(newJournalCount);
      setLastUpdated(new Date(now));

      // Save to cache
      saveToCache(companyId, {
        insights: newInsights,
        accountCount: newAccountCount,
        journalCount: newJournalCount,
        timestamp: now
      });

    } catch (error: any) {
      console.error("Failed to load insights:", error);
    } finally {
      setLoading(false);
    }
  };

  if (!companyId) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-gray-900 dark:text-slate-100 p-8 flex items-center justify-center">
        <div className="text-center">
          <Target className="w-16 h-16 text-fuchsia-500 dark:text-fuchsia-300 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold mb-2">Complete Onboarding First</h2>
          <p className="text-gray-600 dark:text-white/60">Set up your company profile to unlock AI insights.</p>
        </div>
      </div>
    );
  }

  if (!canAccessAI) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-gray-900 dark:text-slate-100 p-8 flex items-center justify-center">
        <div className="text-center">
          <Target className="w-16 h-16 text-fuchsia-500 dark:text-fuchsia-300 mx-auto mb-4" />
          <h2 className="text-2xl font-semibold mb-2">AI Access Restricted</h2>
          <p className="text-gray-600 dark:text-white/60">
            Ask AI is available for owner, admin, and accountant roles only.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-gray-50 dark:from-slate-950 dark:via-slate-900 dark:to-slate-950 text-gray-900 dark:text-slate-100 p-8 space-y-6">

      {/* Header */}
      <div className="flex flex-col gap-4 rounded-3xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-xl p-6 shadow-lg">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.3em] text-gray-600 dark:text-white/60">
              <Sparkles className="w-4 h-4 text-fuchsia-500 dark:text-fuchsia-300" />
              Powered by Perplexity AI
            </div>
            <h1 className="text-3xl font-semibold mt-2 text-gray-900 dark:text-white">Business Intelligence</h1>
            <p className="text-sm text-gray-700 dark:text-white/70 mt-1">
              Web-powered insights about your industry, competitors, and growth opportunities.
            </p>
          </div>
          <div className="flex gap-4 text-sm">
            <div className="px-4 py-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
              <p className="text-gray-600 dark:text-white/60 text-xs uppercase tracking-wide">Accounts</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{accountCount || '—'}</p>
            </div>
            <div className="px-4 py-3 rounded-2xl border border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-white/5">
              <p className="text-gray-600 dark:text-white/60 text-xs uppercase tracking-wide">Journal Entries</p>
              <p className="text-2xl font-semibold text-gray-900 dark:text-white">{journalCount || '—'}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-white/60">
              <Loader2 className="w-4 h-4 animate-spin" />
              Loading fresh insights from AI...
            </div>
          ) : lastUpdated ? (
            <div className="flex items-center gap-3">
              <p className="text-xs text-gray-500 dark:text-white/50">
                Last updated: {lastUpdated.toLocaleDateString()} at {lastUpdated.toLocaleTimeString()}
              </p>
              <span className="text-xs px-2 py-1 rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300">
                Cached (24h)
              </span>
            </div>
          ) : (
            <div />
          )}

          <button
            onClick={() => {
              clearCache();
              loadInsights(true);
            }}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-gray-300 dark:border-white/10 bg-gray-50 dark:bg-white/5 hover:bg-gray-100 dark:hover:bg-white/10 transition-colors text-sm text-gray-700 dark:text-white disabled:opacity-40 disabled:cursor-not-allowed"
            title="Clear cache and fetch fresh insights from AI"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            Refresh Insights
          </button>
        </div>
      </div>

      {/* AI Insights Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {loading && insights.length === 0 ? (
          // Loading skeletons
          Array.from({ length: 3 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-3xl border border-gray-200 dark:border-white/10 bg-white dark:bg-white/5 backdrop-blur-xl p-6 shadow-lg animate-pulse"
            >
              <div className="h-6 bg-gray-200 dark:bg-white/10 rounded w-1/3 mb-4"></div>
              <div className="space-y-2">
                <div className="h-4 bg-gray-200 dark:bg-white/10 rounded"></div>
                <div className="h-4 bg-gray-200 dark:bg-white/10 rounded w-5/6"></div>
                <div className="h-4 bg-gray-200 dark:bg-white/10 rounded w-4/6"></div>
              </div>
            </div>
          ))
        ) : (
          insights.map((insight, idx) => (
            <div
              key={idx}
              className="rounded-3xl border border-gray-200 dark:border-white/10 bg-white dark:bg-slate-900/70 backdrop-blur-xl overflow-hidden shadow-lg"
            >
              <div className="border-b border-gray-200 dark:border-white/10 p-5 bg-gradient-to-r from-fuchsia-500/10 to-indigo-500/10 dark:from-fuchsia-500/20 dark:to-indigo-500/20">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-xl bg-white dark:bg-white/10 text-fuchsia-500 dark:text-fuchsia-300">
                    {insight.icon}
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{insight.title}</h3>
                </div>
              </div>
              <div className="p-5">
                <p className="text-sm leading-relaxed text-gray-800 dark:text-slate-200 whitespace-pre-wrap">
                  {insight.content}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Bottom Info Card */}
      <div className="rounded-3xl border border-gray-200 dark:border-white/10 bg-gradient-to-br from-gray-50 to-white dark:from-slate-900 dark:to-slate-900/80 p-6 space-y-3 shadow-lg">
        <div className="flex items-center gap-3">
          <Zap className="w-5 h-5 text-fuchsia-500 dark:text-fuchsia-300" />
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Need More Insights?</h3>
        </div>
        <p className="text-sm text-gray-700 dark:text-white/70">
          Use the <strong>Fintra Copilot</strong> button (bottom right) to ask specific questions about your finances,
          competitors, growth strategies, or anything else. The copilot blends your financial data with live web intelligence
          to give you actionable answers.
        </p>
        <div className="flex flex-wrap gap-2 pt-2">
          <span className="px-3 py-1 text-xs rounded-full bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white/80">
            "How can I reduce expenses?"
          </span>
          <span className="px-3 py-1 text-xs rounded-full bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white/80">
            "Find my competitors' reviews"
          </span>
          <span className="px-3 py-1 text-xs rounded-full bg-gray-200 dark:bg-white/10 text-gray-700 dark:text-white/80">
            "What's my cash flow trend?"
          </span>
        </div>
      </div>
    </div>
  );
}
