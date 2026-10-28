import { useQuery } from '@tanstack/react-query'
import { db } from '@/lib/supabase'
import { useTenantKey } from '@/shared/data'
import { usePlanCommand } from '../production/api'

export type OutsourceStatus = 'sent' | 'received' | 'qc_passed' | 'rejected' | 'cancelled'

export type OutsourceOrder = {
  id: string
  doc_no: string
  job_step_id: string
  vendor_id: string
  qty_sent: number
  sent_at: string
  expected_at: string
  received_at: string | null
  qty_received: number | null
  qty_rejected: number
  cost: number | null
  status: OutsourceStatus
  note: string | null
  qc_note: string | null
  step: { id: string; seq: number; process_id: string; planned_qty: number; job: { id: string; job_no: string; title: string; due_date: string | null } }
}

export function useOutsourceOrders() {
  const key = useTenantKey('outsource')
  return useQuery({
    queryKey: key,
    refetchInterval: 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString()
      const { data, error } = await db()
        .from('outsource_orders')
        .select(
          'id, doc_no, job_step_id, vendor_id, qty_sent, sent_at, expected_at, received_at, qty_received, qty_rejected, cost, status, note, qc_note, ' +
            'step:job_steps(id, seq, process_id, planned_qty, job:jobs(id, job_no, title, due_date))',
        )
        .or(`status.in.(sent,received),sent_at.gte.${since}`)
        .order('expected_at')
      if (error) throw error
      return data as unknown as OutsourceOrder[]
    },
  })
}

export type VendorPerformance = {
  vendor_id: string
  name: string
  orders_done: number
  orders_open: number
  orders_late_now: number
  on_time_pct: number | null
  reject_pct: number | null
  cost_90d: number | null
}

export function useVendorPerformance() {
  const key = useTenantKey('vendor-performance')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().from('vendor_performance_v').select('*').order('name')
      if (error) throw error
      return data as VendorPerformance[]
    },
  })
}

export const useSendOutsource = () =>
  usePlanCommand<
    { p_step: string; p_vendor: string; p_qty: number; p_expected_at: string; p_cost: number | null; p_note: string | null },
    string
  >('send_outsource')
export const useReceiveOutsource = () => usePlanCommand<{ p_order: string; p_qty: number; p_cost: number | null }, null>('receive_outsource')
export const useQcOutsource = () =>
  usePlanCommand<{ p_order: string; p_passed: boolean; p_rejected: number; p_note: string | null }, { job_done: boolean }>('qc_outsource')
