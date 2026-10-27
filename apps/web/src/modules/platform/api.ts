import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import type { Role } from '@/lib/claims'

export type MyTenant = { tenant_id: string; name: string; roles: Role[]; is_current: boolean; is_support: boolean }

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
      const claims = await refresh()
      qc.clear()
      if (!claims?.tenant_id) throw hookMissing()
    },
  })
}

// The tenant exists but the new token has no tenant_id: the access token hook is not enabled.
export const hookMissing = () => Object.assign(new Error('auth.hook_missing'), { details: 'auth.hook_missing' })

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

// Platform super admin (SaaS operator) ---------------------------------------

export type AdminTenant = {
  tenant_id: string
  name: string
  plan_id: string
  status: 'trial' | 'active' | 'suspended' | 'closed'
  created_at: string
  members: number
  machines: number
  open_orders: number
  active_jobs: number
  owner_email: string | null
  supporting: boolean
}

export function useAdminTenants(enabled: boolean) {
  return useQuery({
    queryKey: ['admin-tenants'],
    enabled,
    queryFn: async () => {
      const { data, error } = await rpc().rpc('admin_list_tenants')
      if (error) throw error
      return data as AdminTenant[]
    },
  })
}

export function useAdminUpdateTenant() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (input: { id: string; plan?: string; status?: AdminTenant['status'] }) => {
      const { error } = await rpc().rpc('admin_update_tenant', {
        p_tenant: input.id,
        p_plan: input.plan ?? null,
        p_status: input.status ?? null,
      })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['admin-tenants'] }),
  })
}

// Entering/leaving changes the tenant in the JWT, so refresh the session and drop every cached query.
export function useSupportSession() {
  const { refresh } = useAuth()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ tenantId, leave }: { tenantId: string; leave?: boolean }) => {
      const { error } = await rpc().rpc(leave ? 'admin_leave_tenant' : 'admin_enter_tenant', { p_tenant: tenantId })
      if (error) throw error
    },
    onSuccess: async () => {
      await refresh()
      qc.clear()
    },
  })
}
