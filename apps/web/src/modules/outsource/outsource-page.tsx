import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ClipboardCheck, ListChecks, PackageOpen, Send } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { localDate } from '@/shared/locale'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Textarea } from '@/shared/ui/input'
import { ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useProcesses } from '../masters/processes/api'
import { daysUntil, formatDate, formatMoney } from '../orders/format'
import { useVendorServices, useVendors } from '../settings/api'
import {
  useOutsourceOrders,
  useOutsourcedSteps,
  useQcOutsource,
  useReceiveOutsource,
  useSendOutsource,
  useVendorPerformance,
  type OutsourceOrder,
  type OutsourcedStep,
} from './api'

type StateKey = 'planning' | 'awaitingApproval' | 'notReleased' | 'onHold' | 'waiting' | 'toSend' | 'atVendor' | 'late' | 'toQc' | 'done' | 'paused' | 'failed' | 'skipped'

const stateTone: Record<StateKey, string> = {
  planning: 'bg-surface-2 text-muted',
  awaitingApproval: 'bg-surface-2 text-muted',
  notReleased: 'bg-surface-2 text-muted',
  onHold: 'bg-status-paused/10 text-status-paused',
  waiting: 'bg-status-pending/10 text-status-pending',
  toSend: 'bg-status-ready/10 text-status-ready',
  atVendor: 'bg-status-progress/10 text-status-progress',
  late: 'bg-status-risk/10 text-status-risk',
  toQc: 'bg-status-paused/10 text-status-paused',
  done: 'bg-status-done/10 text-status-done',
  paused: 'bg-status-paused/10 text-status-paused',
  failed: 'bg-status-risk/10 text-status-risk',
  skipped: 'bg-surface-2 text-muted',
}

// Where an outsourced step stands, from the job first (not yet on the floor), then the step and its order.
function stepState(s: OutsourcedStep): { key: StateKey; order?: OutsourcedStep['orders'][number] } {
  const open = s.orders.find((o) => o.status === 'sent' || o.status === 'received')
  if (s.job.status === 'planning') return { key: 'planning' }
  if (s.job.status === 'approved' || (s.job.status === 'pending_approval' && !s.job.released_at)) {
    return { key: s.job.status === 'approved' ? 'notReleased' : 'awaitingApproval' }
  }
  if (s.job.status === 'on_hold') return { key: 'onHold', order: open }
  switch (s.status) {
    case 'pending': return { key: 'waiting' }
    case 'ready': return { key: 'toSend' }
    case 'in_progress':
      if (open?.status === 'received') return { key: 'toQc', order: open }
      return { key: open && new Date(open.expected_at).getTime() < Date.now() ? 'late' : 'atVendor', order: open }
    case 'done': return { key: 'done' }
    default: return { key: s.status }
  }
}

// Outsource management (FR-7): to send → at vendor → back for QC, plus vendor track record.
export function OutsourcePage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const steps = useOutsourcedSteps()
  const orders = useOutsourceOrders()
  const vendors = useVendors()
  const perf = useVendorPerformance()
  const processes = useProcesses()
  const canAct = hasRole('admin', 'manager', 'supervisor')
  const [sending, setSending] = useState<OutsourcedStep | null>(null)
  const [receiving, setReceiving] = useState<OutsourceOrder | null>(null)
  const [checking, setChecking] = useState<OutsourceOrder | null>(null)

  const processName = useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p.name])), [processes.data])
  const vendorName = useMemo(() => new Map((vendors.data ?? []).map((v) => [v.id, v.name])), [vendors.data])

  if (orders.isLoading || steps.isLoading) return <ListSkeleton />
  const err = orders.error ?? steps.error
  if (err) return <ErrorNote>{errorMessage(err)}</ErrorNote>

  const allSteps = steps.data ?? []
  const toSend = allSteps.filter((s) => s.status === 'ready' && s.job.status === 'in_production')
  const atVendor = (orders.data ?? []).filter((o) => o.status === 'sent')
  const toQc = (orders.data ?? []).filter((o) => o.status === 'received')
  const history = (orders.data ?? []).filter((o) => o.status === 'qc_passed' || o.status === 'rejected')

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('outsource.title')} subtitle={t('outsource.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Lane title={t('outsource.toSend', { n: toSend.length })} Icon={Send}>
          {toSend.map((s) => (
            <Item key={s.id} title={`${processName.get(s.process_id) ?? '—'} · ${(s.vendor_id && vendorName.get(s.vendor_id)) ?? '—'}`} job={s.job}
              sub={t('plan.pcs', { n: Number(s.planned_qty).toLocaleString() })}
              badge={s.outsource_note ? <p className="line-clamp-2 whitespace-pre-wrap text-xs text-muted">{s.outsource_note}</p> : undefined}>
              {canAct && <Button size="sm" onClick={() => setSending(s)}><Send className="size-3.5" aria-hidden />{t('outsource.send')}</Button>}
            </Item>
          ))}
        </Lane>

        <Lane title={t('outsource.atVendor', { n: atVendor.length })} Icon={PackageOpen}>
          {atVendor.map((o) => {
            const days = daysUntil(o.expected_at.slice(0, 10))
            const late = new Date(o.expected_at).getTime() < Date.now()
            return (
              <Item key={o.id} title={`${o.doc_no} · ${vendorName.get(o.vendor_id) ?? ''}`} job={o.step.job}
                sub={`${processName.get(o.step.process_id) ?? ''} · ${Number(o.qty_sent).toLocaleString()}`}
                badge={late
                  ? <span className="inline-flex items-center gap-1 text-xs font-medium text-status-risk"><AlertTriangle className="size-3.5" aria-hidden />{t('outsource.overdue', { n: Math.max(-days, 0) || 1 })}</span>
                  : <span className="text-xs text-muted">{t('outsource.dueIn', { d: formatDate(o.expected_at) })}</span>}>
                {canAct && <Button size="sm" variant="secondary" onClick={() => setReceiving(o)}>{t('outsource.receive')}</Button>}
              </Item>
            )
          })}
        </Lane>

        <Lane title={t('outsource.toQc', { n: toQc.length })} Icon={ClipboardCheck}>
          {toQc.map((o) => (
            <Item key={o.id} title={`${o.doc_no} · ${vendorName.get(o.vendor_id) ?? ''}`} job={o.step.job}
              sub={`${t('outsource.qtyReceived')} ${Number(o.qty_received ?? 0).toLocaleString()}`}>
              {canAct && <Button size="sm" onClick={() => setChecking(o)}><ClipboardCheck className="size-3.5" aria-hidden />{t('outsource.qc')}</Button>}
            </Item>
          ))}
        </Lane>
      </div>

      <section className="mt-6 rounded-[var(--radius-card)] border border-border bg-surface">
        <h2 className="flex items-center gap-1.5 border-b border-border px-5 py-3 font-semibold">
          <ListChecks className="size-4 text-muted" aria-hidden />
          {t('outsource.steps', { n: allSteps.length })}
        </h2>
        {allSteps.length === 0 ? (
          <p className="px-5 py-6 text-center text-sm text-muted">{t('outsource.stepsEmpty')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">{t('outsource.job')}</th>
                  <th className="px-4 py-2 font-medium">{t('outsource.step')}</th>
                  <th className="px-4 py-2 font-medium">{t('outsource.vendor')}</th>
                  <th className="px-4 py-2 font-medium">{t('outsource.detail')}</th>
                  <th className="px-4 py-2 text-right font-medium">{t('plan.stepQty')}</th>
                  <th className="px-4 py-2 font-medium">{t('outsource.stepStatus')}</th>
                </tr>
              </thead>
              <tbody>
                {allSteps.map((s) => {
                  const st = stepState(s)
                  return (
                    <tr key={s.id} className="border-t border-border align-top">
                      <td className="px-4 py-2">
                        <Link to="/jobs/$jobId" params={{ jobId: s.job.id }} className="font-medium hover:text-brand">{s.job.job_no}</Link>
                        <div className="max-w-48 truncate text-xs text-muted">{s.job.title}</div>
                      </td>
                      <td className="px-4 py-2">{t('templates.level', { n: s.seq })} · {processName.get(s.process_id) ?? '—'}</td>
                      <td className="px-4 py-2">{(s.vendor_id && vendorName.get(s.vendor_id)) ?? '—'}</td>
                      <td className="max-w-64 whitespace-pre-wrap px-4 py-2 text-xs text-muted">{s.outsource_note ?? '—'}</td>
                      <td className="tabular px-4 py-2 text-right">{Number(s.planned_qty).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        <span className={cn('inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', stateTone[st.key])}>
                          {t(`outsource.state.${st.key}`)}
                        </span>
                        {st.order && (
                          <div className="mt-0.5 whitespace-nowrap text-xs text-muted">{st.order.doc_no} · {t('outsource.dueIn', { d: formatDate(st.order.expected_at) })}</div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-[var(--radius-card)] border border-border bg-surface">
        <h2 className="border-b border-border px-5 py-3 font-semibold">{t('outsource.vendors')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2 font-medium">{t('outsource.vendor')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('outsource.openOrders')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('outsource.lateNow')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('outsource.onTime')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('outsource.rejectRate')}</th>
                <th className="px-4 py-2 text-right font-medium">{t('outsource.cost90')}</th>
              </tr>
            </thead>
            <tbody>
              {(perf.data ?? []).map((v) => (
                <tr key={v.vendor_id} className="border-t border-border">
                  <td className="px-4 py-2 font-medium">{v.name}</td>
                  <td className="tabular px-4 py-2 text-right">{v.orders_open}</td>
                  <td className={cn('tabular px-4 py-2 text-right', v.orders_late_now > 0 && 'font-semibold text-status-risk')}>{v.orders_late_now}</td>
                  <td className="tabular px-4 py-2 text-right">{v.on_time_pct == null ? '—' : `${v.on_time_pct}%`}</td>
                  <td className="tabular px-4 py-2 text-right">{v.reject_pct == null ? '—' : `${v.reject_pct}%`}</td>
                  <td className="tabular px-4 py-2 text-right">{v.cost_90d == null ? '—' : formatMoney(Number(v.cost_90d))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {history.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 font-semibold">{t('outsource.history')}</h2>
          <ul className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface text-sm">
            {history.map((o, i) => (
              <li key={o.id} className={cn('flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2', i && 'border-t border-border')}>
                <span className="font-medium">{o.doc_no}</span>
                <span className="text-muted">{vendorName.get(o.vendor_id)} · {o.step.job.job_no} {o.step.job.title}</span>
                <span className={cn('ml-auto rounded-full px-2 py-0.5 text-xs', o.status === 'qc_passed' ? 'bg-status-done/10 text-status-done' : 'bg-status-risk/10 text-status-risk')}>
                  {t(`outsource.status.${o.status}`)}
                </span>
                {o.qc_note && <span className="w-full text-xs text-muted">{o.qc_note}</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {sending && <SendDrawer step={sending} onClose={() => setSending(null)} />}
      {receiving && <ReceiveDrawer order={receiving} onClose={() => setReceiving(null)} />}
      {checking && <QcDrawer order={checking} onClose={() => setChecking(null)} />}
    </div>
  )
}

function Lane({ title, Icon, children }: { title: string; Icon: typeof Send; children: ReactNode[] }) {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-2 rounded-[var(--radius-card)] border border-border bg-surface-2/50 p-3">
      <h2 className="flex items-center gap-1.5 px-1 font-semibold"><Icon className="size-4 text-muted" aria-hidden />{title}</h2>
      {children.length === 0 ? <p className="px-1 py-6 text-center text-sm text-muted">{t('outsource.none')}</p> : children}
    </section>
  )
}

function Item({ title, job, sub, badge, children }: { title: string; job: { id: string; job_no: string; title: string }; sub: string; badge?: ReactNode; children?: ReactNode }) {
  return (
    <article className="rounded-lg border border-border bg-surface p-3 text-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate font-semibold">{title}</div>
          <Link to="/jobs/$jobId" params={{ jobId: job.id }} className="block truncate text-xs text-muted hover:text-brand">{job.job_no} · {job.title}</Link>
          <div className="tabular text-xs text-muted">{sub}</div>
        </div>
        {children}
      </div>
      {badge && <div className="mt-1.5">{badge}</div>}
    </article>
  )
}

// Vendor and brief were set on the plan; here only what goes out and when it comes back.
function SendDrawer({ step, onClose }: { step: OutsourcedStep; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const vendors = useVendors()
  const services = useVendorServices()
  const send = useSendOutsource()
  const vendor = (vendors.data ?? []).find((v) => v.id === step.vendor_id)
  const lead = Number((services.data ?? []).find((s) => s.vendor_id === step.vendor_id && s.process_id === step.process_id)?.lead_time_days ?? 1)
  const [expected, setExpected] = useState(() => localDate(lead))
  const [qty, setQty] = useState(String(Number(step.planned_qty)))
  const [cost, setCost] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    send.mutate(
      { p_step: step.id, p_qty: Number(qty), p_expected_at: new Date(`${expected}T17:00:00`).toISOString(), p_cost: cost ? Number(cost) : null, p_note: null },
      {
        onSuccess: () => { toast({ tone: 'success', message: t('outsource.sent') }); onClose() },
        onError: (er) => toast({ tone: 'error', message: errorMessage(er) }),
      },
    )
  }

  return (
    <Drawer open title={`${t('outsource.send')} · ${step.job.job_no}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="os-send" loading={send.isPending} disabled={!vendor}>{t('outsource.send')}</Button></>}>
      <form id="os-send" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <p className="col-span-2 text-sm text-muted">{step.job.title}</p>
        <div className="col-span-2 rounded-lg border border-border bg-surface-2/50 p-3 text-sm">
          <div className="text-xs text-muted">{t('outsource.vendor')}</div>
          <div className="font-medium">{vendor?.name ?? t('outsource.vendorMissing')}</div>
          {step.outsource_note && (
            <>
              <div className="mt-2 text-xs text-muted">{t('outsource.detail')}</div>
              <p className="whitespace-pre-wrap">{step.outsource_note}</p>
            </>
          )}
          <p className="mt-2 text-xs text-muted">{t('outsource.fromPlan')}</p>
        </div>
        <Field label={t('outsource.qtySent')}>{(id) => <Input id={id} type="number" min={1} className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} required />}</Field>
        <Field label={t('outsource.expected')} hint={t('outsource.leadHint', { n: lead })}>{(id) => <Input id={id} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} required />}</Field>
        <Field label={t('outsource.cost')}>{(id) => <Input id={id} type="number" min={0} step="any" className="tabular" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
      </form>
    </Drawer>
  )
}

function ReceiveDrawer({ order, onClose }: { order: OutsourceOrder; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const receive = useReceiveOutsource()
  const [qty, setQty] = useState(String(Number(order.qty_sent)))
  const [cost, setCost] = useState(order.cost == null ? '' : String(order.cost))
  return (
    <Drawer open title={`${t('outsource.receive')} · ${order.doc_no}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="os-recv" loading={receive.isPending}>{t('outsource.receive')}</Button></>}>
      <form id="os-recv" className="grid grid-cols-2 gap-4" onSubmit={(e) => {
        e.preventDefault()
        receive.mutate({ p_order: order.id, p_qty: Number(qty), p_cost: cost ? Number(cost) : null }, {
          onSuccess: () => { toast({ tone: 'success', message: t('outsource.received') }); onClose() },
          onError: (er) => toast({ tone: 'error', message: errorMessage(er) }),
        })
      }}>
        <Field label={t('outsource.qtyReceived')}>{(id) => <Input id={id} type="number" min={0} className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} required autoFocus />}</Field>
        <Field label={t('outsource.cost')}>{(id) => <Input id={id} type="number" min={0} step="any" className="tabular" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
      </form>
    </Drawer>
  )
}

function QcDrawer({ order, onClose }: { order: OutsourceOrder; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const qc = useQcOutsource()
  const [passed, setPassed] = useState(true)
  const [rejected, setRejected] = useState('0')
  const [note, setNote] = useState('')
  return (
    <Drawer open title={`${t('outsource.qc')} · ${order.doc_no}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="os-qc" loading={qc.isPending} variant={passed ? 'primary' : 'danger'}>{passed ? t('outsource.pass') : t('outsource.reject')}</Button></>}>
      <form id="os-qc" className="flex flex-col gap-4" onSubmit={(e) => {
        e.preventDefault()
        qc.mutate({ p_order: order.id, p_passed: passed, p_rejected: Number(rejected || 0), p_note: note || null }, {
          onSuccess: (r) => { toast({ tone: 'success', message: r.job_done ? t('floor.jobDone') : t('outsource.qcDone') }); onClose() },
          onError: (er) => toast({ tone: 'error', message: errorMessage(er) }),
        })
      }}>
        <p className="text-sm text-muted">{t('outsource.qtyReceived')}: <b className="tabular text-fg">{Number(order.qty_received ?? 0).toLocaleString()}</b></p>
        <div className="grid grid-cols-2 gap-2">
          {[true, false].map((v) => (
            <button key={String(v)} type="button" onClick={() => setPassed(v)}
              className={cn('rounded-xl border px-3 py-3 text-sm font-medium', passed === v ? (v ? 'border-status-done bg-status-done/10 text-status-done' : 'border-status-risk bg-status-risk/10 text-status-risk') : 'border-border')}>
              {v ? t('outsource.pass') : t('outsource.reject')}
            </button>
          ))}
        </div>
        {passed && (
          <Field label={t('outsource.rejectedQty')}>{(id) => <Input id={id} type="number" min={0} className="tabular" value={rejected} onChange={(e) => setRejected(e.target.value)} />}</Field>
        )}
        <Field label={t('outsource.qcNote')}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} required={!passed} />}</Field>
      </form>
    </Drawer>
  )
}
