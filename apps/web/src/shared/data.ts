import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/supabase'
import { useAuth } from '@/app/auth'

// Query keys are scoped by tenant so switching shops never shows stale rows.
export function useTenantKey(name: string, ...rest: unknown[]) {
  const { claims } = useAuth()
  return [name, claims?.tenant_id, ...rest] as const
}

type ListOptions = { order?: string[]; activeOnly?: boolean; enabled?: boolean }

// Master-data list from schema app; soft-deleted rows hidden by default.
export function useList<T>(table: string, select: string, { order = ['code'], activeOnly = true, enabled = true }: ListOptions = {}) {
  const key = useTenantKey(table)
  return useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      let q = db().from(table).select(select)
      if (activeOnly) q = q.is('deleted_at', null)
      for (const col of order) q = q.order(col)
      const { data, error } = await q
      if (error) throw error
      return data as unknown as T[]
    },
  })
}

export function useSaveRow<T extends { id?: string }>(table: string) {
  const key = useTenantKey(table)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, ...rest }: T) => {
      const values = rest as Record<string, unknown>
      const query = id
        ? db().from(table).update(values).eq('id', id).select('id').single()
        : db().from(table).insert(values).select('id').single()
      const { data, error } = await query
      if (error) throw error
      return (data as { id: string }).id
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

// Soft delete with restore for the Undo toast (BR-R08).
export function useArchiveRow(table: string) {
  const key = useTenantKey(table)
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, restore }: { id: string; restore?: boolean }) => {
      const { error } = await db()
        .from(table)
        .update({ deleted_at: restore ? null : new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}
