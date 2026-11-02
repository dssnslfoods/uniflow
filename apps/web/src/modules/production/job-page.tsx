import { useMemo, useState } from 'react'
import { appLocale } from '@/shared/locale'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowLeft, Printer, RotateCcw } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useMachines } from '../masters/machines/api'
import { useProcesses } from '../masters/processes/api'
import { stepTypeStyle } from '../masters/processes/step-type'
import { formatDate } from '../orders/format'
import { useAuth } from '@/app/auth'
import { isFloorOnly } from '@/lib/claims'
import { Input } from '@/shared/ui/input'
import { useToast } from '@/shared/ui/toast'
import { useAddRework, useProfileNames, formatMinutes, runMinutes, useJobDetail, type JobDetail } from './api'
import { JobMaterialsIssue } from '../inventory/job-materials'
import { ProofPanel } from '../proof/proof-panel'
import { JobStatusPill } from './job-status'

const fmtTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat(appLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—'

const stepTone: Record<string, string> = {
  pending: 'border-border',
  ready: 'border-status-ready/50',
  in_progress: 'border-status-progress bg-status-progress/5',
  paused: 'border-status-paused bg-status-paused/5',
  done: 'border-status-done/40 bg-status-done/5',
  skipped: 'border-border opacity-60',
  failed: 'border-status-risk',
}

function useLookups() {
  const processes = useProcesses()
  const machines = useMachines()
  return {
    processName: useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p.name])), [processes.data]),
    machineName: useMemo(() => new Map((machines.data ?? []).map((m) => [m.id, m.name])), [machines.data]),
  }
}

// Job card (FR-4.8): flow with plan vs actual, PO lines, activity log.
export function JobPage({ jobId }: { jobId: string }) {
  const { t } = useTranslation()
  const detail = useJobDetail(jobId)
  const { hasRole, claims } = useAuth()
  const canRework = hasRole('admin', 'manager', 'supervisor')
  const { processName, machineName } = useLookups()
  const actorIds = useMemo(() => [...new Set((detail.data?.logs ?? []).map((l) => l.actor_id).filter(Boolean) as string[])], [detail.data])
  const names = useProfileNames(actorIds)

  if (detail.isLoading) return <ListSkeleton />
  if (detail.error) return <ErrorNote>{errorMessage(detail.error)}</ErrorNote>
  const { job, logs } = detail.data!
  const done = job.steps.filter((s) => s.status === 'done' || s.status === 'skipped').length
  const progress = job.steps.length ? Math.round((done / job.steps.length) * 100) : 0
  const items = new Map(job.order.items.map((i) => [i.id, i]))

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        {isFloorOnly(claims) ? (
          <Link to="/floor" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t('common.back')}>
            <ArrowLeft className="size-5" />
          </Link>
        ) : (
          <Link to="/orders/$orderId/plan" params={{ orderId: job.order.id }} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t('common.back')}>
            <ArrowLeft className="size-5" />
          </Link>
        )}
        <div className="min-w-0">
          <div className="text-xs font-medium text-muted">{job.job_no} · {job.order.doc_no} · PO {job.order.customer_po_no}</div>
          <h1 className="text-xl font-semibold">{job.title}</h1>
          <p className="text-sm text-muted">{job.order.customer?.name}</p>
        </div>
        <JobStatusPill status={job.status} />
        {job.is_at_risk && (
          <span className="inline-flex items-center gap-1 rounded-full bg-status-risk/10 px-2 py-0.5 text-xs font-medium text-status-risk">
            <AlertTriangle className="size-3.5" aria-hidden />{t('board.atRisk')}
          </span>
        )}
        <Link to="/jobs/$jobId/ticket" params={{ jobId }} className="ml-auto">
          <Button variant="secondary"><Printer className="size-4" aria-hidden />{t('job.ticket')}</Button>
        </Link>
      </div>

      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kpi label={t('plan.qty')} value={t('plan.pcs', { n: Number(job.qty).toLocaleString() })} />
        <Kpi label={t('orders.dueDate')} value={formatDate(job.due_date)} tone={job.is_at_risk ? 'risk' : undefined} />
        <Kpi label={t('job.plannedFinish', { d: '' }).trim()} value={fmtTime(job.planned_finish_at)} />
        <Kpi label={t('job.progress', { p: progress })} value={`${done}/${job.steps.length}`} bar={progress} />
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-5">
        <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <h2 className="mb-3 font-semibold">{t('job.flow')}</h2>
          <ol className="flex flex-col gap-2">
            {job.steps.map((s) => {
              const style = stepTypeStyle[s.step_type]
              const ran = runMinutes(s)
              return (
                <li key={s.id} className={cn('rounded-lg border px-3 py-2.5', stepTone[s.status])}>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="tabular w-14 text-xs font-medium text-muted">{t('board.stage', { n: s.seq })}</span>
                    <span className={cn('grid size-6 place-items-center rounded', style.cls)}><style.Icon className="size-3.5" aria-hidden /></span>
                    <span className="font-medium">{processName.get(s.process_id)}</span>
                    {s.is_rework && (
                      <span className="rounded bg-status-paused/10 px-1.5 py-0.5 text-[11px] text-status-paused" title={s.rework_reason ?? ''}>
                        {t('plan.rework')}
                      </span>
                    )}
                    {s.machine_id && <span className="text-sm text-muted">· {machineName.get(s.machine_id)}</span>}
                    <span className="ml-auto rounded-full bg-surface-2 px-2 py-0.5 text-xs">{t(`stepStatus.${s.status}`)}</span>
                  </div>
                  <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 pl-16 text-xs text-muted sm:grid-cols-4">
                    <span>{t('job.planned')}: {fmtTime(s.planned_start)}</span>
                    <span>{t('job.actual')}: {fmtTime(s.actual_start)}{s.actual_end ? ` → ${fmtTime(s.actual_end)}` : ''}</span>
                    <span className="tabular">{t('job.runTime')}: {ran > 0 ? formatMinutes(t, ran) : '—'} / {formatMinutes(t, s.est_minutes)}</span>
                    {s.status === 'done' && (
                      <span className="tabular">
                        <span className="text-status-done">{t('job.good')} {Number(s.good_qty).toLocaleString()}</span>
                        {Number(s.waste_qty) > 0 && <span className="text-status-risk"> · {t('job.waste')} {Number(s.waste_qty).toLocaleString()}</span>}
                      </span>
                    )}
                  </div>
                  {s.rework_reason && <p className="mt-1 pl-16 text-xs text-status-paused">{s.rework_reason}</p>}
                  {s.status === 'done' && canRework && (job.status === 'in_production' || job.status === 'ready_to_deliver') && (
                    <ReworkForm stepId={s.id!} suggestedQty={Number(s.waste_qty)} />
                  )}
                </li>
              )
            })}
          </ol>

          <h3 className="mb-2 mt-5 text-[13px] font-medium">{t('job.lines')}</h3>
          <div className="flex flex-wrap gap-1.5">
            {job.lines.map((l) => (
              <span key={l.sales_order_item_id} className="rounded-full bg-surface-2 px-2.5 py-0.5 text-xs">
                {items.get(l.sales_order_item_id)?.line_no}. {items.get(l.sales_order_item_id)?.description} × {Number(l.qty).toLocaleString()}
              </span>
            ))}
          </div>
        </section>
        <ProofPanel jobId={job.id} active={!['completed', 'cancelled'].includes(job.status)} />
        <JobMaterialsIssue jobId={job.id} active={['approved', 'in_production', 'pending_approval', 'on_hold', 'ready_to_deliver'].includes(job.status)} />
        </div>

        <aside className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
          <h2 className="mb-3 font-semibold">{t('job.activity')}</h2>
          {logs.length === 0 ? (
            <p className="text-sm text-muted">{t('job.noActivity')}</p>
          ) : (
            <ol className="relative flex flex-col gap-3 border-l border-border pl-4">
              {logs.map((l) => (
                <li key={l.id} className="text-sm">
                  <span className="absolute -left-1 mt-1.5 size-2 rounded-full bg-brand" aria-hidden />
                  <div className="font-medium">{t(`job.log.${l.action}`, { defaultValue: l.action })}</div>
                  <div className="text-xs text-muted">
                    {fmtTime(l.created_at)}{l.actor_id ? ` · ${names.data?.get(l.actor_id) ?? '…'}` : ''}
                    {typeof l.detail?.reason === 'string' && <> · {l.detail.reason}</>}
                    {l.detail?.good != null && <> · {t('job.good')} {String(l.detail.good)} / {t('job.waste')} {String(l.detail.waste)}</>}
                  </div>
                </li>
              ))}
            </ol>
          )}
        </aside>
      </div>
    </div>
  )
}

// Rework (G-04): redo part of a finished step; no re-approval needed.
function ReworkForm({ stepId, suggestedQty }: { stepId: string; suggestedQty: number }) {
  const { t } = useTranslation()
  const toast = useToast()
  const add = useAddRework()
  const [open, setOpen] = useState(false)
  const [qty, setQty] = useState(String(suggestedQty || ''))
  const [reason, setReason] = useState('')

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-1.5 ml-16 inline-flex items-center gap-1 text-xs text-status-paused hover:underline">
        <RotateCcw className="size-3.5" aria-hidden />
        {t('job.addRework')}
      </button>
    )
  }
  return (
    <form
      className="mt-2 ml-16 flex flex-wrap items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        add.mutate(
          { p_step: stepId, p_qty: Number(qty), p_reason: reason },
          {
            onSuccess: () => { toast({ tone: 'success', message: t('job.reworkAdded') }); setOpen(false) },
            onError: (err) => toast({ tone: 'error', message: errorMessage(err) }),
          },
        )
      }}
    >
      <Input type="number" min={1} aria-label={t('plan.qty')} placeholder={t('plan.qty')} className="tabular h-8 w-24 text-right" value={qty}
        onChange={(e) => setQty(e.target.value)} required autoFocus />
      <Input aria-label={t('job.reworkReason')} placeholder={t('job.reworkReason')} className="h-8 min-w-40 flex-1" value={reason}
        onChange={(e) => setReason(e.target.value)} required />
      <Button size="sm" type="submit" loading={add.isPending}>{t('job.addRework')}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>{t('common.cancel')}</Button>
    </form>
  )
}

function Kpi({ label, value, tone, bar }: { label: string; value: string; tone?: 'risk'; bar?: number }) {
  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('tabular mt-1 text-lg font-semibold', tone === 'risk' && 'text-status-risk')}>{value}</dd>
      {bar != null && (
        <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full rounded-full bg-status-done" style={{ width: `${bar}%` }} />
        </div>
      )}
    </div>
  )
}

// Printable job ticket: one QR per step opens that step on the shop-floor screen (design §8 / SRS §12).
export function JobTicketPage({ jobId }: { jobId: string }) {
  const { t } = useTranslation()
  const detail = useJobDetail(jobId)
  const { processName, machineName } = useLookups()
  if (detail.isLoading) return <ListSkeleton />
  if (detail.error) return <ErrorNote>{errorMessage(detail.error)}</ErrorNote>
  const job: JobDetail = detail.data!.job

  return (
    <div className="mx-auto max-w-3xl bg-white p-6 text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to="/jobs/$jobId" params={{ jobId }} className="text-sm text-muted hover:underline">← {job.job_no}</Link>
        <Button onClick={() => window.print()}><Printer className="size-4" aria-hidden />{t('job.ticket')}</Button>
      </div>
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <p className="text-xs uppercase tracking-wide">{t('job.ticketTitle')}</p>
          <h1 className="text-2xl font-bold">{job.job_no}</h1>
          <p className="text-lg">{job.title}</p>
          <p className="text-sm">{job.order.customer?.name} · {job.order.doc_no} · PO {job.order.customer_po_no}</p>
        </div>
        <div className="text-right text-sm">
          <p>{t('plan.qty')}: <b>{Number(job.qty).toLocaleString()}</b></p>
          <p>{t('orders.dueDate')}: <b>{formatDate(job.due_date)}</b></p>
        </div>
      </header>
      <ol className="mt-4 grid grid-cols-2 gap-3">
        {job.steps.map((s) => (
          <li key={s.id} className="flex break-inside-avoid gap-3 rounded border border-black p-3">
            <QRCodeSVG value={`${window.location.origin}/floor/step/${s.id}`} size={88} level="M" />
            <div className="min-w-0 text-sm">
              <p className="text-xs">{t('board.stage', { n: s.seq })}</p>
              <p className="text-base font-bold">{processName.get(s.process_id)}</p>
              {s.machine_id && <p>{machineName.get(s.machine_id)}</p>}
              <p className="tabular">{Number(s.planned_qty).toLocaleString()} · n-up {s.n_up}</p>
              <p className="mt-1 text-[11px]">{t('job.scan')}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  )
}
