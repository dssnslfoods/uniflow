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
  status?: StepStatus
  is_rework?: boolean
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
  'steps:job_steps(id, seq, process_id, step_type, machine_id, planned_qty, n_up, passes, est_minutes, note, status, is_rework)'

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
  const downKey = useTenantKey('downtimes')
  const jobKey = useTenantKey('job')
  return () =>
    Promise.all(
      [jobsKey, coverageKey, approvalsKey, ordersKey, boardKey, loadKey, downKey, jobKey].map((queryKey) =>
        qc.invalidateQueries({ queryKey }),
      ),
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

export function usePlanCommand<A extends Record<string, unknown>, R = number | null>(fn: string) {
  const invalidate = useInvalidatePlan()
  return useMutation({
    mutationFn: async (args: A) => {
      const { data, error } = await rpc().rpc(fn, args)
      if (error) throw error
      return data as R
    },
    onSettled: invalidate,
  })
}

export const useSubmitPlan = () => usePlanCommand<{ p_sales_order: string }>('submit_po_plan')
export const useApprovePlan = () => usePlanCommand<{ p_sales_order: string; p_jobs?: string[] | null }>('approve_po_plan')
export const useRejectJobs = () =>
  usePlanCommand<{ p_jobs: string[]; p_reason: string; p_request_change?: boolean }>('reject_jobs')
export const useCancelJob = () => usePlanCommand<{ p_job: string; p_reason: string }>('cancel_job')
export const useEditWorkflow = () =>
  usePlanCommand<{ p_job: string; p_steps: Record<string, unknown>[]; p_reason: string | null }, null>('edit_workflow')
export const useAddRework = () =>
  usePlanCommand<{ p_step: string; p_qty: number; p_reason: string; p_machine?: string | null }, string>('add_rework_step')

export type MachineSuggestion = { machine_id: string; name: string; est_minutes: number; start_at: string; end_at: string; is_current: boolean }

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
  actual_start: string | null
  resumed_at: string | null
  run_minutes: number
  is_rework: boolean
  job: {
    id: string
    job_no: string
    title: string
    due_date: string | null
    is_at_risk: boolean
    status: JobStatus
    order: { doc_no: string; customer_po_no: string; customer: { name: string } | null } | null
  }
}

export type ApprovedJob = { id: string; job_no: string; title: string; due_date: string | null; order: { doc_no: string } | null }

export function useBoard() {
  const key = useTenantKey('board')
  return useQuery({
    queryKey: key,
    refetchInterval: 60_000,   // safety net; realtime broadcasts refresh it (design §6.8)
    queryFn: async () => {
      const [steps, approved] = await Promise.all([
        db()
          .from('job_steps')
          .select(
            'id, job_id, seq, process_id, step_type, machine_id, status, queue_position, planned_start, planned_end, est_minutes, planned_qty, version, ' +
              'actual_start, resumed_at, run_minutes, is_rework, ' +
              'job:jobs!inner(id, job_no, title, due_date, is_at_risk, status, released_at, order:sales_orders(doc_no, customer_po_no, customer:customers(name)))',
          )
          // Released jobs stay on the board while a new flow awaits approval or the job is on hold.
          .in('job.status', ['in_production', 'pending_approval', 'on_hold'])
          .not('job.released_at', 'is', null)
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

// Shop floor (Sprint 5) ------------------------------------------------------------

export type DowntimeReason =
  | 'breakdown' | 'planned_maintenance' | 'no_operator' | 'no_material' | 'waiting_approval' | 'changeover' | 'other'

export type Downtime = {
  id: string
  machine_id: string
  reason: DowntimeReason
  note: string | null
  started_at: string
  expected_end: string | null
}

export function useOpenDowntimes() {
  const key = useTenantKey('downtimes')
  return useQuery({
    queryKey: key,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db()
        .from('machine_downtimes')
        .select('id, machine_id, reason, note, started_at, expected_end')
        .is('ended_at', null)
      if (error) throw error
      return data as Downtime[]
    },
  })
}

export type CompleteResult = { job_done: boolean; waste_pct: number | null; waste_over: boolean; short_by: number }

export const useStartStep = () => usePlanCommand<{ p_step: string }>('start_step')
export const usePauseStep = () => usePlanCommand<{ p_step: string; p_reason?: string | null }>('pause_step')
export const useStartDowntime = () =>
  usePlanCommand<{ p_machine: string; p_reason: DowntimeReason; p_expected_minutes?: number | null; p_note?: string | null }>('start_downtime')
export const useEndDowntime = () => usePlanCommand<{ p_machine: string }>('end_downtime')

export const useCompleteStep = () =>
  usePlanCommand<{ p_step: string; p_good: number; p_waste: number; p_reason?: string | null }, CompleteResult>('complete_step')

// Minutes a step has actually run, including the running segment.
export function runMinutes(s: Pick<BoardStep, 'run_minutes' | 'resumed_at' | 'status'>, now = Date.now()) {
  const live = s.status === 'in_progress' && s.resumed_at ? (now - new Date(s.resumed_at).getTime()) / 60_000 : 0
  return Number(s.run_minutes ?? 0) + live
}

// Job detail -----------------------------------------------------------------------

export type JobDetail = Omit<Job, 'steps'> & {
  priority: number
  planned_finish_at: string | null
  is_at_risk: boolean
  released_at: string | null
  order: { id: string; doc_no: string; customer_po_no: string; customer: { name: string } | null; items: { id: string; line_no: number; description: string; qty: number }[] }
  steps: (JobStep & {
    status: StepStatus
    planned_start: string | null
    planned_end: string | null
    actual_start: string | null
    actual_end: string | null
    good_qty: number
    waste_qty: number
    run_minutes: number
    resumed_at: string | null
    is_rework: boolean
    rework_reason: string | null
  })[]
}

export type ActivityLog = { id: number; action: string; detail: Record<string, unknown>; actor_id: string | null; created_at: string }

export function useJobDetail(jobId: string) {
  const key = useTenantKey('job', jobId)
  return useQuery({
    queryKey: key,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [job, logs] = await Promise.all([
        db()
          .from('jobs')
          .select(
            'id, job_no, sales_order_id, title, qty, status, priority, due_date, workflow_version, created_at, planned_finish_at, is_at_risk, released_at, ' +
              'order:sales_orders(id, doc_no, customer_po_no, customer:customers(name), items:sales_order_items(id, line_no, description, qty)), ' +
              'lines:job_order_items(sales_order_item_id, qty), ' +
              'steps:job_steps(id, seq, process_id, step_type, machine_id, planned_qty, n_up, passes, est_minutes, note, status, ' +
              'planned_start, planned_end, actual_start, actual_end, good_qty, waste_qty, run_minutes, resumed_at, is_rework, rework_reason)',
          )
          .eq('id', jobId)
          .order('seq', { referencedTable: 'job_steps' })
          .single(),
        db()
          .from('job_activity_logs')
          .select('id, action, detail, actor_id, created_at')
          .eq('job_id', jobId)
          .order('created_at', { ascending: false })
          .limit(100),
      ])
      if (job.error) throw job.error
      if (logs.error) throw logs.error
      return { job: job.data as unknown as JobDetail, logs: logs.data as ActivityLog[] }
    },
  })
}

export function useSuggestMachines(stepId: string | null) {
  const key = useTenantKey('suggest', stepId)
  return useQuery({
    queryKey: key,
    enabled: !!stepId,
    staleTime: 0,
    queryFn: async () => {
      const { data, error } = await rpc().rpc('suggest_machines', { p_step: stepId })
      if (error) throw error
      return (data as MachineSuggestion[]).sort((a, b) => a.end_at.localeCompare(b.end_at))
    },
  })
}
