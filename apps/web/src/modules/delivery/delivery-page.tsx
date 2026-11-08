import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { PackageCheck, Printer, Truck } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { localDate } from '@/shared/locale'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Textarea } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { formatDate } from '../orders/format'
import { useTenant } from '../settings/api'
import { useCloseJobShort, useCreateDelivery, useDeliverableJobs, useDeliveries, useDelivery, type DeliverableJob } from './api'
import { JobLink } from '../production/job-link'

const delivered = (j: DeliverableJob) => j.delivered.reduce((s, d) => s + Number(d.qty), 0)
// Only good pieces can go out (D-24).
const deliverable = (j: DeliverableJob) => Math.max(Math.min(Number(j.qty), j.good_qty) - delivered(j), 0)

// Deliveries (FR-9): finished jobs grouped by PO, partial deliveries, printable notes.
export function DeliveryPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const ready = useDeliverableJobs()
  const history = useDeliveries()
  const [creating, setCreating] = useState<DeliverableJob[] | null>(null)
  const canAct = hasRole('admin', 'manager', 'supervisor')
  const canClose = hasRole('admin', 'manager')
  const toast = useToast()
  const closeShort = useCloseJobShort()

  function onCloseShort(j: DeliverableJob) {
    const reason = window.prompt(t('delivery.closeShortReason', { job: j.job_no, n: delivered(j).toLocaleString(), q: Number(j.qty).toLocaleString() }))
    if (!reason?.trim()) return
    closeShort.mutate(
      { p_job: j.id, p_reason: reason.trim() },
      {
        onSuccess: () => toast({ tone: 'success', message: t('delivery.closedShort', { job: j.job_no }) }),
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  const groups = useMemo(() => {
    const by = new Map<string, DeliverableJob[]>()
    ;(ready.data ?? []).forEach((j) => by.set(j.order.id, [...(by.get(j.order.id) ?? []), j]))
    return [...by.values()]
  }, [ready.data])

  if (ready.isLoading) return <ListSkeleton />
  if (ready.error) return <ErrorNote>{errorMessage(ready.error)}</ErrorNote>

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('delivery.title')} subtitle={t('delivery.subtitle')} />

      <h2 className="mb-2 font-semibold">{t('delivery.ready')}</h2>
      {groups.length === 0 ? (
        <EmptyState Icon={PackageCheck} title={t('delivery.readyEmpty')} hint={t('delivery.subtitle')} />
      ) : (
        <div className="flex flex-col gap-3">
          {groups.map((jobs) => {
            const o = jobs[0].order
            return (
              <section key={o.id} className="rounded-[var(--radius-card)] border border-border bg-surface">
                <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
                  <div className="min-w-0">
                    <div className="font-semibold">{o.doc_no} · {o.customer?.name}</div>
                    <div className="text-xs text-muted">PO {o.customer_po_no}{o.delivery_info?.address ? ` · ${o.delivery_info.address}` : ''}</div>
                  </div>
                  {canAct && (
                    <Button className="ml-auto" disabled={jobs.every((j) => deliverable(j) === 0)} onClick={() => setCreating(jobs)}>
                      <Truck className="size-4" aria-hidden />
                      {t('delivery.create')}
                    </Button>
                  )}
                </header>
                <ul>
                  {jobs.map((j, i) => (
                    <li key={j.id} className={cn('flex flex-wrap items-center gap-3 px-5 py-2.5 text-sm', i && 'border-t border-border')}>
                      <JobLink jobId={j.id} title={`${j.job_no} · ${j.title}`} className="font-medium hover:text-brand">{j.job_no} {j.title}</JobLink>
                      <span className="tabular ml-auto text-xs text-muted">{t('delivery.delivered', { n: delivered(j).toLocaleString() })}</span>
                      {j.good_qty < Number(j.qty) && (
                        <span className="tabular text-xs text-status-paused">{t('delivery.goodOnly', { n: j.good_qty.toLocaleString(), q: Number(j.qty).toLocaleString() })}</span>
                      )}
                      <span className="tabular text-xs font-medium">{t('delivery.remaining', { n: deliverable(j).toLocaleString() })}</span>
                      {canClose && delivered(j) > 0 && (
                        <Button variant="ghost" size="sm" onClick={() => onCloseShort(j)} loading={closeShort.isPending && closeShort.variables?.p_job === j.id}>
                          {t('delivery.closeShort')}
                        </Button>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )
          })}
        </div>
      )}

      <h2 className="mb-2 mt-8 font-semibold">{t('delivery.history')}</h2>
      {(history.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t('delivery.historyEmpty')}</p>
      ) : (
        <ul className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface text-sm">
          {(history.data ?? []).map((d, i) => (
            <li key={d.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5', i && 'border-t border-border')}>
              <span className="font-medium">{d.doc_no}</span>
              <span className="text-muted">{d.order.doc_no} · {d.order.customer?.name}</span>
              <span className="text-xs text-muted">{formatDate(d.delivered_at)}{d.receiver_name ? ` · ${d.receiver_name}` : ''}</span>
              <Link to="/deliveries/$deliveryId" params={{ deliveryId: d.id }} className="ml-auto inline-flex items-center gap-1 text-xs text-brand hover:underline">
                <Printer className="size-3.5" aria-hidden />{t('delivery.print')}
              </Link>
            </li>
          ))}
        </ul>
      )}

      {creating && <CreateDrawer jobs={creating} onClose={() => setCreating(null)} />}
    </div>
  )
}

function CreateDrawer({ jobs, onClose }: { jobs: DeliverableJob[]; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const navigate = useNavigate()
  const create = useCreateDelivery()
  const [qty, setQty] = useState<Record<string, string>>(() => Object.fromEntries(jobs.map((j) => [j.id, String(deliverable(j))])))
  const [receiver, setReceiver] = useState('')
  const [date, setDate] = useState(localDate())
  const [note, setNote] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        p_sales_order: jobs[0].order.id,
        p_items: jobs.map((j) => ({ job_id: j.id, qty: Number(qty[j.id] || 0) })).filter((x) => x.qty > 0),
        p_receiver: receiver || null,
        p_note: note || null,
        p_delivered_at: new Date(`${date}T${new Date().toTimeString().slice(0, 8)}`).toISOString(),
      },
      {
        onSuccess: (id) => {
          toast({ tone: 'success', message: t('delivery.created') })
          navigate({ to: '/deliveries/$deliveryId', params: { deliveryId: id } })
        },
        onError: (er) => toast({ tone: 'error', message: errorMessage(er) }),
      },
    )
  }

  return (
    <Drawer open title={`${t('delivery.create')} · ${jobs[0].order.doc_no}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="dlv" loading={create.isPending}><Truck className="size-4" aria-hidden />{t('delivery.create')}</Button></>}>
      <form id="dlv" onSubmit={submit} className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {jobs.map((j) => (
            <li key={j.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
              <span className="min-w-0 flex-1 text-sm">
                <span className="block truncate font-medium">{j.job_no} {j.title}</span>
                <span className="text-xs text-muted">{t('delivery.remaining', { n: deliverable(j).toLocaleString() })}</span>
              </span>
              <Input type="number" min={0} max={deliverable(j)} aria-label={t('delivery.qty')} className="tabular h-9 w-28 text-right"
                value={qty[j.id]} onChange={(e) => setQty((q) => ({ ...q, [j.id]: e.target.value }))} />
            </li>
          ))}
        </ul>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('delivery.receiver')}>{(id) => <Input id={id} value={receiver} onChange={(e) => setReceiver(e.target.value)} />}</Field>
          <Field label={t('delivery.date')}>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} required />}</Field>
        </div>
        <Field label={t('delivery.note')}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </form>
    </Drawer>
  )
}

// Printable delivery note (FR-9.1/9.2): signature boxes for sender and receiver.
export function DeliveryNotePage({ deliveryId }: { deliveryId: string }) {
  const { t } = useTranslation()
  const delivery = useDelivery(deliveryId)
  const tenant = useTenant()
  if (delivery.isLoading) return <ListSkeleton />
  if (delivery.error) return <ErrorNote>{errorMessage(delivery.error)}</ErrorNote>
  const d = delivery.data!

  return (
    <div className="mx-auto max-w-3xl bg-white p-8 text-black print:p-0">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link to="/deliveries" className="text-sm text-muted hover:underline">← {t('delivery.title')}</Link>
        <Button onClick={() => window.print()}><Printer className="size-4" aria-hidden />{t('delivery.print')}</Button>
      </div>
      <header className="flex items-start justify-between border-b-2 border-black pb-3">
        <div>
          <p className="text-lg font-bold">{tenant.data?.name}</p>
          <h1 className="mt-1 text-2xl font-bold">{t('delivery.noteTitle')}</h1>
        </div>
        <div className="text-right text-sm">
          <p className="text-lg font-bold">{d.doc_no}</p>
          <p>{t('delivery.date')}: {formatDate(d.delivered_at)}</p>
          <p>{t('delivery.poRef')}: {d.order.customer_po_no} ({d.order.doc_no})</p>
        </div>
      </header>
      <section className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <p className="text-xs uppercase tracking-wide">{t('delivery.customer')}</p>
          <p className="font-semibold">{d.order.customer?.name}</p>
          {d.order.customer?.tax_id && <p>Tax ID {d.order.customer.tax_id}</p>}
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide">{t('delivery.address')}</p>
          <p className="whitespace-pre-line">{d.address ?? '—'}</p>
        </div>
      </section>
      <table className="mt-5 w-full border-collapse text-sm">
        <thead>
          <tr className="border-y border-black">
            <th className="w-10 py-2 text-left">#</th>
            <th className="py-2 text-left">{t('delivery.item')}</th>
            <th className="py-2 text-right">{t('plan.qty')}</th>
          </tr>
        </thead>
        <tbody>
          {d.items.map((it, i) => (
            <tr key={i} className="border-b border-black/30">
              <td className="py-2">{i + 1}</td>
              <td className="py-2">{it.job.title} <span className="text-xs">({it.job.job_no})</span></td>
              <td className="tabular py-2 text-right">{Number(it.qty).toLocaleString()} {it.job.uom}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {d.note && <p className="mt-3 text-sm">{t('delivery.note')}: {d.note}</p>}
      <div className="mt-16 grid grid-cols-2 gap-10 text-center text-sm">
        {[t('delivery.sender'), t('delivery.receiverSign')].map((label, i) => (
          <div key={label}>
            <div className="border-b border-black pb-1">{i === 1 && d.receiver_name ? d.receiver_name : ' '}</div>
            <p className="mt-1">{label}</p>
            <p className="mt-4">{t('delivery.signDate')} ____/____/______</p>
          </div>
        ))}
      </div>
    </div>
  )
}
