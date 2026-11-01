import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, ClipboardCheck, PackageOpen, Send } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { localDate } from '@/shared/locale'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Select, Textarea } from '@/shared/ui/input'
import { ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useProcesses } from '../masters/processes/api'
import { daysUntil, formatDate, formatMoney } from '../orders/format'
import { useBoard, type BoardStep } from '../production/api'
import { useVendorServices, useVendors } from '../settings/api'
import {
  useOutsourceOrders,
  useQcOutsource,
  useReceiveOutsource,
  useSendOutsource,
  useVendorPerformance,
  type OutsourceOrder,
} from './api'

// Outsource management (FR-7): to send → at vendor → back for QC, plus vendor track record.
export function OutsourcePage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const board = useBoard()
  const orders = useOutsourceOrders()
  const vendors = useVendors()
  const perf = useVendorPerformance()
  const processes = useProcesses()
  const canAct = hasRole('admin', 'manager', 'supervisor')
  const [sending, setSending] = useState<BoardStep | null>(null)
  const [receiving, setReceiving] = useState<OutsourceOrder | null>(null)
  const [checking, setChecking] = useState<OutsourceOrder | null>(null)

  const processName = useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p.name])), [processes.data])
  const vendorName = useMemo(() => new Map((vendors.data ?? []).map((v) => [v.id, v.name])), [vendors.data])

  if (orders.isLoading || board.isLoading) return <ListSkeleton />
  const err = orders.error ?? board.error
  if (err) return <ErrorNote>{errorMessage(err)}</ErrorNote>

  const toSend = (board.data?.steps ?? []).filter((s) => s.step_type === 'outsource' && s.status === 'ready' && s.job.status === 'in_production')
  const atVendor = (orders.data ?? []).filter((o) => o.status === 'sent')
  const toQc = (orders.data ?? []).filter((o) => o.status === 'received')
  const history = (orders.data ?? []).filter((o) => o.status === 'qc_passed' || o.status === 'rejected')

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('outsource.title')} subtitle={t('outsource.subtitle')} />

      <div className="grid gap-4 lg:grid-cols-3">
        <Lane title={t('outsource.toSend', { n: toSend.length })} Icon={Send}>
          {toSend.map((s) => (
            <Item key={s.id} title={processName.get(s.process_id) ?? '—'} job={s.job} sub={t('plan.pcs', { n: Number(s.planned_qty).toLocaleString() })}>
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

function SendDrawer({ step, onClose }: { step: BoardStep; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const vendors = useVendors()
  const services = useVendorServices()
  const send = useSendOutsource()
  const capable = (services.data ?? []).filter((s) => s.process_id === step.process_id)
  const [vendorId, setVendorId] = useState(capable[0]?.vendor_id ?? '')
  const lead = capable.find((s) => s.vendor_id === vendorId)?.lead_time_days ?? 1
  const defaultDate = () => localDate(Number(lead))
  const [expected, setExpected] = useState(defaultDate)
  const [qty, setQty] = useState(String(Number(step.planned_qty)))
  const [cost, setCost] = useState('')
  const [note, setNote] = useState('')
  // Vendors offering this process first; any vendor may still be chosen.
  const ordered = [...(vendors.data ?? [])].sort((a, b) => Number(capable.some((c) => c.vendor_id === b.id)) - Number(capable.some((c) => c.vendor_id === a.id)))

  function submit(e: FormEvent) {
    e.preventDefault()
    send.mutate(
      { p_step: step.id, p_vendor: vendorId, p_qty: Number(qty), p_expected_at: new Date(`${expected}T17:00:00`).toISOString(), p_cost: cost ? Number(cost) : null, p_note: note || null },
      {
        onSuccess: () => { toast({ tone: 'success', message: t('outsource.sent') }); onClose() },
        onError: (er) => toast({ tone: 'error', message: errorMessage(er) }),
      },
    )
  }

  return (
    <Drawer open title={`${t('outsource.send')} · ${step.job.job_no}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="os-send" loading={send.isPending} disabled={!vendorId}>{t('outsource.send')}</Button></>}>
      <form id="os-send" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <p className="col-span-2 text-sm text-muted">{step.job.title}</p>
        <Field label={t('outsource.vendor')} className="col-span-2" hint={vendorId ? t('outsource.leadHint', { n: lead }) : undefined}>
          {(id) => (
            <Select id={id} value={vendorId} required onChange={(e) => {
              const next = e.target.value
              setVendorId(next)
              const days = Number(capable.find((c) => c.vendor_id === next)?.lead_time_days ?? 1)
              setExpected(localDate(days))
            }}>
              <option value="" disabled>{t('outsource.pickVendor')}</option>
              {ordered.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('outsource.qtySent')}>{(id) => <Input id={id} type="number" min={1} className="tabular" value={qty} onChange={(e) => setQty(e.target.value)} required />}</Field>
        <Field label={t('outsource.expected')}>{(id) => <Input id={id} type="date" value={expected} onChange={(e) => setExpected(e.target.value)} required />}</Field>
        <Field label={t('outsource.cost')}>{(id) => <Input id={id} type="number" min={0} step="any" className="tabular" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        <Field label={t('outsource.note')} className="col-span-2">{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
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
