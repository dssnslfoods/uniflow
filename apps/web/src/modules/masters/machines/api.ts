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
  crew_size: number
  status: MachineStatus
  sort_order: number
}

export type MachineInput = Omit<Machine, 'id' | 'status' | 'sort_order'>

const columns =
  'id, code, name, machine_type, capacity_unit, max_cap_per_hour, setup_min, efficiency_pct, crew_size, status, sort_order'

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

export function useSaveMachine() {
  const key = useKey()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...input }: MachineInput & { id?: string }) => {
      const query = id
        ? db().from('machines').update(input).eq('id', id)
        : db().from('machines').insert(input)
      const { error } = await query
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
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
