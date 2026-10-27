import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { CheckCheck, Clock, GitFork, Inbox } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useMachines } from '../masters/machines/api'
import { useProcesses } from '../masters/processes/api'
import { stepTypeStyle } from '../masters/processes/step-type'
import { formatDate } from '../orders/format'
import {
  formatMinutes,
  useApprovals,
  useApprovePlan,
  usePendingApprovals,
  useProfileNames,
  useRejectJobs,
  type Approval,
  type PendingJob,
} from './api'

export function ApprovalsPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const isManager = hasRole('manager')
  const pending = usePendingApprovals(true)
  const jobs = pending.data ?? []
  const approvals = useApprovals(jobs.map((j) => j.id))
  const submits = (approvals.data ?? []).filter((a) => a.action === 'submit')
  const names = useProfileNames([...new Set(submits.map((a) => a.actor_id))])

  // One card per PO (D-18): approve the whole plan, send back single jobs.
  const groups = useMemo(() => {
    const byOrder = new Map<string, PendingJob[]>()
    jobs.forEach((j) => byOrder.set(j.order.id, [...(byOrder.get(j.order.id) ?? []), j]))
    return [...byOrder.values()]
  }, [jobs])

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('approvals.title')} subtitle={t('approvals.subtitle')} />
      {pending.isLoading ? (
        <ListSkeleton />
      ) : pending.error ? (
        <ErrorNote>{errorMessage(pending.error)}</ErrorNote>
      ) : groups.length === 0 ? (
        <EmptyState Icon={Inbox} title={t('approvals.empty')} hint={t('approvals.emptyHint')} />
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g) => (
            <OrderGroup key={g[0].order.id} jobs={g} submits={submits} names={names.data} canDecide={isManager} />
          ))}
        </div>
      )}
    </div>
  )
}

type GroupProps = { jobs: PendingJob[]; submits: Approval[]; names?: Map<string, string>; canDecide: boolean }

function OrderGroup({ jobs, submits, names, canDecide }: GroupProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const approve = useApprovePlan()
  const reject = useRejectJobs()
  const order = jobs[0].order

  const submit = submits.find((a) => jobs.some((j) => j.id === a.entity_id))
  const waitingHours = submit ? Math.floor((Date.now() - new Date(submit.created_at).getTime()) / 3_600_000) : 0

  function approveAll() {
    approve.mutate(
      { p_sales_order: order.id, p_jobs: null },
      {
        onSuccess: (n) => toast({ tone: 'success', message: t('approvals.approved', { n }) }),
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  function sendBack(jobId: string, requestChange: boolean) {
    const reason = window.prompt(t('approvals.reason'))
    if (!reason?.trim()) return
    reject.mutate(
      { p_jobs: [jobId], p_reason: reason, p_request_change: requestChange },
      {
        onSuccess: () => toast({ tone: 'success', message: t('approvals.rejectedToast') }),
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <section className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface-2/50 px-5 py-3">
        <div className="min-w-0">
          <Link to="/orders/$orderId/plan" params={{ orderId: order.id }} className="font-semibold hover:text-brand">
            {order.doc_no} · {order.customer?.name}
          </Link>
          <div className="text-xs text-muted">
            PO {order.customer_po_no} · {t('orders.dueDate')} {formatDate(order.due_date)}
            {submit && <> · {t('approvals.submittedBy', { name: names?.get(submit.actor_id) ?? '…', when: formatDate(submit.created_at) })}</>}
          </div>
        </div>
        {waitingHours >= 1 && (
          <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs', waitingHours >= 24 ? 'bg-status-risk/10 text-status-risk' : 'bg-surface-2 text-muted')}>
            <Clock className="size-3.5" aria-hidden />
            {t('approvals.waiting', { h: waitingHours })}
          </span>
        )}
        {canDecide && (
          <Button className="ml-auto" onClick={approveAll} loading={approve.isPending}>
            <CheckCheck className="size-4" aria-hidden />
            {t('approvals.approveAll', { n: jobs.length })}
          </Button>
        )}
      </header>

      <ul>
        {jobs.map((job, i) => (
          <JobSummary key={job.id} job={job} first={i === 0}>
            {canDecide && (
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => sendBack(job.id, true)}>{t('approvals.requestChange')}</Button>
                <Button variant="ghost" size="sm" className="text-status-risk" onClick={() => sendBack(job.id, false)}>{t('approvals.reject')}</Button>
              </div>
            )}
          </JobSummary>
        ))}
      </ul>
    </section>
  )
}

function JobSummary({ job, first, children }: { job: PendingJob; first: boolean; children: ReactNode }) {
  const { t } = useTranslation()
  const processes = useProcesses()
  const machines = useMachines()
  const processName = useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p.name])), [processes.data])
  const machineName = useMemo(() => new Map((machines.data ?? []).map((m) => [m.id, m.name])), [machines.data])
  const itemById = new Map(job.order.items.map((i) => [i.id, i]))
  const total = job.steps.reduce((s, x) => s + Number(x.est_minutes ?? 0), 0)

  return (
    <li className={cn('px-5 py-4', !first && 'border-t border-border')}>
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-muted">{job.job_no}</span>
        <span className="font-semibold">{job.title}</span>
        <span className="tabular text-sm text-muted">{t('plan.pcs', { n: Number(job.qty).toLocaleString() })}</span>
        {total > 0 && <span className="tabular text-xs text-muted">· {t('plan.totalTime', { t: formatMinutes(t, total) })}</span>}
        <div className="ml-auto">{children}</div>
      </div>

      <div className="mb-3 flex flex-wrap gap-1.5">
        {job.lines.map((l) => {
          const item = itemById.get(l.sales_order_item_id)
          return (
            <span key={l.sales_order_item_id} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">
              {item?.line_no}. {item?.description} <span className="tabular text-muted">× {Number(l.qty).toLocaleString()}</span>
            </span>
          )
        })}
      </div>

      {/* Flow as stages left→right; parallel steps stack within a stage (D-07). */}
      <ol className="flex flex-wrap items-stretch gap-2">
        {[...new Set(job.steps.map((s) => s.seq))].map((seq, si) => {
          const stage = job.steps.filter((s) => s.seq === seq)
          return (
            <li key={seq} className="flex items-center gap-2">
              {si > 0 && <span className="text-muted" aria-hidden>→</span>}
              <div className="flex flex-col gap-1">
                {stage.length > 1 && <GitFork className="size-3 text-muted" aria-label={t('templates.parallel')} />}
                {stage.map((s, k) => {
                  const style = stepTypeStyle[s.step_type]
                  return (
                    <div key={k} className={cn('flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs', style.cls)}>
                      <style.Icon className="size-3.5" aria-hidden />
                      <span className="font-medium">{processName.get(s.process_id)}</span>
                      {s.machine_id && <span className="opacity-80">· {machineName.get(s.machine_id)}</span>}
                      {s.est_minutes != null && <span className="tabular opacity-70">· {formatMinutes(t, Number(s.est_minutes))}</span>}
                    </div>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ol>
    </li>
  )
}
