import { useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import { appLocale } from '@/shared/locale'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { ArrowRight, CheckCircle2, FileText, Hand, OctagonAlert, Pause, Play, Power, X } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useMachineProcesses, useMachines } from '../masters/machines/api'
import { useProcesses } from '../masters/processes/api'
import { formatDate } from '../orders/format'
import { JobImages } from './job-images'
import { StepNote } from './step-note'
import { useMembers } from '../settings/api'
import {
  formatMinutes,
  runMinutes,
  useBoard,
  useCompleteStep,
  useEndDowntime,
  useFloorSpec,
  useOpenDowntimes,
  usePauseStep,
  useStartDowntime,
  useStartStep,
  type BoardStep,
  type DowntimeReason,
} from './api'

const MANUAL = 'manual'
const STORE_KEY = 'uniflow.floor.machine'
const reasons: DowntimeReason[] = ['breakdown', 'no_material', 'no_operator', 'changeover', 'planned_maintenance', 'waiting_approval', 'other']
const durations = [15, 30, 60, 120, 240, null] as const

function readStored() {
  try {
    return localStorage.getItem(STORE_KEY)
  } catch {
    return null
  }
}

// Ticks every 30 s so running timers stay current without refetching.
function useNow() {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  return now
}

// Mobile-first screen for operators (design §8.0: big targets, ≤ 2 taps per action).
export function FloorPage({ focusStepId }: { focusStepId?: string }) {
  const { t } = useTranslation()
  const { hasRole, session } = useAuth()
  const members = useMembers()
  const toast = useToast()
  const board = useBoard()
  const machines = useMachines()
  const processes = useProcesses()
  const links = useMachineProcesses()
  const downtimes = useOpenDowntimes()
  const start = useStartStep()
  const pause = usePauseStep()
  const endDown = useEndDowntime()
  const now = useNow()
  const canAct = hasRole('admin', 'manager', 'supervisor', 'staff')

  const steps = useMemo(() => board.data?.steps ?? [], [board.data])
  const focus = focusStepId ? steps.find((s) => s.id === focusStepId) : undefined
  const [machine, setMachine] = useState<string | null>(() => readStored())
  const [completing, setCompleting] = useState<BoardStep | null>(null)
  const [reporting, setReporting] = useState(false)
  const [viewing, setViewing] = useState<BoardStep | null>(null)

  // A scanned job ticket opens the machine of that step.
  useEffect(() => {
    if (focus) setMachine(focus.machine_id ?? MANUAL)
  }, [focus])

  useEffect(() => {
    try {
      if (machine) localStorage.setItem(STORE_KEY, machine)
    } catch {
      // storage unavailable — the choice still applies for this visit
    }
  }, [machine])

  const machineName = useMemo(() => new Map((machines.data ?? []).map((m) => [m.id, m.name])), [machines.data])
  const processName = useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p.name])), [processes.data])
  const hasMachine = useMemo(() => new Set((links.data ?? []).map((l) => l.process_id)), [links.data])
  // Staff assigned to machines see just those; supervisors and up see every machine.
  const myMachines = members.data?.find((m) => m.user_id === session?.user.id)?.machine_ids ?? []
  const onlyMine = !hasRole('admin', 'manager', 'supervisor') && myMachines.length > 0
  const activeMachines = (machines.data ?? []).filter((m) => m.status !== 'inactive' && (!onlyMine || myMachines.includes(m.id)))

  const mine = steps
    .filter((s) =>
      machine === MANUAL ? !s.machine_id && s.step_type !== 'outsource' && !hasMachine.has(s.process_id) : s.machine_id === machine,
    )
    .sort((a, b) => (a.planned_start ?? '').localeCompare(b.planned_start ?? ''))
  const current = mine.find((s) => s.status === 'in_progress') ?? mine.find((s) => s.status === 'paused')
  const queue = mine.filter((s) => s !== current)
  const down = machine && machine !== MANUAL ? downtimes.data?.find((d) => d.machine_id === machine) : undefined

  const onError = (e: unknown) => toast({ tone: 'error', message: errorMessage(e) })
  // A tap anywhere on a card opens its spec, except on the card's own buttons and links.
  const openSpec = (s: BoardStep) => (e: MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return
    setViewing(s)
  }

  if (board.isLoading || machines.isLoading) return <ListSkeleton />
  const err = board.error ?? machines.error
  if (err) return <ErrorNote>{errorMessage(err)}</ErrorNote>

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 pb-24">
      <header>
        <h1 className="text-2xl font-semibold">{t('floor.title')}</h1>
        <p className="text-muted">{t('floor.subtitle')}</p>
      </header>

      <nav className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label={t('floor.pickMachine')}>
        {[...activeMachines.map((m) => ({ id: m.id, name: m.name })), { id: MANUAL, name: t('floor.noMachine') }].map((m) => {
          const isDown = downtimes.data?.some((d) => d.machine_id === m.id)
          return (
            <button
              key={m.id}
              onClick={() => setMachine(m.id)}
              className={cn(
                'flex shrink-0 items-center gap-1.5 rounded-full border px-4 py-2.5 text-base font-medium',
                machine === m.id ? 'border-brand bg-brand text-brand-fg' : 'border-border bg-surface',
              )}
            >
              {isDown && <OctagonAlert className="size-4 text-status-risk" aria-label="down" />}
              {m.name}
            </button>
          )
        })}
      </nav>

      {!machine ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-lg text-muted">{t('floor.pickMachine')}</p>
      ) : (
        <>
          {down && (
            <section className="flex flex-col gap-3 rounded-2xl border-2 border-status-risk bg-status-risk/10 p-4">
              <p className="flex items-center gap-2 text-lg font-semibold text-status-risk">
                <OctagonAlert className="size-6" aria-hidden />
                {t('floor.machineDown', {
                  reason: t(`downtime.${down.reason}`),
                  at: new Date(down.started_at).toLocaleTimeString(appLocale(), { hour: '2-digit', minute: '2-digit' }),
                })}
              </p>
              {down.note && <p className="text-status-risk">{down.note}</p>}
              {canAct && (
                <Button size="lg" className="h-14 text-lg" loading={endDown.isPending}
                  onClick={() => endDown.mutate({ p_machine: machine }, { onError })}>
                  <Power className="size-5" aria-hidden />
                  {t('floor.backUp')}
                </Button>
              )}
            </section>
          )}

          {current && (
            <section onClick={openSpec(current)} className={cn('cursor-pointer rounded-2xl border-2 p-4', current.status === 'in_progress' ? 'border-status-progress bg-status-progress/5' : 'border-status-paused bg-status-paused/5')}>
              <p className={cn('mb-2 text-sm font-semibold uppercase tracking-wide', current.status === 'in_progress' ? 'text-status-progress' : 'text-status-paused')}>
                {current.status === 'in_progress' ? t('floor.running') : t('floor.paused')}
              </p>
              <StepSummary step={current} processName={processName.get(current.process_id)} big onSpec={() => setViewing(current)} />
              <p className="tabular mt-3 text-lg">
                {t('floor.elapsed', { t: formatMinutes(t, runMinutes(current, now)) })}
                {current.est_minutes != null && <span className="text-muted"> / {t('floor.est', { t: formatMinutes(t, Number(current.est_minutes)) })}</span>}
              </p>
              {canAct && (
                <div className="mt-4 grid grid-cols-2 gap-3">
                  {current.status === 'in_progress' ? (
                    <Button variant="secondary" size="lg" className="h-16 text-lg" loading={pause.isPending}
                      onClick={() => pause.mutate({ p_step: current.id }, { onError })}>
                      <Pause className="size-6" aria-hidden />
                      {t('floor.pause')}
                    </Button>
                  ) : (
                    <Button variant="secondary" size="lg" className="h-16 text-lg" loading={start.isPending} disabled={!!down}
                      onClick={() => start.mutate({ p_step: current.id }, { onError })}>
                      <Play className="size-6" aria-hidden />
                      {t('floor.resume')}
                    </Button>
                  )}
                  <Button size="lg" className="h-16 text-lg" onClick={() => setCompleting(current)}>
                    <CheckCircle2 className="size-6" aria-hidden />
                    {t('floor.complete')}
                  </Button>
                </div>
              )}
            </section>
          )}

          <section>
            <h2 className="mb-2 font-semibold text-muted">{t('floor.next')}</h2>
            {queue.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-muted">{t('floor.nothing')}</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {queue.map((s) => {
                  const blocked = s.status === 'pending' || !!current || !!down
                  return (
                    <li key={s.id} onClick={openSpec(s)} className={cn('cursor-pointer rounded-2xl border bg-surface p-4', s.id === focusStepId ? 'border-brand ring-2 ring-brand/40' : 'border-border')}>
                      <StepSummary step={s} processName={processName.get(s.process_id)} onSpec={() => setViewing(s)} />
                      {canAct && (
                        <Button size="lg" className="mt-3 h-14 w-full text-lg" disabled={blocked} loading={start.isPending && start.variables?.p_step === s.id}
                          onClick={() => start.mutate({ p_step: s.id }, { onError })}>
                          {s.status === 'pending' ? (
                            <><Hand className="size-5" aria-hidden />{t('floor.waiting')}</>
                          ) : current ? (
                            t('floor.busy')
                          ) : (
                            <><Play className="size-5" aria-hidden />{s.status === 'paused' ? t('floor.resume') : t('floor.start')}</>
                          )}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </section>

          {canAct && machine !== MANUAL && !down && (
            <Button variant="danger" size="lg" className="h-14 text-lg" onClick={() => setReporting(true)}>
              <OctagonAlert className="size-5" aria-hidden />
              {t('floor.reportDown')}
            </Button>
          )}
        </>
      )}

      {viewing && (
        <SpecSheet step={viewing} processName={processName.get(viewing.process_id)}
          machineName={viewing.machine_id ? machineName.get(viewing.machine_id) : undefined} onClose={() => setViewing(null)} />
      )}
      {completing && <CompleteSheet step={completing} onClose={() => setCompleting(null)} />}
      {reporting && machine && machine !== MANUAL && <DowntimeSheet machineId={machine} onClose={() => setReporting(false)} />}
    </div>
  )
}

function StepSummary({ step, processName, big, onSpec }: { step: BoardStep; processName?: string; big?: boolean; onSpec: () => void }) {
  const { t } = useTranslation()
  return (
    <div>
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link to="/jobs/$jobId" params={{ jobId: step.job_id }} className="font-semibold hover:text-brand">{step.job.job_no}</Link>
        <span>· {t('board.stage', { n: step.seq })}</span>
        {step.job.due_date && <span className="ml-auto">{t('board.due', { d: new Date(step.job.due_date).toLocaleDateString(appLocale(), { day: 'numeric', month: 'short' }) })}</span>}
      </div>
      <div className="flex items-start gap-2">
        <p className={cn('min-w-0 flex-1 font-semibold', big ? 'text-2xl' : 'text-xl')}>{processName}</p>
        <button type="button" onClick={onSpec}
          className="flex shrink-0 items-center gap-1 rounded-full border border-border px-3 py-1.5 text-sm text-muted hover:bg-surface-2">
          <FileText className="size-4" aria-hidden />{t('floor.spec.open')}
        </button>
      </div>
      <p className={cn('text-muted', big && 'text-lg')}>{step.job.title}</p>
      <p className="tabular mt-1 text-lg font-medium">{t('floor.planned', { q: t('plan.pcs', { n: Number(step.planned_qty).toLocaleString() }) })}</p>
    </div>
  )
}

// Bottom sheet with big numeric inputs (numpad on phones).
function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center sm:items-center">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden />
      <section role="dialog" aria-modal="true" aria-label={title} className="relative max-h-[90dvh] w-full max-w-xl overflow-y-auto rounded-t-3xl bg-surface p-5 shadow-2xl sm:rounded-3xl">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-xl font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-full p-2 text-muted hover:bg-surface-2" aria-label="close"><X className="size-6" /></button>
        </header>
        {children}
      </section>
    </div>
  )
}

function CompleteSheet({ step, onClose }: { step: BoardStep; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const complete = useCompleteStep()
  const [good, setGood] = useState(String(Number(step.planned_qty)))
  const [waste, setWaste] = useState('0')
  const [reason, setReason] = useState('')

  function submit() {
    complete.mutate(
      { p_step: step.id, p_good: Number(good || 0), p_waste: Number(waste || 0), p_reason: reason || null },
      {
        onSuccess: (r) => {
          toast({ tone: 'success', message: r.job_done ? t('floor.jobDone') : t('floor.completed') })
          if (r.waste_over && r.waste_pct != null) toast({ tone: 'error', message: t('floor.wasteOver', { p: r.waste_pct }) })
          else if (r.short_by > 0) toast({ tone: 'error', message: t('floor.short', { n: Number(r.short_by).toLocaleString() }) })
          onClose()
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  const field = 'tabular h-16 w-full rounded-xl border border-border bg-surface px-4 text-right text-3xl font-semibold focus:outline-none focus:ring-2 focus:ring-brand/40'
  return (
    <Sheet title={t('floor.complete')} onClose={onClose}>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-status-done">{t('floor.goodQty')}</span>
          <input className={field} type="number" inputMode="numeric" min={0} value={good} onChange={(e) => setGood(e.target.value)} autoFocus />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium text-status-risk">{t('floor.wasteQty')}</span>
          <input className={field} type="number" inputMode="numeric" min={0} value={waste} onChange={(e) => setWaste(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-sm text-muted">{t('floor.reason')}</span>
        <input className="h-12 rounded-xl border border-border bg-surface px-4 text-base" value={reason} onChange={(e) => setReason(e.target.value)} />
      </label>
      <Button size="lg" className="mt-4 h-16 w-full text-lg" loading={complete.isPending} onClick={submit} disabled={good === ''}>
        <CheckCircle2 className="size-6" aria-hidden />
        {t('floor.confirmComplete')}
      </Button>
    </Sheet>
  )
}

function DowntimeSheet({ machineId, onClose }: { machineId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const startDown = useStartDowntime()
  const [reason, setReason] = useState<DowntimeReason | null>(null)
  const [minutes, setMinutes] = useState<number | null>(60)

  function submit() {
    if (!reason) return
    startDown.mutate(
      { p_machine: machineId, p_reason: reason, p_expected_minutes: minutes },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: t('floor.downReported') })
          onClose()
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  const chip = (on: boolean) =>
    cn('min-h-12 rounded-xl border px-3 py-2 text-base font-medium', on ? 'border-status-risk bg-status-risk/10 text-status-risk' : 'border-border bg-surface')
  return (
    <Sheet title={t('floor.downTitle')} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {reasons.map((r) => (
          <button key={r} className={chip(reason === r)} onClick={() => setReason(r)}>{t(`downtime.${r}`)}</button>
        ))}
      </div>
      <p className="mb-2 mt-4 text-sm font-medium">{t('floor.expected')}</p>
      <div className="grid grid-cols-3 gap-2">
        {durations.map((d) => (
          <button key={String(d)} className={chip(minutes === d)} onClick={() => setMinutes(d)}>
            {d === null ? t('floor.unknown') : d < 60 ? t('floor.minutes', { n: d }) : t('floor.hours', { n: d / 60 })}
          </button>
        ))}
      </div>
      <Button variant="danger" size="lg" className="mt-4 h-16 w-full text-lg" disabled={!reason} loading={startDown.isPending} onClick={submit}>
        <OctagonAlert className="size-6" aria-hidden />
        {t('floor.reportDown')}
      </Button>
    </Sheet>
  )
}

function SpecRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2">
      <dt className="shrink-0 text-muted">{label}</dt>
      <dd className="tabular min-w-0 text-right font-medium">{children}</dd>
    </div>
  )
}

// What to make, read-only, for the operator at the machine. No prices (Staff cannot read them).
function SpecSheet({ step, processName, machineName, onClose }: { step: BoardStep; processName?: string; machineName?: string; onClose: () => void }) {
  const { t } = useTranslation()
  const spec = useFloorSpec(step.id, step.job_id)
  const { hasRole } = useAuth()
  const canNote = hasRole('admin', 'manager', 'supervisor', 'staff')
  const info = spec.data?.step
  const specKeys = ['size', 'paper', 'colors', 'finishing'] as const

  return (
    <Sheet title={`${step.job.job_no} · ${t('board.stage', { n: step.seq })}`} onClose={onClose}>
      <div className="flex flex-col gap-5 text-base">
        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('floor.spec.lines')}</h3>
          {spec.isLoading ? <ListSkeleton rows={2} /> : spec.error ? <ErrorNote>{errorMessage(spec.error)}</ErrorNote> : spec.data!.lines.length === 0 ? (
            <p className="text-muted">{t('floor.spec.noLines')}</p>
          ) : (
            <ol className="flex flex-col gap-3">
              {spec.data!.lines.map((l, i) => {
                const it = l.item
                const filled = specKeys.filter((k) => it?.spec?.[k])
                return (
                  <li key={it?.id ?? i} className="rounded-xl border border-border bg-surface-2/50 p-3">
                    <div className="flex items-baseline gap-2">
                      <span className="tabular shrink-0 text-sm text-muted">#{it?.line_no ?? i + 1}</span>
                      <p className="min-w-0 flex-1 font-semibold">{it?.description ?? '—'}</p>
                      <span className="tabular shrink-0 font-semibold">{Number(l.qty).toLocaleString()} {it?.uom}</span>
                    </div>
                    {filled.length > 0 && (
                      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                        {filled.map((k) => (
                          <div key={k} className="contents">
                            <dt className="text-muted">{t(`orders.${k}`)}</dt>
                            <dd>{it!.spec![k]}</dd>
                          </div>
                        ))}
                      </dl>
                    )}
                    {it?.note && <p className="mt-2 rounded-lg bg-surface px-3 py-2 text-sm">{it.note}</p>}
                  </li>
                )
              })}
            </ol>
          )}
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('floor.spec.step')}</h3>
          <dl className="divide-y divide-border">
            <SpecRow label={t('floor.spec.process')}>{processName ?? '—'}</SpecRow>
            <SpecRow label={t('board.detail.machine')}>{step.machine_id ? machineName ?? '—' : t('board.manual')}</SpecRow>
            <SpecRow label={t('floor.spec.inQty')}>{t('plan.pcs', { n: Number(step.planned_qty).toLocaleString() })}</SpecRow>
            {info && <SpecRow label={t('floor.spec.nUp')}>{Number(info.n_up)}</SpecRow>}
            {info && <SpecRow label={t('board.detail.passes')}>{Number(info.passes)}</SpecRow>}
            <SpecRow label={t('board.detail.estimate')}>{step.est_minutes != null ? formatMinutes(t, Number(step.est_minutes)) : '—'}</SpecRow>
          </dl>
          {info?.is_rework && (
            <p className="mt-2 rounded-lg bg-status-paused/10 px-3 py-2 text-sm text-status-paused">
              {t('plan.rework')}{info.rework_reason ? `: ${info.rework_reason}` : ''}
            </p>
          )}
          {info && <StepNote stepId={step.id} note={info.note} canEdit={canNote} big className="mt-2" />}
        </section>

        <section>
          <h3 className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted">{t('jobImages.title')}</h3>
          <JobImages jobId={step.job_id} open={step.job.status !== 'completed' && step.job.status !== 'cancelled'} big />
        </section>

        <section>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted">{t('board.detail.job')}</h3>
          <dl className="divide-y divide-border">
            <SpecRow label={t('board.detail.title')}>{step.job.title}</SpecRow>
            <SpecRow label={t('board.detail.customer')}>{step.job.order?.customer?.name ?? '—'}</SpecRow>
            <SpecRow label={t('board.detail.due')}>
              <span className={cn(step.job.is_at_risk && 'text-status-risk')}>{formatDate(step.job.due_date)}</span>
            </SpecRow>
          </dl>
        </section>

        <Link to="/jobs/$jobId" params={{ jobId: step.job_id }}
          className="inline-flex h-14 items-center justify-center gap-2 rounded-xl border border-border text-lg font-medium hover:bg-surface-2">
          {t('board.detail.openJob')}<ArrowRight className="size-5" aria-hidden />
        </Link>
      </div>
    </Sheet>
  )
}
