import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, rpc, supabase } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import { useList, useTenantKey } from '@/shared/data'
import type { Role } from '@/lib/claims'

export type TenantSettings = {
  features?: { stock_gate?: boolean; proof_gate?: boolean }
  timezone: string
  allow_self_approval: boolean
  overhead_pct: number
  doc_numbering: { year: 'ad' | 'be'; reset: 'yearly' | 'monthly'; digits: number }
}

export function useTenant() {
  const { claims } = useAuth()
  const key = useTenantKey('tenant')
  return useQuery({
    queryKey: key,
    enabled: !!claims?.tenant_id,
    queryFn: async () => {
      const { data, error } = await db().from('tenants').select('id, name, plan_id, settings, modules').eq('id', claims!.tenant_id!).single()
      if (error) throw error
      return data as { id: string; name: string; plan_id: string; settings: TenantSettings; modules: ModuleKey[] }
    },
  })
}

// Optional modules a super admin switches on per shop; the core flow is always on.
export type ModuleKey = 'outsource' | 'delivery' | 'inventory' | 'proof' | 'costing' | 'reports'
export const availableModules: ModuleKey[] = ['outsource', 'delivery', 'inventory', 'proof']

export function useModules() {
  const tenant = useTenant()
  const mods = tenant.data?.modules
  return { ready: !!mods, has: (m: ModuleKey) => !!mods?.includes(m) }
}

export function useUpdateSettings() {
  const qc = useQueryClient()
  const key = useTenantKey('tenant')
  return useMutation({
    mutationFn: async ({ name, patch }: { name?: string; patch: Partial<TenantSettings> }) => {
      const { error } = await rpc().rpc('update_tenant_settings', { p_name: name ?? null, p_patch: patch })
      if (error) throw error
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: ['my-tenants'] })]),
  })
}

// Members ---------------------------------------------------------------------------

export type Member = {
  membership_id: string
  user_id: string
  email: string
  full_name: string | null
  roles: Role[]
  is_active: boolean
  is_support: boolean
  machine_ids: string[]
  joined_at: string
}

export function useMembers() {
  const key = useTenantKey('members')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await rpc().rpc('list_members')
      if (error) throw error
      return data as Member[]
    },
  })
}

function useInvalidateMembers() {
  const qc = useQueryClient()
  const key = useTenantKey('members')
  return () => qc.invalidateQueries({ queryKey: key })
}

// Edge Function: creates the account (if new), emails the invitation, adds the membership.
export function useInviteMember() {
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async ({ email, roles }: { email: string; roles: Role[] }) => {
      const { data, error } = await supabase.functions.invoke('invite-member', {
        body: { email, roles, redirectTo: window.location.origin },
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

export function useSetMemberRoles() {
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async ({ id, roles, active }: { id: string; roles: Role[]; active: boolean }) => {
      const { error } = await rpc().rpc('set_member_roles', { p_membership: id, p_roles: roles, p_is_active: active })
      if (error) throw error
    },
    onSettled: invalidate,
  })
}

// Replace the machines a member operates.
export function useSetOperatorMachines() {
  const invalidate = useInvalidateMembers()
  return useMutation({
    mutationFn: async ({ membershipId, machineIds }: { membershipId: string; machineIds: string[] }) => {
      const { error: delError } = await db().from('machine_operators').delete().eq('membership_id', membershipId)
      if (delError) throw delError
      if (machineIds.length) {
        const { error } = await db()
          .from('machine_operators')
          .insert(machineIds.map((machine_id) => ({ machine_id, membership_id: membershipId })))
        if (error) throw error
      }
    },
    onSettled: invalidate,
  })
}

// Calendar --------------------------------------------------------------------------

export type Shift = { weekday: number; start_time: string; end_time: string }
export type Holiday = { id: string; day: string; name: string }

export function useDefaultCalendar() {
  const key = useTenantKey('calendar')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data: cal, error } = await db().from('calendars').select('id, name').eq('is_default', true).single()
      if (error) throw error
      const [shifts, holidays] = await Promise.all([
        db().from('calendar_shifts').select('weekday, start_time, end_time').eq('calendar_id', cal.id).order('weekday').order('start_time'),
        db().from('holidays').select('id, day, name').gte('day', new Date().toISOString().slice(0, 10)).order('day'),
      ])
      if (shifts.error) throw shifts.error
      if (holidays.error) throw holidays.error
      return { calendar: cal as { id: string; name: string }, shifts: shifts.data as Shift[], holidays: holidays.data as Holiday[] }
    },
  })
}

function useInvalidateCalendar() {
  const qc = useQueryClient()
  const key = useTenantKey('calendar')
  const boardKey = useTenantKey('board')
  return async () => {
    await qc.invalidateQueries({ queryKey: key })
    // Working time changed: recompute the schedule.
    await rpc().rpc('reschedule')
    await qc.invalidateQueries({ queryKey: boardKey })
  }
}

export function useSaveShifts() {
  const invalidate = useInvalidateCalendar()
  return useMutation({
    mutationFn: async ({ calendarId, shifts }: { calendarId: string; shifts: Shift[] }) => {
      const { error: delError } = await db().from('calendar_shifts').delete().eq('calendar_id', calendarId)
      if (delError) throw delError
      if (shifts.length) {
        const { error } = await db().from('calendar_shifts').insert(shifts.map((s) => ({ ...s, calendar_id: calendarId })))
        if (error) throw error
      }
    },
    onSettled: invalidate,
  })
}

export function useHolidayMutations() {
  const invalidate = useInvalidateCalendar()
  const add = useMutation({
    mutationFn: async (h: { day: string; name: string }) => {
      const { error } = await db().from('holidays').insert(h)
      if (error) throw error
    },
    onSettled: invalidate,
  })
  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db().from('holidays').delete().eq('id', id)
      if (error) throw error
    },
    onSettled: invalidate,
  })
  return { add, remove }
}

// Vendors & materials ---------------------------------------------------------------

export type Vendor = { id: string; code: string; name: string; rating: number | null; contacts: { name?: string; phone?: string }[] }
export const useVendors = () => useList<Vendor>('vendors', 'id, code, name, rating, contacts', { order: ['name'] })

export type VendorService = { vendor_id: string; process_id: string; lead_time_days: number }
export function useVendorServices() {
  const key = useTenantKey('vendor_services')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().from('vendor_services').select('vendor_id, process_id, lead_time_days')
      if (error) throw error
      return data as VendorService[]
    },
  })
}

export function useSaveVendorServices() {
  const qc = useQueryClient()
  const key = useTenantKey('vendor_services')
  return useMutation({
    mutationFn: async ({ vendorId, services }: { vendorId: string; services: Omit<VendorService, 'vendor_id'>[] }) => {
      const { error: delError } = await db().from('vendor_services').delete().eq('vendor_id', vendorId)
      if (delError) throw delError
      if (services.length) {
        const { error } = await db().from('vendor_services').insert(services.map((s) => ({ ...s, vendor_id: vendorId })))
        if (error) throw error
      }
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export type Material = {
  id: string
  code: string
  name: string
  category: 'paper' | 'ink' | 'plate' | 'consumable' | 'other'
  uom: string
  purchase_uom: string | null
  conversion_factor: number
  min_stock: number
}
export const useMaterials = () =>
  useList<Material>('materials', 'id, code, name, category, uom, purchase_uom, conversion_factor, min_stock', { order: ['category', 'code'] })
