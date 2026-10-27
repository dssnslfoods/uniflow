import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, rpc } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import type { MachineStatus } from '@/shared/ui/status-badge'

export type CapacityUnit = 'sheet' | 'impression' | 'piece' | 'meter' | 'kg'

export type Machine = {
  id: string
  code: string
  name: string
  machine_type: string | null
  capacity_unit: CapacityUnit
  max_cap_per_hour: number
  setup_min: number
  efficiency_pct: number
  makeready_waste_units: number
  crew_size: number
  status: MachineStatus
  sort_order: number
}

export type MachineInput = Omit<Machine, 'id' | 'status' | 'sort_order'> & {
  process_ids: string[]
  cost_per_hour: number | null   // null = leave unchanged (caller cannot see costs)
}

const columns =
  'id, code, name, machine_type, capacity_unit, max_cap_per_hour, setup_min, efficiency_pct, makeready_waste_units, crew_size, status, sort_order'

function useKey() {
  const { claims } = useAuth()
  return ['machines', claims?.tenant_id] as const
}

export function useMachines() {
  const key = useKey()
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db()
        .from('machines')
        .select(columns)
        .is('deleted_at', null)
        .order('sort_order')
        .order('code')
      if (error) throw error
      return data as Machine[]
    },
  })
}

// Machine ↔ process capability (BR: machine must support the step's process).
export function useMachineProcesses() {
  const { claims } = useAuth()
  return useQuery({
    queryKey: ['machine_processes', claims?.tenant_id],
    queryFn: async () => {
      const { data, error } = await db().from('machine_processes').select('machine_id, process_id')
      if (error) throw error
      return data as { machine_id: string; process_id: string }[]
    },
  })
}

// RLS returns rows only to admin/executive/manager.
export function useMachineCosts(enabled: boolean) {
  const { claims } = useAuth()
  return useQuery({
    queryKey: ['machine_costs', claims?.tenant_id],
    enabled,
    queryFn: async () => {
      const { data, error } = await db().from('machine_costs').select('machine_id, cost_per_hour')
      if (error) throw error
      return new Map((data as { machine_id: string; cost_per_hour: number }[]).map((r) => [r.machine_id, r.cost_per_hour]))
    },
  })
}

export function useSaveMachine() {
  const key = useKey()
  const qc = useQueryClient()
  const { claims } = useAuth()
  return useMutation({
    mutationFn: async ({ id, process_ids, cost_per_hour, ...input }: MachineInput & { id?: string }) => {
      const { data, error } = await (id
        ? db().from('machines').update(input).eq('id', id).select('id').single()
        : db().from('machines').insert(input).select('id').single())
      if (error) throw error
      const machineId = (data as { id: string }).id

      const { error: delError } = await db()
        .from('machine_processes')
        .delete()
        .eq('machine_id', machineId)
        .not('process_id', 'in', `(${process_ids.join(',') || '00000000-0000-0000-0000-000000000000'})`)
      if (delError) throw delError
      if (process_ids.length) {
        const { error: linkError } = await db()
          .from('machine_processes')
          .upsert(process_ids.map((process_id) => ({ machine_id: machineId, process_id })), { ignoreDuplicates: true })
        if (linkError) throw linkError
      }

      if (cost_per_hour !== null) {
        const { error: costError } = await db()
          .from('machine_costs')
          .upsert({ machine_id: machineId, cost_per_hour })
        if (costError) throw costError
      }
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: key })
      qc.invalidateQueries({ queryKey: ['machine_processes', claims?.tenant_id] })
      qc.invalidateQueries({ queryKey: ['machine_costs', claims?.tenant_id] })
    },
  })
}

// Optimistic: the badge changes immediately, rolls back if the server refuses.
export function useSetMachineStatus() {
  const key = useKey()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: MachineStatus }) => {
      const { error } = await rpc().rpc('set_machine_status', { p_machine: id, p_status: status })
      if (error) throw error
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey: key })
      const previous = qc.getQueryData<Machine[]>(key)
      qc.setQueryData<Machine[]>(key, (all) => all?.map((m) => (m.id === id ? { ...m, status } : m)))
      return { previous }
    },
    onError: (_err, _vars, ctx) => qc.setQueryData(key, ctx?.previous),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

// Soft delete only (BR-R08); restore powers the Undo toast.
export function useArchiveMachine() {
  const key = useKey()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, restore }: { id: string; restore?: boolean }) => {
      const { error } = await db()
        .from('machines')
        .update(restore ? { deleted_at: null, status: 'active' } : { deleted_at: new Date().toISOString(), status: 'inactive' })
        .eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}
