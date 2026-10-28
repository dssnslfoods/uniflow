import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { rpc, supabase } from '@/lib/supabase'
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
  modules: string[]
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

// Demo data for trials/testing (app.seed_demo). Platform admins may target any shop.
export function useSeedDemo() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (tenantId: string | null) => {
      const { data, error } = await rpc().rpc('seed_demo', { p_tenant: tenantId })
      if (error) throw error
      return data as { skipped: boolean; orders?: number; jobs?: number }
    },
    onSettled: () => qc.invalidateQueries(),
  })
}

export function useAdminSetModules() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, modules }: { id: string; modules: string[] }) => {
      const { error } = await rpc().rpc('admin_set_modules', { p_tenant: id, p_modules: modules })
      if (error) throw error
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-tenants'] }), qc.invalidateQueries({ queryKey: ['tenant'] })]),
  })
}

// Console: people of one shop ---------------------------------------------------------

export type AdminMember = {
  membership_id: string
  user_id: string
  email: string
  full_name: string | null
  roles: Role[]
  is_active: boolean
  joined_at: string
  last_sign_in_at: string | null
  invited_pending: boolean
}

export function useAdminMembers(tenantId: string | null) {
  return useQuery({
    queryKey: ['admin-members', tenantId],
    enabled: !!tenantId,
    queryFn: async () => {
      const { data, error } = await rpc().rpc('admin_list_members', { p_tenant: tenantId })
      if (error) throw error
      return data as AdminMember[]
    },
  })
}

function useInvalidateConsole() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: ['admin-members'] }), qc.invalidateQueries({ queryKey: ['admin-tenants'] })])
}

// Edge Function with tenantId: account (if new) + invitation email + membership in that shop.
export function useAdminInvite() {
  const invalidate = useInvalidateConsole()
  return useMutation({
    mutationFn: async ({ tenantId, email, roles }: { tenantId: string; email: string; roles: Role[] }) => {
      const { data, error } = await supabase.functions.invoke('invite-member', {
        body: { tenantId, email, roles, redirectTo: window.location.origin },
      })
      if (error) {
        const body = await (error as { context?: Response }).context?.json?.().catch(() => null)
        throw Object.assign(new Error(body?.message ?? error.message), { details: body?.code })
      }
      return data as { invited: boolean }
    },
    onSettled: invalidate,
  })
}

export function useAdminSetMember() {
  const invalidate = useInvalidateConsole()
  return useMutation({
    mutationFn: async ({ id, roles, active }: { id: string; roles: Role[]; active: boolean }) => {
      const { error } = await rpc().rpc('admin_set_member', { p_membership: id, p_roles: roles, p_is_active: active })
      if (error) throw error
    },
    onSettled: invalidate,
  })
}

export function useAdminCreateTenant() {
  const invalidate = useInvalidateConsole()
  return useMutation({
    mutationFn: async ({ name, plan, modules }: { name: string; plan: string; modules: string[] }) => {
      const { data, error } = await rpc().rpc('admin_create_tenant', { p_name: name, p_plan: plan, p_modules: modules })
      if (error) throw error
      return data as string
    },
    onSettled: invalidate,
  })
}
