import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import { decodeClaims, type Claims, type Role } from '@/lib/claims'

export type AuthState = {
  ready: boolean
  session: Session | null
  claims: Claims | null
  hasRole: (...roles: Role[]) => boolean
  // Re-issue the JWT so the hook picks up a new/switched tenant; returns the new claims.
  refresh: () => Promise<Claims | null>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [ready, setReady] = useState(false)
  const qc = useQueryClient()
  const userId = session?.user.id

  // Query keys are per tenant, not per person: never show the next person on a shared PC the last one's data.
  useEffect(() => {
    return () => qc.clear()
  }, [qc, userId])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setReady(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next))
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo<AuthState>(() => {
    const claims = decodeClaims(session?.access_token)
    return {
      ready,
      session,
      claims,
      hasRole: (...roles) => !!claims?.roles.some((r) => roles.includes(r)),
      refresh: async () => {
        const { data } = await supabase.auth.refreshSession()
        setSession(data.session)
        return decodeClaims(data.session?.access_token)
      },
      signOut: async () => {
        await supabase.auth.signOut()
      },
    }
  }, [session, ready])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
