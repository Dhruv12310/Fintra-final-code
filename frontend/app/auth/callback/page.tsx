'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'

function AuthCallbackInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading')

  useEffect(() => {
    const handleCallback = async () => {
      try {
        // Get the code from URL params
        const code = searchParams.get('code')
        const error = searchParams.get('error')
        const errorDescription = searchParams.get('error_description')

        if (error) {
          console.error('Auth error:', error, errorDescription)
          setStatus('error')
          setTimeout(() => router.push('/login'), 2000)
          return
        }

        if (code && supabase) {
          // Exchange code for session
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code)

          if (exchangeError) {
            console.error('Session exchange error:', exchangeError)
            setStatus('error')
            setTimeout(() => router.push('/login'), 2000)
            return
          }

          setStatus('success')
          // Redirect to login page with success message
          setTimeout(() => router.push('/login?confirmed=true'), 1500)
        } else {
          // No code, just redirect to login
          router.push('/login')
        }
      } catch (error) {
        console.error('Callback error:', error)
        setStatus('error')
        setTimeout(() => router.push('/login'), 2000)
      }
    }

    handleCallback()
  }, [router, searchParams])

  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <div className="text-center">
        {status === 'loading' && (
          <>
            <div className="w-2 h-2 bg-emerald-400 rounded-full animate-pulse mb-4 mx-auto"></div>
            <p style={{ color: 'var(--text-muted)' }}>Confirming your email...</p>
          </>
        )}
        {status === 'success' && (
          <>
            <div className="w-12 h-12 rounded-full bg-emerald-400/10 flex items-center justify-center mb-4 mx-auto">
              <svg className="w-6 h-6" style={{ color: 'var(--success)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Email confirmed!</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Redirecting to login...</p>
          </>
        )}
        {status === 'error' && (
          <>
            <div className="w-12 h-12 rounded-full bg-red-400/10 flex items-center justify-center mb-4 mx-auto">
              <svg className="w-6 h-6" style={{ color: 'var(--neon-red)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </div>
            <p className="font-medium mb-2" style={{ color: 'var(--text-primary)' }}>Confirmation failed</p>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>Redirecting to login...</p>
          </>
        )}
      </div>
    </div>
  )
}

export default function AuthCallback() {
  return (
    <Suspense fallback={<div className="min-h-screen" style={{ backgroundColor: 'var(--bg-primary)' }} />}>
      <AuthCallbackInner />
    </Suspense>
  )
}
