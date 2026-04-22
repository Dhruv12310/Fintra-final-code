'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { User as SupabaseUser } from '@supabase/supabase-js'
import { supabase, User, Company } from '@/lib/supabase'
import { useRouter } from 'next/navigation'
import { api } from '@/lib/api'

interface LoginLockoutState {
  locked: boolean
  remainingSeconds: number
}

interface AuthContextType {
  user: User | null
  supabaseUser: SupabaseUser | null
  company: Company | null
  loading: boolean
  signUp: (email: string, password: string, fullName: string) => Promise<void>
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => Promise<void>
  refreshUser: () => Promise<void>
  checkLoginLockout: (email: string) => Promise<LoginLockoutState>
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [supabaseUser, setSupabaseUser] = useState<SupabaseUser | null>(null)
  const [company, setCompany] = useState<Company | null>(null)
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  // Prevent concurrent fetchUserData calls (getSession + INITIAL_SESSION fire simultaneously)
  const fetchInFlightRef = useRef(false)

  const normalizeEmail = (email: string) => email.trim().toLowerCase()

  const toLockoutError = (remainingSeconds: number) => {
    const error = new Error(`Too many failed attempts. Try again in ${Math.max(1, remainingSeconds)} seconds.`) as Error & {
      code: string
      remainingSeconds: number
    }
    error.code = 'AUTH_LOCKED'
    error.remainingSeconds = Math.max(0, remainingSeconds)
    return error
  }

  const isInvalidCredentialsError = (error: any) => {
    const message = (error?.message || '').toLowerCase()
    const code = (error?.code || '').toLowerCase()
    return code === 'invalid_credentials' || message.includes('invalid login credentials')
  }

  const checkLoginLockout = useCallback(async (email: string): Promise<LoginLockoutState> => {
    const normalizedEmail = normalizeEmail(email)
    // Only fire when the address looks complete — avoids 422s on partial input
    if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      return { locked: false, remainingSeconds: 0 }
    }

    try {
      const response = await api.post<{ locked?: boolean; remaining_seconds?: number }>(
        '/users/auth/attempts/precheck',
        { email: normalizedEmail }
      )
      return {
        locked: Boolean(response?.locked),
        remainingSeconds: Number(response?.remaining_seconds || 0),
      }
    } catch {
      // Fail-open to avoid blocking valid users on transient API errors.
      return { locked: false, remainingSeconds: 0 }
    }
  }, [])

  const fetchUserData = async (authUser: SupabaseUser) => {
    if (!supabase) return
    // Guard: if a fetch is already in flight, skip — avoids double-fetch from
    // getSession() and onAuthStateChange(INITIAL_SESSION) firing simultaneously.
    if (fetchInFlightRef.current) return
    fetchInFlightRef.current = true
    try {
      // Try Supabase direct read first; fall back to backend API if RLS blocks it
      let userData: any = null

      const { data: directData, error: userError } = await supabase
        .from('users')
        .select('*')
        .eq('id', authUser.id)
        .maybeSingle()

      if (!userError && directData) {
        userData = directData
      } else {
        // RLS may block direct read — use backend API with JWT
        try {
          const { data: { session: currentSession } } = await supabase!.auth.getSession()
          const authHeader: Record<string, string> = currentSession?.access_token
            ? { 'Authorization': `Bearer ${currentSession.access_token}` }
            : {}
          const res = await fetch(
            `${process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'}/users/${authUser.id}`,
            { headers: authHeader }
          )
          if (res.ok) {
            const json = await res.json()
            if (json?.data) userData = json.data
          }
        } catch {
          // Backend not reachable
        }
      }

      if (!userData) {
        setUser(null)
        setCompany(null)
        // User has a valid Supabase session but no row in public.users yet —
        // send them to onboarding so the backend can create the row.
        if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/onboarding') && !window.location.pathname.startsWith('/login') && !window.location.pathname.startsWith('/signup') && !window.location.pathname.startsWith('/auth')) {
          router.push('/onboarding')
        }
        return
      }

      setUser(userData)

      // Fetch company: try Supabase first; fall back to backend API
      if (userData.company_id) {
        let companyData: any = null

        const { data: directCompany, error: companyError } = await supabase
          .from('companies')
          .select('*')
          .eq('id', userData.company_id)
          .maybeSingle()

        if (!companyError && directCompany) {
          companyData = directCompany
        } else {
          try {
            const res = await api.get<{ data?: any[] }>('/companies/')
            if (res?.data && res.data.length > 0) {
              companyData = res.data[0]
            }
          } catch {
            // Backend not reachable
          }
        }

        setCompany(companyData)
      } else {
        setCompany(null)
      }
    } catch (error) {
      console.error('Error fetching user data:', error)
    } finally {
      fetchInFlightRef.current = false
    }
  }

  useEffect(() => {
    if (!supabase) {
      console.error('Supabase client is not configured. Set NEXT_PUBLIC_SUPABASE_URL / KEY.')
      setLoading(false)
      return
    }

    // Async init: await fetchUserData so loading stays true until data arrives,
    // preventing the brief user===null flash that triggers the onboarding redirect.
    const init = async () => {
      const { data: { session } } = await supabase!.auth.getSession()
      setSupabaseUser(session?.user ?? null)
      if (session?.user) {
        await fetchUserData(session.user)
      }
      setLoading(false)
    }
    init()

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      setSupabaseUser(session?.user ?? null)
      if (session?.user) {
        // fetchUserData's in-flight guard deduplicates the INITIAL_SESSION
        // event that fires concurrently with init() above.
        fetchUserData(session.user)
      } else {
        setUser(null)
        setCompany(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  const signUp = async (email: string, password: string, fullName: string) => {
    if (!supabase) {
      throw new Error(
        'Authentication requires Supabase. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, set NEXT_PUBLIC_DEMO_MODE=false, and restart the dev server. Get keys from Supabase Dashboard → Project Settings → API.'
      )
    }
    try {
      const redirectUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/auth/callback`
        : 'http://localhost:3000/auth/callback'

      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: redirectUrl,
          data: {
            full_name: fullName,
          },
        },
      })

      if (error) throw error

      if (data.user) {
        // Create user record via backend API
        const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
        const signupHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        if (data.session?.access_token) {
          signupHeaders['Authorization'] = `Bearer ${data.session.access_token}`
        }
        const response = await fetch(`${apiBase}/users/`, {
          method: 'POST',
          headers: signupHeaders,
          body: JSON.stringify({
            id: data.user.id,
            email: data.user.email,
            full_name: fullName,
            role: 'admin',
          }),
        })

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}))
          // Don't throw on 409 conflict — user row may already exist
          if (response.status !== 409) {
            throw new Error(errorData.detail || 'Failed to create user record')
          }
        }

        // Don't redirect yet - user needs to confirm email first
        // The signup page will show a message to check email
      }
    } catch (error: any) {
      throw new Error(error.message || 'Failed to sign up')
    }
  }

  const signIn = async (email: string, password: string) => {
    if (!supabase) {
      throw new Error(
        'Authentication requires Supabase. Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to .env.local, set NEXT_PUBLIC_DEMO_MODE=false, and restart the dev server. Get keys from Supabase Dashboard → Project Settings → API.'
      )
    }
    try {
      const normalizedEmail = normalizeEmail(email)

      const precheck = await checkLoginLockout(normalizedEmail)
      if (precheck.locked) {
        throw toLockoutError(precheck.remainingSeconds)
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) {
        if (isInvalidCredentialsError(error)) {
          try {
            const record = await api.post<{ locked?: boolean; remaining_seconds?: number }>(
              '/users/auth/attempts/record',
              { email: normalizedEmail, outcome: 'invalid_credentials' }
            )
            if (record?.locked) {
              throw toLockoutError(Number(record?.remaining_seconds || 0))
            }
          } catch (recordError: any) {
            if (recordError?.code === 'AUTH_LOCKED') {
              throw recordError
            }
          }
        }
        throw error
      }

      if (data.user) {
        try {
          await api.post('/users/auth/attempts/record', {
            email: normalizedEmail,
            outcome: 'success',
          })
        } catch {
          // Do not block login if lockout reset endpoint is unavailable.
        }

        // Ensure user row exists in the users table (may be missing after schema reset)
        const { data: existingUser } = await supabase
          .from('users')
          .select('id')
          .eq('id', data.user.id)
          .maybeSingle()

        if (!existingUser) {
          const apiBase = process.env.NEXT_PUBLIC_API_BASE || 'http://localhost:8000'
          await fetch(`${apiBase}/users/`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${data.session!.access_token}`,
            },
            body: JSON.stringify({
              id: data.user.id,
              email: data.user.email,
              full_name: data.user.user_metadata?.full_name || data.user.email || 'User',
              role: 'admin',
            }),
          })
        }

        await fetchUserData(data.user)

        // Check if user has completed onboarding (maybeSingle: user/company row may not exist yet)
        const { data: userData } = await supabase
          .from('users')
          .select('company_id, companies(onboarding_completed)')
          .eq('id', data.user.id)
          .maybeSingle()

        if (!userData?.company_id) {
          router.push('/onboarding')
        } else if (!(userData.companies as any)?.onboarding_completed) {
          router.push('/onboarding')
        } else {
          router.push('/new-dashboard')
        }
      }
    } catch (error: any) {
      throw new Error(error.message || 'Failed to sign in')
    }
  }

  const signOut = async () => {
    if (!supabase) {
      setUser(null)
      setCompany(null)
      return
    }
    try {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      setUser(null)
      setCompany(null)
      router.push('/login')
    } catch (error: any) {
      throw new Error(error.message || 'Failed to sign out')
    }
  }

  const refreshUser = async () => {
    if (supabaseUser) {
      await fetchUserData(supabaseUser)
    }
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        supabaseUser,
        company,
        loading,
        signUp,
        signIn,
        signOut,
        refreshUser,
      checkLoginLockout,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
