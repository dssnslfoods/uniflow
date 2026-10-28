import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { useAuth } from './auth'

// Everything a board change can affect; refetched together.
const keys = ['board', 'machine-load', 'downtimes', 'job', 'jobs', 'dashboard', 'notifications', 'outsource', 'vendor-performance', 'stock', 'proofs']

// Private per-tenant topic fed by app.broadcast_board() (design §6.8). One "changed" event per
// transaction; bursts are coalesced before refetching. Polling stays as the fallback.
export function useTenantRealtime() {
  const { claims, session } = useAuth()
  const qc = useQueryClient()
  const tenantId = claims?.tenant_id
  const token = session?.access_token

  useEffect(() => {
    if (!tenantId || !token) return
    let timer: ReturnType<typeof setTimeout> | undefined
    let cancelled = false
    let channel: ReturnType<typeof supabase.channel> | undefined

    supabase.realtime.setAuth(token).then(() => {
      if (cancelled) return
      channel = supabase
        .channel(`tenant:${tenantId}:board`, { config: { private: true } })
        .on('broadcast', { event: 'changed' }, () => {
          clearTimeout(timer)
          timer = setTimeout(() => {
            keys.forEach((k) => qc.invalidateQueries({ queryKey: [k, tenantId] }))
          }, 300)
        })
        .subscribe()
    })

    return () => {
      cancelled = true
      clearTimeout(timer)
      if (channel) supabase.removeChannel(channel)
    }
  }, [tenantId, token, qc])
}
