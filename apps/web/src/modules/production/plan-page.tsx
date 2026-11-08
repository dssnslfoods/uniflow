import { useCallback, useEffect, useMemo, useState, type ButtonHTMLAttributes, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { JobLink } from './job-link'
import { AlertTriangle, ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Clock, GitFork, Lock, Pencil, Play, Plus, Send, Trash2, Truck, X } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Select, Textarea } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useMachineProcesses, useMachines, type Machine } from '../masters/machines/api'
import { useProcesses, type Process } from '../masters/processes/api'
import { stepTypeStyle } from '../masters/processes/step-type'
import { useTemplates } from '../masters/templates/api'
import { useOrder } from '../orders/api'
import { formatDate } from '../orders/format'
import { SoStatusPill } from '../orders/so-status'
import { useVendors } from '../settings/api'
import {
  formatMinutes,
  useApprovals,
  useCancelJob,
  useCoverage,
  useCreateJob,
  useOrderJobs,
  useSaveJob,
  useEditWorkflow,
  useSubmitPlan,
  type Approval,
  type Coverage,
  type Job,
  type JobLine,
  type JobStep,
} from './api'
import { JobImages } from './job-images'
import { StepNote } from './step-note'
import { JobStatusPill } from './job-status'
import { useRelease } from './use-release'
import { JobMaterialsEditor } from '../inventory/job-materials'

const fmtQty = (n: number) => Number(n).toLocaleString()

// Client-side mirror of app.estimate_step_minutes for live feedback; the DB recomputes on save.
function estimate(step: Row, machine: Machine | undefined, process: Process | undefined) {
  if (!machine || !process) return null
  const units = Math.ceil(step.planned_qty / Math.max(step.n_up, 1)) * Math.max(step.passes, 1)
  const run = units * (1 + process.default_running_waste_pct / 100) + machine.makeready_waste_units
  return machine.setup_min + (run / ((machine.max_cap_per_hour * machine.efficiency_pct) / 100)) * 60
}

type Row = JobStep & { key: string; parallel: boolean }
const newKey = () => Math.random().toString(36).slice(2)

function toRows(steps: JobStep[]): Row[] {
  return steps.map((s, i) => ({ ...s, key: newKey(), parallel: i > 0 && s.seq === steps[i - 1].seq }))
}

function withSeq(rows: Row[]): Row[] {
  let seq = 0
  return rows.map((r, i) => ({ ...r, seq: i === 0 || !r.parallel ? ++seq : seq, parallel: i > 0 && r.parallel }))
}

export function PlanPage({ orderId }: { orderId: string }) {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const order = useOrder(orderId)
  const coverage = useCoverage(orderId)
  const jobs = useOrderJobs(orderId)
  const jobIds = useMemo(() => (jobs.data ?? []).map((j) => j.id), [jobs.data])
  const approvals = useApprovals(jobIds)
  const submit = useSubmitPlan()
  const release = useRelease()
  const [creating, setCreating] = useState(false)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const canPlan = hasRole('admin', 'manager', 'supervisor')

  const markDirty = useCallback((id: string, isDirty: boolean) => {
    setDirty((d) => {
      if (d.has(id) === isDirty) return d
      const next = new Set(d)
      if (isDirty) next.add(id)
      else next.delete(id)
      return next
    })
  }, [])

  if (order.isLoading || coverage.isLoading || jobs.isLoading) return <ListSkeleton />
  const err = order.error ?? coverage.error ?? jobs.error
  if (err) return <ErrorNote>{errorMessage(err)}</ErrorNote>

  const so = order.data!
  const lines = coverage.data ?? []
  const live = (jobs.data ?? []).filter((j) => j.status !== 'cancelled')
  const planning = live.filter((j) => j.status === 'planning')
  const covered = lines.length > 0 && lines.every((l) => Number(l.remaining_qty) === 0)
  const approved = live.filter((j) => j.status === 'approved')

  const onRelease = release.run

  // The plan's own state, next to the PO's, so "PO confirmed" is not read as "plan approved".
  const pendingJobs = live.filter((j) => j.status === 'pending_approval').length
  const planState = pendingJobs
    ? { key: 'pending', n: pendingJobs, cls: 'bg-status-paused/10 text-status-paused', Icon: Clock }
    : planning.length
      ? { key: 'planning', n: planning.length, cls: 'bg-status-pending/10 text-status-pending', Icon: Pencil }
      : approved.length
        ? { key: 'approved', n: approved.length, cls: 'bg-status-done/10 text-status-done', Icon: CheckCircle2 }
        : null

  const blocker = !planning.length
    ? t('plan.blockNothing')
    : !covered
      ? t('plan.blockCoverage')
      : planning.some((j) => j.steps.length === 0)
        ? t('plan.blockSteps')
        : dirty.size
          ? t('plan.blockUnsaved')
          : null

  function onSubmit() {
    submit.mutate(
      { p_sales_order: orderId },
      {
        onSuccess: (n) => toast({ tone: 'success', message: t('plan.submitted', { n }) }),
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <div className="mx-auto max-w-[1400px] pb-20">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Link to="/orders/$orderId" params={{ orderId }} className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t('common.back')}>
          <ArrowLeft className="size-5" />
        </Link>
        <div>
          <h1 className="text-xl font-semibold">{t('plan.title')} · {so.doc_no}</h1>
          <p className="text-sm text-muted">PO {so.customer_po_no} · {t('orders.dueDate')} {formatDate(so.due_date)}</p>
        </div>
        <SoStatusPill status={so.status} prefix="PO" />
        {planState && (
          <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', planState.cls)}>
            <planState.Icon className="size-3.5" aria-hidden />
            {t(`plan.state.${planState.key}`, { n: planState.n })}
          </span>
        )}
        {canPlan && approved.length > 0 && (
          <Button className="ml-auto" onClick={() => onRelease(approved.map((j) => j.id))} loading={release.isPending}>
            <Play className="size-4" aria-hidden />
            {t('board.release')} ({approved.length})
          </Button>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <LinesPanel lines={lines} covered={covered} />

        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold">{t('plan.jobs')} <span className="text-muted">({live.length})</span></h2>
            {canPlan && (
              <Button onClick={() => setCreating(true)}>
                <Plus className="size-4" aria-hidden />
                {t('plan.newJob')}
              </Button>
            )}
          </div>

          {live.length === 0 ? (
            <EmptyState Icon={Plus} title={t('plan.noJobs')} hint={t('plan.noJobsHint')} actionLabel={canPlan ? t('plan.newJob') : undefined} onAction={() => setCreating(true)} />
          ) : (
            live.map((job) => (
              <JobCard
                key={`${job.id}-${job.status}-${job.workflow_version}`}
                job={job}
                lines={lines}
                approvals={(approvals.data ?? []).filter((a) => a.entity_id === job.id)}
                canPlan={canPlan}
                onDirty={markDirty}
              />
            ))
          )}
        </div>
      </div>

      {canPlan && planning.length > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface/95 backdrop-blur md:left-60">
          <div className="mx-auto flex max-w-[1400px] items-center justify-end gap-3 px-4 py-3 md:px-8">
            {blocker && (
              <span className="flex items-center gap-1.5 text-sm text-status-paused">
                <AlertTriangle className="size-4" aria-hidden />
                {blocker}
              </span>
            )}
            <Button size="lg" onClick={onSubmit} disabled={!!blocker} loading={submit.isPending}>
              <Send className="size-4" aria-hidden />
              {t('plan.submit')}
            </Button>
          </div>
        </div>
      )}

      {creating && <NewJobDrawer orderId={orderId} lines={lines} onClose={() => setCreating(false)} />}
    </div>
  )
}

function LinesPanel({ lines, covered }: { lines: Coverage[]; covered: boolean }) {
  const { t } = useTranslation()
  return (
    <aside className="flex flex-col gap-2 self-start rounded-[var(--radius-card)] border border-border bg-surface p-4 lg:sticky lg:top-6">
      <h2 className="font-semibold">{t('plan.lines')}</h2>
      {covered && (
        <p className="flex items-center gap-1.5 text-sm text-status-done">
          <CheckCircle2 className="size-4" aria-hidden />
          {t('plan.complete')}
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {lines.map((l) => {
          const pct = Math.min(100, (Number(l.matched_qty) / Number(l.qty)) * 100)
          const rem = Number(l.remaining_qty)
          return (
            <li key={l.sales_order_item_id}>
              <div className="flex items-baseline justify-between gap-2 text-sm">
                <span className="min-w-0 truncate"><span className="text-muted">{l.line_no}.</span> {l.description}</span>
                <span className={cn('tabular shrink-0 text-xs', rem === 0 ? 'text-status-done' : rem < 0 ? 'text-status-risk' : 'text-status-paused')}>
                  {rem === 0 ? <CheckCircle2 className="inline size-3.5" aria-label="ok" /> : rem > 0 ? t('plan.remaining', { n: fmtQty(rem) }) : t('plan.over', { n: fmtQty(-rem) })}
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                <div className={cn('h-full rounded-full transition-[width]', rem < 0 ? 'bg-status-risk' : rem === 0 ? 'bg-status-done' : 'bg-status-ready')} style={{ width: `${pct}%` }} />
              </div>
              <div className="tabular mt-0.5 text-[11px] text-muted">{t('plan.matched', { m: fmtQty(l.matched_qty), q: fmtQty(l.qty) })}</div>
            </li>
          )
        })}
      </ol>
    </aside>
  )
}

function NewJobDrawer({ orderId, lines, onClose }: { orderId: string; lines: Coverage[]; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const templates = useTemplates()
  const create = useCreateJob()
  const open = lines.filter((l) => Number(l.remaining_qty) > 0)
  const [title, setTitle] = useState(open.length === 1 ? open[0].description : '')
  const [templateId, setTemplateId] = useState('')
  const [picked, setPicked] = useState<Record<string, number>>(() =>
    open.length === 1 ? { [open[0].sales_order_item_id]: Number(open[0].remaining_qty) } : {},
  )

  function toggle(l: Coverage, on: boolean) {
    setPicked((p) => {
      const next = { ...p }
      if (on) next[l.sales_order_item_id] = Number(l.remaining_qty)
      else delete next[l.sales_order_item_id]
      return next
    })
    if (on && !title) setTitle(l.description)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate(
      {
        orderId,
        title: title.trim(),
        templateId: templateId || null,
        lines: Object.entries(picked).map(([sales_order_item_id, qty]) => ({ sales_order_item_id, qty })),
      },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: t('common.saved') })
          onClose()
        },
      },
    )
  }

  return (
    <Drawer
      open
      title={t('plan.newJob')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="new-job" loading={create.isPending} disabled={!title.trim() || Object.keys(picked).length === 0}>
            {t('plan.newJob')}
          </Button>
        </>
      }
    >
      <form id="new-job" onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('plan.jobTitle')}>
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} required autoFocus />}
        </Field>
        <Field label={t('plan.template')}>
          {(id) => (
            <Select id={id} value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              <option value="">{t('plan.noTemplate')}</option>
              {(templates.data ?? []).filter((x) => x.is_active).map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </Select>
          )}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">{t('plan.pickLines')}</legend>
          {lines.map((l) => {
            const on = l.sales_order_item_id in picked
            const rem = Number(l.remaining_qty)
            return (
              <label key={l.sales_order_item_id} className={cn('flex items-center gap-3 rounded-lg border px-3 py-2', on ? 'border-brand bg-brand/5' : 'border-border', rem <= 0 && !on && 'opacity-50')}>
                <input type="checkbox" checked={on} disabled={rem <= 0 && !on} onChange={(e) => toggle(l, e.target.checked)} className="accent-[var(--brand)]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{l.line_no}. {l.description}</span>
                  <span className="text-xs text-muted">{t('plan.remaining', { n: fmtQty(rem) })}</span>
                </span>
                {on && (
                  <Input
                    type="number" min={1} step="any" aria-label={t('plan.qty')} className="tabular h-8 w-28 text-right"
                    value={picked[l.sales_order_item_id] || ''}
                    onChange={(e) => setPicked((p) => ({ ...p, [l.sales_order_item_id]: Number(e.target.value || 0) }))}
                  />
                )}
              </label>
            )
          })}
        </fieldset>
        {create.error && <ErrorNote>{errorMessage(create.error)}</ErrorNote>}
      </form>
    </Drawer>
  )
}

type CardProps = {
  job: Job
  lines: Coverage[]
  approvals: Approval[]
  canPlan: boolean
  onDirty: (id: string, dirty: boolean) => void
}

function JobCard({ job, lines, approvals, canPlan, onDirty }: CardProps) {
  const { t } = useTranslation()
  const toast = useToast()
  const processes = useProcesses()
  const machines = useMachines()
  const links = useMachineProcesses()
  const vendors = useVendors()
  const save = useSaveJob()
  const cancel = useCancelJob()

  const editWorkflow = useEditWorkflow()
  const editable = canPlan && job.status === 'planning'
  // Approved / released / on-hold jobs: the flow can change, then goes back for approval (FR-4.7).
  const reflowable = canPlan && (job.status === 'approved' || job.status === 'in_production' || job.status === 'on_hold')
  const [flowEdit, setFlowEdit] = useState(false)
  const stepsEditable = editable || flowEdit
  const canNote = canPlan && job.status !== 'completed' && job.status !== 'cancelled'
  const isLocked = (r: Row) => !!r.status && r.status !== 'pending' && r.status !== 'ready'
  const [title, setTitle] = useState(job.title)
  const [jobLines, setJobLines] = useState<JobLine[]>(job.lines.map((l) => ({ ...l, qty: Number(l.qty) })))
  const [rows, setRows] = useState<Row[]>(() => toRows(job.steps))
  const [dirty, setDirtyLocal] = useState(false)

  useEffect(() => onDirty(job.id, dirty), [dirty, job.id, onDirty])
  useEffect(() => () => onDirty(job.id, false), [job.id, onDirty])

  const touch = () => setDirtyLocal(true)
  const processById = useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p])), [processes.data])
  const machineById = useMemo(() => new Map((machines.data ?? []).map((m) => [m.id, m])), [machines.data])
  const vendorName = useMemo(() => new Map((vendors.data ?? []).map((v) => [v.id, v.name])), [vendors.data])
  const lineById = useMemo(() => new Map(lines.map((l) => [l.sales_order_item_id, l])), [lines])
  const machinesFor = (processId: string) => {
    const ids = new Set((links.data ?? []).filter((l) => l.process_id === processId).map((l) => l.machine_id))
    return (machines.data ?? []).filter((m) => ids.has(m.id) && m.status === 'active')
  }

  const jobQty = jobLines.reduce((s, l) => s + l.qty, 0)
  const seqRows = withSeq(rows)
  const estimates = seqRows.map((r) => estimate(r, r.machine_id ? machineById.get(r.machine_id) : undefined, processById.get(r.process_id)))
  const totalMinutes = estimates.reduce<number>((s, m) => s + (m ?? 0), 0)
  // Paper for the first sheet-fed step: passes re-use the same sheet, so they don't add paper.
  const sheetHint = useMemo(() => {
    const r = seqRows.find((x) => x.step_type === 'internal' && processById.get(x.process_id)?.capacity_unit === 'sheet')
    if (!r) return null
    const p = processById.get(r.process_id)!
    const m = r.machine_id ? machineById.get(r.machine_id) : undefined
    return { sheets: Math.ceil(Math.ceil(r.planned_qty / Math.max(r.n_up, 1)) * (1 + p.default_running_waste_pct / 100) + (m?.makeready_waste_units ?? 0)) }
  }, [seqRows, processById, machineById])

  const lastDecision = approvals.find((a) => a.action !== 'submit')
  const sentBack = (job.status === 'planning' || job.status === 'on_hold') && lastDecision && (lastDecision.action === 'reject' || lastDecision.action === 'request_change')

  const update = (i: number, patch: Partial<Row>) => {
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
    touch()
  }
  const move = (i: number, dir: -1 | 1) => {
    setRows((rs) => {
      const next = [...rs]
      ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
      return next
    })
    touch()
  }

  function addStep(p: Process) {
    const options = machinesFor(p.id)
    setRows((rs) => [
      ...rs,
      {
        key: newKey(), seq: 0, parallel: false, process_id: p.id, step_type: p.step_type,
        machine_id: options.length === 1 ? options[0].id : null,
        planned_qty: jobQty || Number(job.qty), n_up: 1, passes: 1, est_minutes: null, note: null,
        outsourced: false, vendor_id: null, outsource_note: null,
      },
    ])
    touch()
  }

  const missingVendor = rows.some((r) => r.outsourced && !r.vendor_id)

  // Ticking "send outside" drops the machine; unticking puts back the process's own type.
  function setOutsourced(i: number, on: boolean) {
    const r = rows[i]
    const options = machinesFor(r.process_id)
    update(i, on
      ? { outsourced: true, step_type: 'outsource', machine_id: null }
      : { outsourced: false, step_type: processById.get(r.process_id)?.step_type ?? 'internal', vendor_id: null, outsource_note: null,
          machine_id: options.length === 1 ? options[0].id : null })
  }

  function onSave() {
    if (missingVendor) {
      toast({ tone: 'error', message: t('plan.vendorRequired') })
      return
    }
    save.mutate(
      { job, title: title.trim(), lines: jobLines, steps: withSeq(rows) },
      {
        onSuccess: () => {
          setDirtyLocal(false)
          toast({ tone: 'success', message: t('common.saved') })
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  function submitFlow() {
    if (missingVendor) {
      toast({ tone: 'error', message: t('plan.vendorRequired') })
      return
    }
    const reason = window.prompt(t('plan.reflowReason'))
    if (reason === null) return
    editWorkflow.mutate(
      {
        p_job: job.id,
        p_reason: reason || null,
        p_steps: withSeq(rows).map((r) => ({
          ...(r.id ? { id: r.id } : {}),
          seq: r.seq, process_id: r.process_id, machine_id: r.machine_id,
          planned_qty: r.planned_qty, n_up: r.n_up, passes: r.passes, note: r.note,
          outsourced: r.outsourced, vendor_id: r.outsourced ? r.vendor_id : null, outsource_note: r.outsourced ? r.outsource_note : null,
        })),
      },
      {
        onSuccess: () => {
          setFlowEdit(false)
          setDirtyLocal(false)
          toast({ tone: 'success', message: t('plan.reflowSubmitted') })
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  function onCancel() {
    const reason = window.prompt(t('plan.cancelReason'))
    if (!reason) return
    cancel.mutate({ p_job: job.id, p_reason: reason }, { onError: (e) => toast({ tone: 'error', message: errorMessage(e) }) })
  }

  const unmatched = lines.filter((l) => !jobLines.some((x) => x.sales_order_item_id === l.sales_order_item_id))

  return (
    <article className={cn('rounded-[var(--radius-card)] border bg-surface', dirty ? 'border-brand/60' : 'border-border')}>
      <header className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3">
        <JobLink jobId={job.id} title={`${job.job_no} · ${job.title}`} className="text-xs font-medium text-muted hover:text-brand">{job.job_no}</JobLink>
        {editable ? (
          <Input aria-label={t('plan.jobTitle')} value={title} onChange={(e) => { setTitle(e.target.value); touch() }} className="h-8 max-w-sm flex-1 font-semibold" />
        ) : (
          <h3 className="font-semibold">{job.title}</h3>
        )}
        <JobStatusPill status={job.status} />
        <span className="tabular ml-auto text-sm text-muted">{t('plan.pcs', { n: fmtQty(jobQty || job.qty) })}</span>
        {!editable && job.status === 'pending_approval' && <Lock className="size-4 text-muted" aria-label={t('plan.locked')} />}
        {reflowable && !flowEdit && (
          <Button variant="ghost" size="sm" onClick={() => setFlowEdit(true)}>
            <Pencil className="size-3.5" aria-hidden />
            {t('plan.editFlow')}
          </Button>
        )}
      </header>

      {sentBack && (
        <p className="flex items-start gap-2 border-b border-border bg-status-risk/5 px-5 py-2.5 text-sm text-status-risk">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span><b>{t('plan.sentBack')}:</b> {lastDecision.comment}</span>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
        {jobLines.map((l) => {
          const line = lineById.get(l.sales_order_item_id)
          return (
            <span key={l.sales_order_item_id} className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 py-1 pl-3 pr-1 text-sm">
              <span className="max-w-48 truncate">{line?.line_no}. {line?.description}</span>
              {editable ? (
                <>
                  <input
                    type="number" min={1} step="any" aria-label={t('plan.qty')}
                    className="tabular h-6 w-20 rounded-full border border-border bg-surface px-2 text-right text-xs"
                    value={l.qty || ''}
                    onChange={(e) => { setJobLines((ls) => ls.map((x) => (x === l ? { ...x, qty: Number(e.target.value || 0) } : x))); touch() }}
                  />
                  <button type="button" aria-label={t('common.delete')} className="rounded-full p-0.5 text-muted hover:text-status-risk"
                    onClick={() => { setJobLines((ls) => ls.filter((x) => x !== l)); touch() }}>
                    <X className="size-3.5" />
                  </button>
                </>
              ) : (
                <span className="tabular pr-2 text-xs text-muted">× {fmtQty(l.qty)}</span>
              )}
            </span>
          )
        })}
        {editable && unmatched.length > 0 && (
          <Select
            aria-label={t('plan.addLine')}
            className="h-8 w-auto text-xs"
            value=""
            onChange={(e) => {
              const l = lineById.get(e.target.value)
              if (!l) return
              setJobLines((ls) => [...ls, { sales_order_item_id: l.sales_order_item_id, qty: Math.max(Number(l.remaining_qty), 0) || 1 }])
              touch()
            }}
          >
            <option value="">+ {t('plan.addLine')}</option>
            {unmatched.map((l) => <option key={l.sales_order_item_id} value={l.sales_order_item_id}>{l.line_no}. {l.description}</option>)}
          </Select>
        )}
      </div>

      <div className="px-5 py-4">
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-[13px] font-medium">{t('plan.flow')}</h4>
          {totalMinutes > 0 && <span className="tabular text-xs text-muted">{t('plan.totalTime', { t: formatMinutes(t, totalMinutes) })}</span>}
        </div>
        <ol className="flex flex-col gap-2">
          {seqRows.map((r, i) => {
            const p = processById.get(r.process_id)
            const style = stepTypeStyle[r.step_type]
            const options = r.outsourced ? [] : machinesFor(r.process_id)
            const canOutsource = p?.step_type !== 'delivery'
            const needsMachine = r.step_type === 'internal' && options.length > 0 && !r.machine_id
            const rowEditable = stepsEditable && !isLocked(r)
            return (
              <li key={r.key} className={cn('flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border px-3 py-2', r.parallel && 'ml-6 border-dashed', flowEdit && isLocked(r) && 'bg-surface-2/60')}>
                <span className="tabular w-14 shrink-0 text-xs font-medium text-muted">
                  {r.parallel ? <GitFork className="inline size-3.5" aria-label={t('templates.parallel')} /> : t('templates.level', { n: r.seq })}
                </span>
                <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', style.cls)}>
                  <style.Icon className="size-4" aria-hidden />
                </span>
                <span className="min-w-28 flex-1 font-medium">
                  {p?.name ?? '—'}
                  {r.is_rework && <span className="ml-1.5 rounded bg-status-paused/10 px-1.5 text-[10px] text-status-paused">{t('plan.rework')}</span>}
                  {flowEdit && isLocked(r) && <Lock className="ml-1.5 inline size-3.5 text-muted" aria-label={t('plan.lockedStep')} />}
                </span>

                {options.length > 0 && (
                  rowEditable ? (
                    <Select aria-label={t('plan.machine')} className={cn('h-8 w-44 text-xs', needsMachine && 'border-status-paused')}
                      value={r.machine_id ?? ''} onChange={(e) => update(i, { machine_id: e.target.value || null })}>
                      <option value="">{t('plan.noMachine')}</option>
                      {options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select>
                  ) : (
                    <span className="text-xs text-muted">{r.machine_id ? machineById.get(r.machine_id)?.name : t('plan.noMachine')}</span>
                  )
                )}

                {(r.step_type === 'internal' || r.outsourced) && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <NumBox label={t('plan.stepQty')} value={r.planned_qty} disabled={!rowEditable} width="w-20" onChange={(v) => update(i, { planned_qty: v })} />
                    {!r.outsourced && (
                      <>
                        <NumBox label={t('plan.nUp')} value={r.n_up} disabled={!rowEditable} width="w-12" onChange={(v) => update(i, { n_up: Math.max(1, Math.round(v)) })} />
                        <NumBox label={t('plan.passes')} value={r.passes} disabled={!rowEditable} width="w-12" onChange={(v) => update(i, { passes: Math.max(1, Math.round(v)) })} />
                      </>
                    )}
                  </div>
                )}

                <span className="tabular w-24 text-right text-xs text-muted" title={t('plan.estTime')}>
                  {formatMinutes(t, estimates[i])}
                </span>

                {rowEditable && (
                  <div className="flex items-center gap-0.5">
                    {i > 0 && (
                      <label className="mr-1 flex cursor-pointer items-center gap-1 text-[11px] text-muted" title={t('templates.parallel')}>
                        <input type="checkbox" checked={r.parallel} onChange={(e) => update(i, { parallel: e.target.checked })} className="accent-[var(--brand)]" />
                        <GitFork className="size-3.5" aria-hidden />
                      </label>
                    )}
                    <IconBtn label="up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></IconBtn>
                    <IconBtn label="down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></IconBtn>
                    <IconBtn label={t('common.delete')} onClick={() => { setRows((rs) => rs.filter((_, j) => j !== i)); touch() }}><Trash2 className="size-4" /></IconBtn>
                  </div>
                )}

                {canOutsource && (rowEditable || r.outsourced) && (
                  <OutsourceBox
                    row={r}
                    editable={rowEditable}
                    vendors={vendors.data ?? []}
                    vendorName={r.vendor_id ? vendorName.get(r.vendor_id) : undefined}
                    onToggle={(on) => setOutsourced(i, on)}
                    onChange={(patch) => update(i, patch)}
                  />
                )}

                {r.id && (
                  <StepNote stepId={r.id} note={r.note} canEdit={canNote} className="basis-full pl-[4.25rem]"
                    onSaved={(note) => setRows((rs) => rs.map((x) => (x.key === r.key ? { ...x, note } : x)))} />
                )}
              </li>
            )
          })}
        </ol>

        {stepsEditable && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {(processes.data ?? []).map((p) => {
              const style = stepTypeStyle[p.step_type]
              return (
                <button key={p.id} type="button" onClick={() => addStep(p)}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-0.5 text-xs hover:border-brand hover:text-brand">
                  <Plus className="size-3" aria-hidden />
                  <style.Icon className="size-3 text-muted" aria-hidden />
                  {p.name}
                </button>
              )
            })}
          </div>
        )}
      </div>

      <div className="border-t border-border px-5 py-4">
        <h4 className="mb-2 text-[13px] font-medium">{t('jobImages.title')}</h4>
        <JobImages jobId={job.id} open={canNote} />
      </div>

      <JobMaterialsEditor jobId={job.id} editable={canPlan && job.status !== 'completed'} sheetHint={sheetHint} />

      {flowEdit && (
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-status-paused/5 px-5 py-3">
          <span className="text-xs text-status-paused">{t('plan.reflowHint')}</span>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setRows(toRows(job.steps)); setFlowEdit(false); setDirtyLocal(false) }}>
              {t('common.cancel')}
            </Button>
            <Button size="sm" onClick={submitFlow} loading={editWorkflow.isPending} disabled={!dirty || rows.length === 0 || missingVendor}>
              <Send className="size-3.5" aria-hidden />
              {t('plan.reflowSubmit')}
            </Button>
          </div>
        </footer>
      )}

      {editable && (
        <footer className="flex items-center justify-between gap-2 border-t border-border px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onCancel}>{t('plan.cancelJob')}</Button>
          <div className="flex items-center gap-3">
            {dirty && <span className="text-xs text-brand">{t('plan.unsaved')}</span>}
            {missingVendor && <span className="text-xs text-status-paused">{t('plan.vendorRequired')}</span>}
            <Button size="sm" onClick={onSave} loading={save.isPending} disabled={!dirty || !title.trim() || missingVendor}>
              {t('plan.saveJob')}
            </Button>
          </div>
        </footer>
      )}
    </article>
  )
}

// "Send outside" lives only here: tick the step, pick the vendor, write what they should do.
function OutsourceBox({ row, editable, vendors, vendorName, onToggle, onChange }: {
  row: Row
  editable: boolean
  vendors: { id: string; name: string }[]
  vendorName: string | undefined
  onToggle: (on: boolean) => void
  onChange: (patch: Partial<Row>) => void
}) {
  const { t } = useTranslation()
  if (!editable) {
    return (
      <div className="basis-full pl-[4.25rem] text-xs">
        <span className="inline-flex items-center gap-1 rounded-full bg-status-paused/10 px-2 py-0.5 font-medium text-status-paused">
          <Truck className="size-3.5" aria-hidden />
          {t('plan.outsourcedTo', { vendor: vendorName ?? '—' })}
        </span>
        {row.outsource_note && <p className="mt-1 whitespace-pre-wrap text-muted">{row.outsource_note}</p>}
      </div>
    )
  }
  return (
    <div className={cn('basis-full pl-[4.25rem]', row.outsourced && 'flex flex-col gap-2')}>
      <label className="inline-flex cursor-pointer items-center gap-2 text-xs">
        <input type="checkbox" className="accent-[var(--brand)]" checked={row.outsourced} onChange={(e) => onToggle(e.target.checked)} />
        <Truck className="size-3.5 text-muted" aria-hidden />
        {t('plan.outsource')}
      </label>
      {row.outsourced && (
        <div className="grid gap-2 rounded-lg border border-status-paused/30 bg-status-paused/5 p-2.5 sm:grid-cols-[14rem_minmax(0,1fr)]">
          <Field label={t('plan.vendor')}>
            {(id) => (
              <Select id={id} className={cn('h-8 text-xs', !row.vendor_id && 'border-status-paused')} value={row.vendor_id ?? ''} required
                onChange={(e) => onChange({ vendor_id: e.target.value || null })}>
                <option value="" disabled>{t('outsource.pickVendor')}</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label={t('plan.outsourceNote')}>
            {(id) => (
              <Textarea id={id} rows={2} maxLength={2000} className="text-xs" placeholder={t('plan.outsourceNoteHint')}
                value={row.outsource_note ?? ''} onChange={(e) => onChange({ outsource_note: e.target.value || null })} />
            )}
          </Field>
          {vendors.length === 0 && <p className="text-xs text-status-paused sm:col-span-2">{t('plan.noVendors')}</p>}
        </div>
      )}
    </div>
  )
}

function NumBox({ label, value, disabled, width, onChange }: { label: string; value: number; disabled: boolean; width: string; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col">
      <span className="text-[10px] text-muted">{label}</span>
      <input
        type="number" min={1} step="any" disabled={disabled}
        className={cn('tabular h-7 rounded-md border border-border bg-surface px-1.5 text-right text-xs disabled:border-transparent disabled:bg-transparent', width)}
        value={value || ''}
        onChange={(e) => onChange(Number(e.target.value || 0))}
      />
    </label>
  )
}

function IconBtn({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30" {...props}>
      {children}
    </button>
  )
}
