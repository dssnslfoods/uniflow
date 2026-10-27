import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import type { Role } from '@/lib/claims'

export type MyTenant = { tenant_id: string; name: string; roles: Role[]; is_current: boolean }

export function useMyTenants() {
  const { session } = useAuth()
  return useQuery({
    queryKey: ['my-tenants', session?.user.id],
    enabled: !!session,
    queryFn: async () => {
      const { data, error } = await rpc().rpc('my_tenants')
      if (error) throw error
      return data as MyTenant[]
    },
  })
}

export function useCreateTenant() {
  const { refresh } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (name: string) => {
      const { data, error } = await rpc().rpc('create_tenant', { p_name: name })
      if (error) throw error
      return data as string
    },
    onSuccess: async () => {
      await refresh()
      qc.clear()
    },
  })
}

export function useSwitchTenant() {
  const { refresh } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tenantId: string) => {
      const { error } = await rpc().rpc('switch_tenant', { p_tenant: tenantId })
      if (error) throw error
    },
    // Every cached query belongs to the old tenant.
    onSuccess: async () => {
      await refresh()
      qc.clear()
    },
  })
}
