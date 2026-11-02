import { useQuery } from '@tanstack/react-query'
import { db, rpc } from '@/lib/supabase'
import { useTenantKey } from '@/shared/data'
import { usePlanCommand, type JobStatus } from '../production/api'

export type DeliverableJob = {
  id: string
  job_no: string
  title: string
  qty: number
  status: JobStatus
  order: { id: string; doc_no: string; customer_po_no: string; customer: { name: string } | null; delivery_info: { address?: string } }
  delivered: { qty: number }[]
  good_qty: number
}

export function useDeliverableJobs() {
  const key = useTenantKey('jobs', 'deliverable')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db()
        .from('jobs')
        .select('id, job_no, title, qty, status, order:sales_orders(id, doc_no, customer_po_no, customer:customers(name), delivery_info), delivered:delivery_items(qty)')
        .in('status', ['ready_to_deliver', 'partially_delivered'])
        .order('job_no')
      if (error) throw error
      const jobs = data as unknown as Omit<DeliverableJob, 'good_qty'>[]
      const { data: good, error: goodError } = await rpc().rpc('job_good_qtys', { p_jobs: jobs.map((j) => j.id) })
      if (goodError) throw goodError
      const goodOf = new Map((good as { job_id: string; good_qty: number }[]).map((g) => [g.job_id, Number(g.good_qty)]))
      return jobs.map((j) => ({ ...j, good_qty: goodOf.get(j.id) ?? 0 }))
    },
  })
}

export type Delivery = {
  id: string
  doc_no: string
  delivered_at: string
  receiver_name: string | null
  address: string | null
  note: string | null
  order: { id: string; doc_no: string; customer_po_no: string; customer: { name: string; tax_id: string | null } | null }
  items: { qty: number; job: { job_no: string; title: string; uom: string } }[]
}

const deliverySelect =
  'id, doc_no, delivered_at, receiver_name, address, note, ' +
  'order:sales_orders(id, doc_no, customer_po_no, customer:customers(name, tax_id)), ' +
  'items:delivery_items(qty, job:jobs(job_no, title, uom))'

export function useDeliveries() {
  const key = useTenantKey('deliveries')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().from('deliveries').select(deliverySelect).order('delivered_at', { ascending: false }).limit(50)
      if (error) throw error
      return data as unknown as Delivery[]
    },
  })
}

export function useDelivery(id: string) {
  const key = useTenantKey('deliveries', id)
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().from('deliveries').select(deliverySelect).eq('id', id).single()
      if (error) throw error
      return data as unknown as Delivery
    },
  })
}

export const useCloseJobShort = () => usePlanCommand<{ p_job: string; p_reason: string }, null>('close_job_short')

export const useCreateDelivery = () =>
  usePlanCommand<
    { p_sales_order: string; p_items: { job_id: string; qty: number }[]; p_receiver: string | null; p_note: string | null; p_delivered_at: string | null },
    string
  >('create_delivery')
