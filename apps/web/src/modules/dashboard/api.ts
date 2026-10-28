import { useQuery } from '@tanstack/react-query'
import { rpc } from '@/lib/supabase'
import { useTenantKey } from '@/shared/data'
import type { DowntimeReason } from '../production/api'

export type DashboardSummary = {
  counts: {
    open_orders: number
    draft_orders: number
    planning: number
    pending_approval: number
    approved: number
    in_production: number
    at_risk: number
    ready_to_deliver: number
  }
  today: { good: number; waste: number; steps_done: number }
  waste_7d: { process: string; good: number; waste: number; waste_pct: number | null }[]
  downtime_7d: { reason: DowntimeReason; minutes: number }[]
  machines_down: { machine: string; reason: DowntimeReason; since: string }[]
  at_risk_jobs: { id: string; job_no: string; title: string; due_date: string | null; planned_finish_at: string | null; customer: string }[]
  otd_30d: { finished: number; on_time: number }
}

export function useDashboard() {
  const key = useTenantKey('dashboard')
  return useQuery({
    queryKey: key,
    refetchInterval: 60_000,
    queryFn: async () => {
      const { data, error } = await rpc().rpc('dashboard_summary')
      if (error) throw error
      return data as DashboardSummary
    },
  })
}
