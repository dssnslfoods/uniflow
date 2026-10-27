import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, rpc } from '@/lib/supabase'
import { useTenantKey } from '@/shared/data'
import type { StepType } from '../masters/processes/api'

export type JobStatus =
  | 'planning' | 'pending_approval' | 'approved' | 'in_production' | 'on_hold'
  | 'ready_to_deliver' | 'partially_delivered' | 'completed' | 'cancelled'

export type JobStep = {
  id?: string
  seq: number
  process_id: string
  step_type: StepType
  machine_id: string | null
  planned_qty: number
  n_up: number
  passes: number
  est_minutes: number | null
  note: string | null
}

export type JobLine = { sales_order_item_id: string; qty: number }

export type Job = {
  id: string
  job_no: string
  sales_order_id: string
  title: string
  qty: number
  status: JobStatus
  due_date: string | null
  workflow_version: number
  created_at: string
  lines: JobLine[]
  steps: JobStep[]
}

export type Coverage = {
  sales_order_item_id: string
  line_no: number
  description: string
  qty: number
  matched_qty: number
  remaining_qty: number
}

export type Approval = {
  entity_id: string
  version: number
  action: 'submit' | 'approve' | 'reject' | 'request_change' | 'cancel'
  comment: string | null
  actor_id: string
  created_at: string
}

const jobSelect =
  'id, job_no, sales_order_id, title, qty, status, due_date, workflow_version, created_at, ' +
  'lines:job_order_items(sales_order_item_id, qty), ' +
  'steps:job_steps(id, seq, process_id, step_type, machine_id, planned_qty, n_up, passes, est_minutes, note)'

export function useOrderJobs(orderId: string) {
  const key = useTenantKey('jobs', orderId)
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db()
        .from('jobs')
        .select(jobSelect)
        .eq('sales_order_id', orderId)
        .order('created_at')
        .order('seq', { referencedTable: 'job_steps' })
      if (error) throw error
      return data as unknown as Job[]
    },
  })
}

export function useCoverage(orderId: string) {
  const key = useTenantKey('coverage', orderId)
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db()
        .from('sales_order_coverage_v')
        .select('sales_order_item_id, line_no, description, qty, matched_qty, remaining_qty')
        .eq('sales_order_id', orderId)
        .order('line_no')
      if (error) throw error
      return data as Coverage[]
    },
  })
}

export function useApprovals(jobIds: string[]) {
  const key = useTenantKey('approvals', jobIds.join(','))
  return useQuery({
    queryKey: key,
    enabled: jobIds.length > 0,
    queryFn: async () => {
      const { data, error } = await db()
        .from('approvals')
        .select('entity_id, version, action, comment, actor_id, created_at')
        .in('entity_id', jobIds)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as Approval[]
    },
  })
}

// Everything on the planning screen depends on these; refresh them together.
function useInvalidatePlan() {
  const qc = useQueryClient()
  const jobsKey = useTenantKey('jobs')
  const coverageKey = useTenantKey('coverage')
  const approvalsKey = useTenantKey('approvals')
  const ordersKey = useTenantKey('sales_orders')
  const boardKey = useTenantKey('board')
  const loadKey = useTenantKey('machine-load')
  return () =>
    Promise.all(
      [jobsKey, coverageKey, approvalsKey, ordersKey, boardKey, loadKey].map((queryKey) => qc.invalidateQueries({ queryKey })),
    )
}

export function useCreateJob() {
  const invalidate = useInvalidatePlan()
  return useMutation({
    mutationFn: async (input: { orderId: string; title: string; templateId: string | null; lines: JobLine[] }) => {
      const { data, error } = await rpc().rpc('create_job', {
        p_sales_order: input.orderId,
        p_title: input.title,
        p_template: input.templateId,
        p_items: input.lines.filter((l) => l.qty > 0),
      })
      if (error) throw error
      return data as string
    },
    onSettled: invalidate,
  })
}

// Planning edits write tables directly; the DB guard rejects them once a job is submitted.
export function useSaveJob() {
  const invalidate = useInvalidatePlan()
  return useMutation({
    mutationFn: async ({ job, title, lines, steps }: { job: Job; title: string; lines: JobLine[]; steps: JobStep[] }) => {
      const qty = lines.reduce((s, l) => s + l.qty, 0) || job.qty
      const { error } = await db().from('jobs').update({ title, qty }).eq('id', job.id)
      if (error) throw error

      const { error: delLines } = await db().from('job_order_items').delete().eq('job_id', job.id)
      if (delLines) throw delLines
      const keep = lines.filter((l) => l.qty > 0)
      if (keep.length) {
        const { error: insLines } = await db().from('job_order_items').insert(keep.map((l) => ({ ...l, job_id: job.id })))
        if (insLines) throw insLines
      }

      const { error: delSteps } = await db().from('job_steps').delete().eq('job_id', job.id)
      if (delSteps) throw delSteps
      if (steps.length) {
        const { error: insSteps } = await db()
          .from('job_steps')
          .insert(
            steps.map(({ seq, process_id, step_type, machine_id, planned_qty, n_up, passes, note }) => ({
              job_id: job.id, seq, process_id, step_type, machine_id, planned_qty, n_up, passes, note,
            })),
          )
        if (insSteps) throw insSteps
      }
    },
    onSettled: invalidate,
  })
}

export function usePlanCommand<A extends Record<string, unknown>>(fn: string) {
  const invalidate = useInvalidatePlan()
  return useMutation({
    mutationFn: async (args: A) => {
      const { data, error } = await rpc().rpc(fn, args)
      if (error) throw error
      return data as number | null
    },
    onSettled: invalidate,
  })
}

export const useSubmitPlan = () => usePlanCommand<{ p_sales_order: string }>('submit_po_plan')
export const useApprovePlan = () => usePlanCommand<{ p_sales_order: string; p_jobs?: string[] | null }>('approve_po_plan')
export const useRejectJobs = () =>
  usePlanCommand<{ p_jobs: string[]; p_reason: string; p_request_change?: boolean }>('reject_jobs')
export const useCancelJob = () => usePlanCommand<{ p_job: string; p_reason: string }>('cancel_job')

export function formatMinutes(t: (k: string, o?: Record<string, unknown>) => string, minutes: number | null) {
  if (minutes == null) return '—'
  const m = Math.round(minutes)
  return m < 60 ? t('plan.minutes', { n: m }) : t('plan.hours', { h: Math.floor(m / 60), m: m % 60 })
}

export type PendingJob = Job & {
  order: {
    id: string
    doc_no: string
    customer_po_no: string
    due_date: string | null
    customer: { name: string } | null
    items: { id: string; line_no: number; description: string; qty: number }[]
  }
}

// Manager inbox: every job waiting for approval, with its PO for context.
export function usePendingApprovals(enabled: boolean) {
  const key = useTenantKey('jobs', 'pending')
  return useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => {
      const { data, error } = await db()
        .from('jobs')
        .select(
          jobSelect +
            ', order:sales_orders(id, doc_no, customer_po_no, due_date, customer:customers(name), items:sales_order_items(id, line_no, description, qty))',
        )
        .eq('status', 'pending_approval')
        .order('created_at')
        .order('seq', { referencedTable: 'job_steps' })
      if (error) throw error
      return data as unknown as PendingJob[]
    },
  })
}

export function useProfileNames(ids: string[]) {
  const key = useTenantKey('profiles', ids.join(','))
  return useQuery({
    queryKey: key,
    enabled: ids.length > 0,
    queryFn: async () => {
      const { data, error } = await db().from('profiles').select('id, full_name').in('id', ids)
      if (error) throw error
      return new Map((data as { id: string; full_name: string | null }[]).map((p) => [p.id, p.full_name ?? '—']))
    },
  })
}

// Release & board (Sprint 4) ------------------------------------------------------

export const useReleaseJobs = () => usePlanCommand<{ p_jobs: string[] }>('release_jobs')

export type StepStatus = 'pending' | 'ready' | 'in_progress' | 'paused' | 'done' | 'skipped' | 'failed'

export type BoardStep = {
  id: string
  job_id: string
  seq: number
  process_id: string
  step_type: StepType
  machine_id: string | null
  status: StepStatus
  queue_position: number | null
  planned_start: string | null
  planned_end: string | null
  est_minutes: number | null
  planned_qty: number
  version: number
  job: {
    id: string
    job_no: string
    title: string
    due_date: string | null
    is_at_risk: boolean
    order: { doc_no: string; customer_po_no: string; customer: { name: string } | null } | null
  }
}

export type ApprovedJob = { id: string; job_no: string; title: string; due_date: string | null; order: { doc_no: string } | null }

export function useBoard() {
  const key = useTenantKey('board')
  return useQuery({
    queryKey: key,
    refetchInterval: 30_000,   // until realtime broadcast lands (design §6.8)
    queryFn: async () => {
      const [steps, approved] = await Promise.all([
        db()
          .from('job_steps')
          .select(
            'id, job_id, seq, process_id, step_type, machine_id, status, queue_position, planned_start, planned_end, est_minutes, planned_qty, version, ' +
              'job:jobs!inner(id, job_no, title, due_date, is_at_risk, status, order:sales_orders(doc_no, customer_po_no, customer:customers(name)))',
          )
          .eq('job.status', 'in_production')
          .in('status', ['pending', 'ready', 'in_progress', 'paused'])
          .order('queue_position', { nullsFirst: false })
          .order('planned_start'),
        db().from('jobs').select('id, job_no, title, due_date, order:sales_orders(doc_no)').eq('status', 'approved').order('due_date'),
      ])
      if (steps.error) throw steps.error
      if (approved.error) throw approved.error
      return { steps: steps.data as unknown as BoardStep[], approved: approved.data as unknown as ApprovedJob[] }
    },
  })
}

export type LoadRow = { machine_id: string; day: string; available_min: number; planned_min: number }

export function useMachineLoad(days = 7) {
  const key = useTenantKey('machine-load', days)
  return useQuery({
    queryKey: key,
    refetchInterval: 30_000,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10)
      const { data, error } = await rpc().rpc('machine_load', { p_from: today, p_days: days })
      if (error) throw error
      return data as LoadRow[]
    },
  })
}

export type MoveResult = { version: number; load_pct: number | null; day: string | null; late_jobs: string[] }

export function useMoveStep() {
  const qc = useQueryClient()
  const boardKey = useTenantKey('board')
  const loadKey = useTenantKey('machine-load')
  return useMutation({
    mutationFn: async (args: { step: string; machine: string | null; before: string | null; version: number }) => {
      const { data, error } = await rpc().rpc('move_step', {
        p_step: args.step,
        p_machine: args.machine,
        p_before: args.before,
        p_version: args.version,
      })
      if (error) throw error
      return data as MoveResult
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: boardKey }), qc.invalidateQueries({ queryKey: loadKey })]),
  })
}

export function useReschedule() {
  const qc = useQueryClient()
  const boardKey = useTenantKey('board')
  const loadKey = useTenantKey('machine-load')
  return useMutation({
    mutationFn: async () => {
      const { error } = await rpc().rpc('reschedule')
      if (error) throw error
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: boardKey }), qc.invalidateQueries({ queryKey: loadKey })]),
  })
}
