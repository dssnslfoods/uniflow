import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ArrowRight, Hammer, Highlighter } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { appLocale } from '@/shared/locale'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { stepTypeStyle } from '../masters/processes/step-type'
import { formatDate } from '../orders/format'
import { formatMinutes, runMinutes, useJobDetail, type BoardStep } from './api'
import { JobImages } from './job-images'
import { JobModal } from './job-page'
import { JobStatusPill } from './job-status'

const fmtTime = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso)) : '—'

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="tabular min-w-0 text-right">{children}</dd>
    </div>
  )
}

type Props = {
  step: BoardStep
  processName: Map<string, string>
  machineName: Map<string, string>
  focused: boolean
  onFocusJob: () => void
  onClose: () => void
}

// Card details on the board (design §8.1): the step, its job and where it sits in the flow.
export function StepDrawer({ step, processName, machineName, focused, onFocusJob, onClose }: Props) {
  const { t } = useTranslation()
  const detail = useJobDetail(step.job_id)
  const style = stepTypeStyle[step.step_type]
  const full = detail.data?.job.steps.find((s) => s.id === step.id)
  const ran = full ? runMinutes(full) : 0
  const canRecord = step.status === 'ready' || step.status === 'in_progress' || step.status === 'paused'
  const [jobOpen, setJobOpen] = useState(false)

  return (
    <>
    {jobOpen && <JobModal jobId={step.job_id} title={`${step.job.job_no} · ${step.job.title}`} onClose={() => setJobOpen(false)} />}
    <Drawer open title={`${step.job.job_no} · ${t('board.stage', { n: step.seq })}`} onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onFocusJob}>
            <Highlighter className="size-4" aria-hidden />{focused ? t('board.detail.unfocus') : t('board.detail.focus')}
          </Button>
          <Button onClick={() => setJobOpen(true)}>
            {t('board.detail.openJob')}<ArrowRight className="size-4" aria-hidden />
          </Button>
        </>
      }>
      <div className="flex flex-col gap-5">
        <header>
          <div className="flex items-center gap-2">
            <span className={cn('grid size-8 shrink-0 place-items-center rounded-lg', style.cls)}><style.Icon className="size-4" aria-hidden /></span>
            <h3 className="min-w-0 truncate text-lg font-semibold">{processName.get(step.process_id) ?? '—'}</h3>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{t(`stepStatus.${step.status}`)}</span>
            <JobStatusPill status={step.job.status} />
            {step.is_rework && <span className="rounded-full bg-status-paused/10 px-2 py-0.5 text-xs text-status-paused">{t('plan.rework')}</span>}
          </div>
          {step.job.is_at_risk && (
            <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">
              <AlertTriangle className="size-4 shrink-0" aria-hidden />{t('board.atRisk')}
            </p>
          )}
        </header>

        <section>
          <h4 className="text-[13px] font-medium">{t('board.detail.step')}</h4>
          <dl className="divide-y divide-border">
            <Row label={t('board.detail.machine')}>{step.machine_id ? machineName.get(step.machine_id) ?? '—' : t('board.manual')}</Row>
            <Row label={t('board.detail.qty')}>{t('plan.pcs', { n: Number(step.planned_qty).toLocaleString() })}</Row>
            {full && Number(full.n_up) > 1 && <Row label="n-up">{full.n_up}</Row>}
            {full && Number(full.passes) > 1 && <Row label={t('board.detail.passes')}>{full.passes}</Row>}
            <Row label={t('board.detail.estimate')}>{step.est_minutes != null ? formatMinutes(t, Number(step.est_minutes)) : '—'}</Row>
            <Row label={t('board.detail.start')}>{fmtTime(step.planned_start)}</Row>
            <Row label={t('board.detail.end')}>{fmtTime(step.planned_end)}</Row>
            {step.actual_start && <Row label={t('board.detail.actualStart')}>{fmtTime(step.actual_start)}</Row>}
            {ran > 0 && <Row label={t('job.runTime')}>{formatMinutes(t, ran)}</Row>}
          </dl>
          {full?.note && <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-sm">{full.note}</p>}
          {canRecord && (
            <Link to="/floor/step/$stepId" params={{ stepId: step.id }} className="mt-2 inline-flex items-center gap-1.5 text-sm text-brand hover:underline">
              <Hammer className="size-3.5" aria-hidden />{t('board.detail.record')}
            </Link>
          )}
        </section>

        <section>
          <h4 className="text-[13px] font-medium">{t('board.detail.job')}</h4>
          <dl className="divide-y divide-border">
            <Row label={t('board.detail.title')}>{step.job.title}</Row>
            <Row label={t('board.detail.customer')}>{step.job.order?.customer?.name ?? '—'}</Row>
            <Row label="PO">{step.job.order ? `${step.job.order.customer_po_no} (${step.job.order.doc_no})` : '—'}</Row>
            <Row label={t('board.detail.due')}>
              <span className={cn(step.job.is_at_risk && 'font-semibold text-status-risk')}>{formatDate(step.job.due_date)}</span>
            </Row>
          </dl>
        </section>

        <section>
          <h4 className="mb-2 text-[13px] font-medium">{t('jobImages.title')}</h4>
          <JobImages jobId={step.job_id} open={step.job.status !== 'completed' && step.job.status !== 'cancelled'} />
        </section>

        <section>
          <h4 className="mb-2 text-[13px] font-medium">{t('job.flow')}</h4>
          {detail.isLoading ? <ListSkeleton rows={3} /> : detail.error ? <ErrorNote>{errorMessage(detail.error)}</ErrorNote> : (
            <ol className="flex flex-col gap-1">
              {detail.data!.job.steps.map((s) => (
                <li key={s.id} aria-current={s.id === step.id ? 'step' : undefined}
                  className={cn('flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm', s.id === step.id ? 'bg-brand/10 font-medium' : s.status === 'done' && 'text-muted')}>
                  <span className="tabular w-5 shrink-0 text-xs text-muted">{s.seq}</span>
                  <span className="min-w-0 flex-1 truncate">{processName.get(s.process_id) ?? '—'}</span>
                  <span className="shrink-0 text-xs text-muted">{t(`stepStatus.${s.status}`)}</span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </Drawer>
    </>
  )
}
