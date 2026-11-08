import type { ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { Check, CircleX, ClipboardList, FileText, Flag, Hammer, Play, ShieldCheck, Truck } from 'lucide-react'
import { db } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useTenantKey } from '@/shared/data'
import { appLocale } from '@/shared/locale'
import type { OutsourceStatus } from '../outsource/api'
import type { ActivityLog, JobDetail, JobStatus } from './api'

type OsDoc = { id: string; doc_no: string; status: OutsourceStatus; sent_at: string }
type DoDoc = { qty: number; delivery: { id: string; doc_no: string; delivered_at: string } }

// Documents raised after the job: outsource orders on its steps and delivery notes carrying it.
function useJobDocs(jobId: string) {
  const key = useTenantKey('job', jobId, 'docs')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const [os, dn] = await Promise.all([
        db().from('outsource_orders').select('id, doc_no, status, sent_at, step:job_steps!inner(job_id)').eq('step.job_id', jobId).order('sent_at'),
        db().from('delivery_items').select('qty, delivery:deliveries(id, doc_no, delivered_at)').eq('job_id', jobId),
      ])
      if (os.error) throw os.error
      if (dn.error) throw dn.error
      const deliveries = (dn.data as unknown as DoDoc[]).sort((a, b) => a.delivery.delivered_at.localeCompare(b.delivery.delivered_at))
      return { outsource: os.data as unknown as OsDoc[], deliveries }
    },
  })
}

type State = 'done' | 'current' | 'todo' | 'stopped'
type Node = { key: string; Icon: typeof Check; state: State; doc?: ReactNode; sub?: ReactNode; date?: string | null }

const rank: Record<JobStatus, number> = {
  planning: 0, pending_approval: 1, approved: 2, in_production: 3, on_hold: 3,
  ready_to_deliver: 4, partially_delivered: 5, completed: 6, cancelled: -1,
}

const fmt = (iso: string | null | undefined) =>
  iso ? new Intl.DateTimeFormat(appLocale(), { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(iso)) : null

// The job's path through its documents, from the customer's PO to the last delivery note.
export function DocFlow({ job, logs }: { job: JobDetail; logs: ActivityLog[] }) {
  const { t } = useTranslation()
  const docs = useJobDocs(job.id)
  const lastLog = (action: string) => logs.find((l) => l.action === action)?.created_at ?? null
  const r = rank[job.status]
  const cancelled = job.status === 'cancelled'
  const released = !!job.released_at
  const reapproval = job.status === 'pending_approval' && released
  const steps = job.steps.filter((s) => s.status !== 'skipped')
  const stepsDone = steps.filter((s) => s.status === 'done').length
  const osDocs = docs.data?.outsource ?? []
  const hasOutside = job.steps.some((s) => s.step_type === 'outsource')
  const deliveries = docs.data?.deliveries ?? []
  const delivered = deliveries.reduce((n, d) => n + Number(d.qty), 0)
  const at = (done: boolean, current: boolean): State => (cancelled && !done ? 'stopped' : done ? 'done' : current ? 'current' : 'todo')

  const nodes: Node[] = [
    {
      key: 'po', Icon: FileText, state: 'done',
      doc: <Link to="/orders/$orderId" params={{ orderId: job.order.id }} className="hover:text-brand">{job.order.doc_no}</Link>,
      sub: `PO ${job.order.customer_po_no}`,
    },
    {
      key: 'job', Icon: ClipboardList, state: at(r >= 1 || released, r === 0),
      doc: job.job_no, sub: r === 0 ? t('docFlow.planning') : undefined, date: job.created_at,
    },
    {
      key: 'approval', Icon: ShieldCheck, state: at((r >= 2 || released) && !reapproval, job.status === 'pending_approval'),
      sub: job.status === 'pending_approval' ? t(reapproval ? 'docFlow.reapproval' : 'docFlow.waiting') : undefined,
      date: r >= 2 || released ? lastLog('approved') : lastLog('submitted'),
    },
    {
      key: 'release', Icon: Play, state: at(released, job.status === 'approved'),
      date: job.released_at,
    },
    {
      key: 'production', Icon: Hammer, state: at(r >= 4, released && r === 3 || reapproval),
      sub: (
        <>
          <span className="tabular">{t('docFlow.steps', { done: stepsDone, total: steps.length })}</span>
          {job.status === 'on_hold' && <span className="block text-status-paused">{t('jobStatus.on_hold')}</span>}
          {hasOutside && (
            <span className="mt-1 flex flex-col items-center gap-0.5">
              {osDocs.length === 0 && <span>{t('docFlow.outsideNotSent')}</span>}
              {osDocs.map((o) => (
                <Link key={o.id} to="/outsource" className="whitespace-nowrap hover:text-brand">
                  {o.doc_no} · {t(`outsource.status.${o.status}`)}
                </Link>
              ))}
            </span>
          )}
        </>
      ),
      date: lastLog('production_finished'),
    },
    {
      key: 'delivery', Icon: Truck, state: at(r >= 6, r === 4 || r === 5),
      sub: deliveries.length ? (
        <span className="flex flex-col items-center gap-0.5">
          {deliveries.map((d) => (
            <Link key={d.delivery.id} to="/deliveries/$deliveryId" params={{ deliveryId: d.delivery.id }} className="tabular whitespace-nowrap hover:text-brand">
              {d.delivery.doc_no} · {Number(d.qty).toLocaleString()}
            </Link>
          ))}
          <span className="tabular">{t('docFlow.delivered', { n: delivered.toLocaleString(), of: Number(job.qty).toLocaleString() })}</span>
        </span>
      ) : undefined,
      date: deliveries.at(-1)?.delivery.delivered_at,
    },
    cancelled
      ? { key: 'cancelled', Icon: CircleX, state: 'stopped', date: lastLog('cancelled') }
      : { key: 'done', Icon: Flag, state: at(r >= 6, false), date: r >= 6 ? deliveries.at(-1)?.delivery.delivered_at ?? lastLog('closed_short') : null },
  ]

  return (
    <section className="mb-5 rounded-[var(--radius-card)] border border-border bg-surface p-5" aria-label={t('docFlow.title')}>
      <h2 className="mb-4 font-semibold">{t('docFlow.title')}</h2>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <ol className="flex min-w-[720px]">
          {nodes.map((n, i) => {
            const next = nodes[i + 1]
            return (
              <li key={n.key} className="relative flex flex-1 flex-col items-center px-1 text-center" aria-current={n.state === 'current' ? 'step' : undefined}>
                {next && (
                  <span aria-hidden className={cn('absolute left-1/2 top-[18px] h-0.5 w-full',
                    n.state === 'done' && next.state !== 'todo' && next.state !== 'stopped' ? 'bg-status-done' : 'bg-border')} />
                )}
                <span className={cn('relative z-10 grid size-9 place-items-center rounded-full border-2',
                  n.state === 'done' && 'border-status-done bg-status-done text-white',
                  n.state === 'current' && 'border-brand bg-surface text-brand ring-4 ring-brand/15',
                  n.state === 'todo' && 'border-border bg-surface text-muted',
                  n.state === 'stopped' && (n.key === 'cancelled' ? 'border-status-risk bg-status-risk text-white' : 'border-border bg-surface-2 text-muted opacity-50'))}>
                  {n.state === 'done' ? <Check className="size-4" aria-hidden /> : <n.Icon className="size-4" aria-hidden />}
                </span>
                <span className={cn('mt-2 text-xs font-semibold', n.state === 'todo' || n.state === 'stopped' ? 'text-muted' : 'text-fg', n.key === 'cancelled' && 'text-status-risk')}>
                  {t(`docFlow.node.${n.key}`)}
                </span>
                {n.doc && <span className="text-xs font-medium">{n.doc}</span>}
                {n.sub && <span className="text-[11px] text-muted">{n.sub}</span>}
                {n.date && n.state !== 'todo' && <span className="tabular text-[11px] text-muted">{fmt(n.date)}</span>}
              </li>
            )
          })}
        </ol>
      </div>
    </section>
  )
}
