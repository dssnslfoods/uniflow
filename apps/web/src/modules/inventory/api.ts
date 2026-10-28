import { useQuery } from '@tanstack/react-query'
import { db } from '@/lib/supabase'
import { useTenantKey } from '@/shared/data'
import { usePlanCommand } from '../production/api'
import { appLocale } from '@/shared/locale'

export const fmtQty = (n: number) => Number(n).toLocaleString(appLocale(), { maximumFractionDigits: 3 })

export type StockRow = {
  material_id: string
  code: string
  name: string
  category: 'paper' | 'ink' | 'plate' | 'consumable' | 'other'
  uom: string
  purchase_uom: string | null
  conversion_factor: number
  min_stock: number
  on_hand: number
  reserved: number
  available: number
  shortage: number
  avg_cost: number | null   // null for roles that may not see costs
  below_min: boolean
}

export function useStock() {
  const key = useTenantKey('stock')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().from('stock_v').select('*').order('category').order('code')
      if (error) throw error
      return data as StockRow[]
    },
  })
}

export type Movement = {
  id: number
  type: 'receive' | 'issue' | 'return' | 'adjust'
  qty: number
  balance_after: number
  unit_cost: number | null
  job_no: string | null
  ref: string | null
  note: string | null
  created_at: string
}

export function useMovements(materialId: string | null) {
  const key = useTenantKey('stock', 'card', materialId)
  return useQuery({
    queryKey: key,
    enabled: !!materialId,
    queryFn: async () => {
      const { data, error } = await db()
        .from('stock_movements_v')
        .select('id, type, qty, balance_after, unit_cost, job_no, ref, note, created_at')
        .eq('material_id', materialId!)
        .order('created_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return data as Movement[]
    },
  })
}

export type JobMaterial = { material_id: string; required_qty: number; reserved_qty: number; issued_qty: number; note: string | null }

export function useJobMaterials(jobId: string) {
  const key = useTenantKey('stock', 'job', jobId)
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db()
        .from('job_materials')
        .select('material_id, required_qty, reserved_qty, issued_qty, note')
        .eq('job_id', jobId)
      if (error) throw error
      return data as JobMaterial[]
    },
  })
}

export const useReceiveStock = () =>
  usePlanCommand<{ p_material: string; p_qty: number; p_unit_cost: number; p_ref: string | null; p_note: string | null }, number>('receive_stock')
export const useAdjustStock = () => usePlanCommand<{ p_material: string; p_new_on_hand: number; p_reason: string }, number>('adjust_stock')
export const useIssueMaterial = () =>
  usePlanCommand<{ p_job: string; p_material: string; p_qty: number; p_note: string | null }, number>('issue_material')
export const useSetJobMaterials = () =>
  usePlanCommand<{ p_job: string; p_items: { material_id: string; required_qty: number }[] }, boolean>('set_job_materials')
