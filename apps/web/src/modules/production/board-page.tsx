import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { appLocale, localDate } from '@/shared/locale'
import { useTranslation } from 'react-i18next'
import { JobLink } from './job-link'
import {
  closestCorners,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { AlertTriangle, ArrowLeftRight, CalendarClock, Inbox, KanbanSquare, Play, RefreshCw, Search, Users, Wrench } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useMachineProcesses, useMachines, type Machine } from '../masters/machines/api'
import { useProcesses } from '../masters/processes/api'
import { stepTypeStyle } from '../masters/processes/step-type'
import { formatDate } from '../orders/format'
import { Timeline } from './timeline'
import { StepDrawer } from './step-drawer'
import {
  formatMinutes,
  useBoard,
  useMachineLoad,
  useMoveStep,
  useOpenDowntimes,
  useReschedule,
  useSuggestMachines,
  type BoardStep,
  type LoadRow,
} from './api'
import { useRelease } from './use-release'

// Column ids: 'unscheduled' | 'outsource' | 'manual' | 'm:<machine id>' (design §8.1)
type ColumnId = string
const machineCol = (id: string) => `m:${id}`
const machineOf = (col: ColumnId) => (col.startsWith('m:') ? col.slice(2) : null)

// Stable colour per job so its cards can be followed across machines.
function jobHue(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) % 360
  return h
}

function loadTone(pct: number) {
  return pct > 100 ? 'bg-status-risk' : pct >= 80 ? 'bg-status-paused' : 'bg-status-done'
}

export function BoardPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const board = useBoard()
  const load = useMachineLoad(7)
  const machines = useMachines()
  const processes = useProcesses()
  const links = useMachineProcesses()
  const move = useMoveStep()
  const release = useRelease()
  const reschedule = useReschedule()
  const canMove = hasRole('admin', 'manager', 'supervisor')
  const [openStep, setOpenStep] = useState<string | null>(null)

  // The schedule is relative to "now": refresh it once when the board opens.
  const refreshed = useRef(false)
  useEffect(() => {
    if (!refreshed.current) {
      refreshed.current = true
      reschedule.mutate()
    }
  }, [reschedule])

  const steps = useMemo(() => board.data?.steps ?? [], [board.data])
  const byId = useMemo(() => new Map(steps.map((s) => [s.id, s])), [steps])
  const processName = useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p.name])), [processes.data])
  const machineName = useMemo(() => new Map((machines.data ?? []).map((m) => [m.id, m.name])), [machines.data])
  const opened = openStep ? byId.get(openStep) : undefined
  const capable = useMemo(() => {
    const m = new Map<string, Set<string>>()
    ;(links.data ?? []).forEach((l) => m.set(l.process_id, (m.get(l.process_id) ?? new Set()).add(l.machine_id)))
    return m
  }, [links.data])

  const visibleMachines = useMemo(
    () => (machines.data ?? []).filter((m) => m.status !== 'inactive' || steps.some((s) => s.machine_id === m.id)),
    [machines.data, steps],
  )

  // Server order → columns; replaced locally while dragging (optimistic).
  const serverColumns = useMemo(() => {
    const columnOf = (s: BoardStep): ColumnId =>
      s.machine_id ? machineCol(s.machine_id)
        : s.step_type === 'outsource' ? 'outsource'
          : capable.get(s.process_id)?.size ? 'unscheduled' : 'manual'
    const cols: Record<ColumnId, string[]> = { unscheduled: [], outsource: [], manual: [] }
    visibleMachines.forEach((m) => (cols[machineCol(m.id)] = []))
    steps.forEach((s) => (cols[columnOf(s)] ??= []).push(s.id))
    return cols
  }, [steps, visibleMachines, capable])

  const [columns, setColumns] = useState(serverColumns)
  const [activeId, setActiveId] = useState<string | null>(null)
  const dragOrigin = useRef<ColumnId | null>(null)
  useEffect(() => {
    if (!activeId && !move.isPending) setColumns(serverColumns)
  }, [serverColumns, activeId, move.isPending])

  const downtimes = useOpenDowntimes()
  const [view, setView] = useState<'board' | 'timeline'>(() => {
    try {
      return localStorage.getItem('uniflow.board.view') === 'timeline' ? 'timeline' : 'board'
    } catch {
      return 'board'
    }
  })
  const pickView = (v: 'board' | 'timeline') => {
    setView(v)
    try {
      localStorage.setItem('uniflow.board.view', v)
    } catch {
      // storage unavailable — the choice applies for this visit only
    }
  }
  const [query, setQuery] = useState('')
  const [onlyRisk, setOnlyRisk] = useState(false)
  const [focusJob, setFocusJob] = useState<string | null>(null)

  const matches = (s: BoardStep) => {
    if (focusJob && s.job_id !== focusJob) return false
    if (onlyRisk && !s.job.is_at_risk) return false
    const q = query.trim().toLowerCase()
    return !q || `${s.job.job_no} ${s.job.title} ${s.job.order?.doc_no ?? ''} ${s.job.order?.customer_po_no ?? ''} ${s.job.order?.customer?.name ?? ''}`.toLowerCase().includes(q)
  }

  const loadBy = useMemo(() => {
    const today = localDate()
    const m = new Map<string, { today: number; week: number; weekAvail: number; weekPlanned: number }>()
    ;(load.data ?? []).forEach((r: LoadRow) => {
      const cur = m.get(r.machine_id) ?? { today: 0, week: 0, weekAvail: 0, weekPlanned: 0 }
      cur.weekAvail += Number(r.available_min)
      cur.weekPlanned += Number(r.planned_min)
      if (r.day === today) cur.today = r.available_min > 0 ? (Number(r.planned_min) / Number(r.available_min)) * 100 : 0
      cur.week = cur.weekAvail > 0 ? (cur.weekPlanned / cur.weekAvail) * 100 : 0
      m.set(r.machine_id, cur)
    })
    return m
  }, [load.data])

  const active = activeId ? byId.get(activeId) ?? null : null

  // Where may the dragged card go? Capable, active machines — or back to "unscheduled".
  const canDropOn = (col: ColumnId, s: BoardStep | null) => {
    if (!s) return false
    if (col === 'unscheduled') return !!capable.get(s.process_id)?.size
    const mid = machineOf(col)
    if (!mid) return false
    const m = machines.data?.find((x) => x.id === mid)
    return !!m && m.status === 'active' && !!capable.get(s.process_id)?.has(mid)
  }

  const findColumn = (id: string): ColumnId | undefined =>
    id in columns ? id : Object.keys(columns).find((c) => columns[c].includes(id))

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  function onDragStart(e: DragStartEvent) {
    setActiveId(String(e.active.id))
    dragOrigin.current = findColumn(String(e.active.id)) ?? null
  }

  function onDragOver(e: DragOverEvent) {
    const id = String(e.active.id)
    const overId = e.over ? String(e.over.id) : null
    if (!overId) return
    const from = findColumn(id)
    const to = findColumn(overId)
    if (!from || !to || from === to || !canDropOn(to, byId.get(id) ?? null)) return
    setColumns((cols) => {
      const target = cols[to].filter((x) => x !== id)
      const idx = overId in cols ? target.length : Math.max(target.indexOf(overId), 0)
      target.splice(idx, 0, id)
      return { ...cols, [from]: cols[from].filter((x) => x !== id), [to]: target }
    })
  }

  function onDragEnd(e: DragEndEvent) {
    const id = String(e.active.id)
    const step = byId.get(id)
    const overId = e.over ? String(e.over.id) : null
    setActiveId(null)
    const origin = dragOrigin.current
    dragOrigin.current = null
    if (!step || !overId) return setColumns(serverColumns)

    const to = findColumn(id)!
    if (!canDropOn(to, step)) return setColumns(serverColumns)

    // Reorder within the final column, then send (machine, before) to the server.
    let list = columns[to]
    if (overId !== id && list.includes(overId)) {
      const without = list.filter((x) => x !== id)
      const at = without.indexOf(overId)
      const oldIdx = list.indexOf(id)
      const newIdx = list.indexOf(overId)
      without.splice(oldIdx < newIdx ? at + 1 : at, 0, id)
      list = without
      setColumns((cols) => ({ ...cols, [to]: list }))
    }
    const idx = list.indexOf(id)
    const before = list.slice(idx + 1).find((x) => byId.get(x)?.status !== 'in_progress') ?? null
    const machine = machineOf(to)
    const unchanged = origin === to && serverColumns[to]?.join() === list.join()
    if (unchanged) return

    move.mutate(
      { step: id, machine, before: machine ? before : null, version: step.version },
      {
        onSuccess: (r) => {
          const parts = [t('board.moved')]
          if (r.load_pct != null && r.day) parts.push(t('board.movedLoad', { d: formatDate(r.day), p: r.load_pct }))
          toast({ tone: r.load_pct != null && r.load_pct > 100 ? 'error' : 'success', message: parts.join(' · ') })
          if (r.late_jobs.length) toast({ tone: 'error', message: t('board.lateJobs', { jobs: r.late_jobs.join(', ') }) })
        },
        onError: (err) => {
          setColumns(serverColumns)
          toast({ tone: 'error', message: errorMessage(err) })
        },
      },
    )
  }

  if (board.isLoading || machines.isLoading) return <ListSkeleton />
  const err = board.error ?? machines.error
  if (err) return <ErrorNote>{errorMessage(err)}</ErrorNote>

  const approved = board.data?.approved ?? []
  const columnList: { id: ColumnId; machine?: Machine }[] = [
    ...(canMove || columns.unscheduled?.length ? [{ id: 'unscheduled' }] : []),
    ...visibleMachines.map((m) => ({ id: machineCol(m.id), machine: m })),
    ...(columns.outsource?.length ? [{ id: 'outsource' }] : []),
    ...(columns.manual?.length ? [{ id: 'manual' }] : []),
  ]

  // Fill the screen under the mobile top bar (< lg) or beside the sidebar (lg+), so columns scroll inside.
  return (
    <div className="flex h-[calc(100dvh-7.5rem)] min-h-[30rem] flex-col lg:h-[calc(100dvh-3rem)]">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('board.title')}</h1>
          <p className="mt-1 text-muted">{t('board.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-auto">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('board.search')} className="w-full pl-9 sm:w-64" aria-label={t('board.search')} />
          </div>
          <label className="flex min-h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm pointer-coarse:min-h-11">
            <input type="checkbox" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} className="accent-[var(--status-risk)]" />
            <AlertTriangle className="size-4 text-status-risk" aria-hidden />
            {t('board.onlyRisk')}
          </label>
          <div className="flex rounded-lg border border-border bg-surface p-0.5" role="tablist">
            {(['board', 'timeline'] as const).map((v) => (
              <button key={v} role="tab" aria-selected={view === v} onClick={() => pickView(v)}
                className={cn('rounded-md px-3 py-1.5 text-sm pointer-coarse:py-2.5', view === v ? 'bg-surface-2 font-medium' : 'text-muted hover:text-fg')}>
                {v === 'board' ? t('board.viewBoard') : t('board.viewTimeline')}
              </button>
            ))}
          </div>
          <Button variant="secondary" onClick={() => reschedule.mutate()} loading={reschedule.isPending} title={t('board.refreshHint')} aria-description={t('board.refreshHint')}>
            <RefreshCw className="size-4" aria-hidden />
            <span className="sr-only sm:not-sr-only">{t('board.refresh')}</span>
          </Button>
        </div>
      </header>

      {canMove && approved.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-status-ready/30 bg-status-ready/5 px-4 py-2.5 text-sm">
          <Play className="size-4 text-status-ready" aria-hidden />
          <span className="font-medium">{t('board.toRelease', { n: approved.length })}</span>
          <span className="min-w-0 flex-1 truncate text-muted">{approved.map((j) => `${j.job_no} ${j.title}`).join(' · ')}</span>
          <Button
            size="sm"
            loading={release.isPending}
            onClick={() =>
              release.run(approved.map((j) => j.id))
            }
          >
            {t('board.releaseAll')}
          </Button>
        </div>
      )}

      {focusJob && (
        <button className="mb-3 self-start rounded-full bg-brand/10 px-3 py-1 text-xs text-brand pointer-coarse:py-2.5" onClick={() => setFocusJob(null)}>
          {t('board.focus', { job: steps.find((s) => s.job_id === focusJob)?.job.job_no })}
        </button>
      )}

      {steps.length === 0 && approved.length === 0 ? (
        <EmptyState Icon={KanbanSquare} title={t('board.empty')} hint={t('board.emptyHint')} />
      ) : view === 'timeline' ? (
        <Timeline
          steps={steps}
          machines={visibleMachines}
          processName={processName}
          downMachines={new Set((downtimes.data ?? []).map((d) => d.machine_id))}
          matches={matches}
          onOpenStep={setOpenStep}
        />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setColumns(serverColumns) }}>
          <div className="-mx-4 flex min-h-0 flex-1 snap-x snap-mandatory gap-3 overflow-x-auto scroll-px-4 px-4 pb-4 sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:-mx-8 lg:snap-none lg:px-8">
            {columnList.map((col) => {
              const ids = columns[col.id] ?? []
              const valid = !active || canDropOn(col.id, active) || findColumn(active.id) === col.id
              const backlog = ids.reduce((sum, id) => sum + Number(byId.get(id)?.est_minutes ?? 0), 0)
              const l = col.machine ? loadBy.get(col.machine.id) : undefined
              const preview = active && col.machine && valid && l && l.weekAvail > 0 && findColumn(active.id) !== col.id
                ? ((l.weekPlanned + Number(active.est_minutes ?? 0)) / l.weekAvail) * 100
                : null
              return (
                <Column
                  key={col.id}
                  id={col.id}
                  machine={col.machine}
                  ids={ids}
                  valid={valid}
                  dragging={!!active}
                  backlog={backlog}
                  load={l}
                  preview={preview}
                  activeEst={active?.est_minutes ?? null}
                >
                  {ids.map((id) => {
                    const s = byId.get(id)
                    if (!s) return null
                    return (
                      <SortableCard
                        key={id}
                        step={s}
                        processName={processName.get(s.process_id) ?? '—'}
                        draggable={canMove && s.job.status === 'in_production' && (s.status === 'pending' || s.status === 'ready') && col.id !== 'outsource' && col.id !== 'manual'}
                        dimmed={!matches(s)}
                        onFocusJob={() => setFocusJob((f) => (f === s.job_id ? null : s.job_id))}
                        onOpen={() => setOpenStep(s.id)}
                        onMoveTo={
                          canMove && s.job.status === 'in_production' && (s.status === 'pending' || s.status === 'ready') && col.id !== 'outsource' && col.id !== 'manual'
                            ? (machineId) =>
                                move.mutate(
                                  { step: s.id, machine: machineId, before: null, version: s.version },
                                  {
                                    onSuccess: () => toast({ tone: 'success', message: t('board.moved') }),
                                    onError: (err) => toast({ tone: 'error', message: errorMessage(err) }),
                                  },
                                )
                            : undefined
                        }
                      />
                    )
                  })}
                </Column>
              )
            })}
          </div>
          <DragOverlay dropAnimation={{ duration: 160 }}>
            {active && <Card step={active} processName={processName.get(active.process_id) ?? '—'} lifted />}
          </DragOverlay>
        </DndContext>
      )}
      {!canMove && <p className="mt-2 text-xs text-muted">{t('board.readOnly')}</p>}
      {opened && (
        <StepDrawer
          step={opened}
          processName={processName}
          machineName={machineName}
          focused={focusJob === opened.job_id}
          onFocusJob={() => setFocusJob((f) => (f === opened.job_id ? null : opened.job_id))}
          onClose={() => setOpenStep(null)}
        />
      )}
    </div>
  )
}

type ColumnProps = {
  id: ColumnId
  machine?: Machine
  ids: string[]
  valid: boolean
  dragging: boolean
  backlog: number
  load?: { today: number; week: number }
  preview: number | null
  activeEst: number | null
  children: ReactNode
}

function Column({ id, machine, ids, valid, dragging, backlog, load, preview, activeEst, children }: ColumnProps) {
  const { t } = useTranslation()
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !valid })
  const title = machine ? machine.name : t(`board.${id}`)
  const Icon = id === 'unscheduled' ? Inbox : id === 'outsource' ? Users : id === 'manual' ? Users : null

  return (
    <section
      className={cn(
        'flex w-[min(18rem,82vw)] shrink-0 snap-start flex-col rounded-[var(--radius-card)] border bg-surface-2/60 transition-opacity',
        dragging && !valid && 'opacity-40',
        isOver && valid ? 'border-brand ring-2 ring-brand/30' : 'border-border',
        id === 'unscheduled' && 'border-dashed',
      )}
      aria-label={title}
    >
      <header className="flex flex-col gap-1.5 border-b border-border px-3 py-2.5">
        <div className="flex items-center gap-2">
          {Icon && <Icon className="size-4 text-muted" aria-hidden />}
          <h2 className="min-w-0 flex-1 truncate font-semibold">{title}</h2>
          <span className="tabular rounded bg-surface px-1.5 text-xs text-muted">{ids.length}</span>
        </div>
        {machine?.status === 'maintenance' && (
          <span className="flex items-center gap-1 text-xs text-status-paused">
            <Wrench className="size-3.5" aria-hidden />
            {t('board.maintenance')}
          </span>
        )}
        {load && (
          <div className="grid grid-cols-2 gap-2 text-[11px] text-muted">
            {(['today', 'week'] as const).map((k) => {
              const pct = Math.round(load[k])
              return (
                <div key={k}>
                  <div className="flex justify-between"><span>{t(`board.${k}`)}</span><span className="tabular font-medium text-fg">{pct}%</span></div>
                  <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-surface">
                    <div className={cn('h-full rounded-full', loadTone(pct))} style={{ width: `${Math.min(pct, 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        )}
        <div className="flex justify-between text-[11px] text-muted">
          <span>{id === 'unscheduled' ? t('board.unscheduledHint') : backlog > 0 ? t('board.backlog', { t: formatMinutes(t, backlog) }) : ''}</span>
          {preview != null && (
            <span className={cn('tabular font-semibold', preview > 100 ? 'text-status-risk' : 'text-brand')}>
              {t('board.afterDrop', { t: formatMinutes(t, activeEst), p: Math.round(preview) })}
            </span>
          )}
        </div>
      </header>
      <SortableContext id={id} items={ids} strategy={verticalListSortingStrategy}>
        <div ref={setNodeRef} className="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
          {children}
        </div>
      </SortableContext>
    </section>
  )
}

type CardProps = {
  step: BoardStep
  processName: string
  dimmed?: boolean
  lifted?: boolean
  onFocusJob?: () => void
  onOpen?: () => void
  onMoveTo?: (machineId: string) => void
}

function SortableCard({ draggable, ...props }: CardProps & { draggable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.step.id, disabled: !draggable })
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(isDragging && 'opacity-30', draggable && 'cursor-grab active:cursor-grabbing')}
      {...attributes}
      {...listeners}
    >
      <Card {...props} />
    </div>
  )
}

function fmtWindow(start: string | null, end: string | null) {
  if (!start || !end) return null
  const s = new Date(start)
  const e = new Date(end)
  const day = new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
  const time = new Intl.DateTimeFormat(appLocale(), { hour: '2-digit', minute: '2-digit' })
  return s.toDateString() === e.toDateString()
    ? `${day.format(s)} ${time.format(s)}–${time.format(e)}`
    : `${day.format(s)} ${time.format(s)} → ${day.format(e)} ${time.format(e)}`
}

const statusTone: Record<string, string> = {
  pending: 'bg-status-pending/10 text-status-pending',
  ready: 'bg-status-ready/10 text-status-ready',
  in_progress: 'bg-status-progress/10 text-status-progress',
  paused: 'bg-status-paused/10 text-status-paused',
}

// Card = one job step (design §8.1): job colour stripe, stage, process, job, qty, time window, due date, risk.
function Card({ step, processName, dimmed, lifted, onFocusJob, onOpen, onMoveTo }: CardProps) {
  const { t } = useTranslation()
  const style = stepTypeStyle[step.step_type]
  const window = fmtWindow(step.planned_start, step.planned_end)
  return (
    <article
      className={cn(
        'rounded-lg border border-border bg-surface p-2.5 text-[13px] shadow-sm transition-[opacity,box-shadow]',
        dimmed && 'opacity-30',
        lifted && 'rotate-1 shadow-xl ring-2 ring-brand/40',
        step.job.is_at_risk && 'border-status-risk/50',
        onOpen && 'cursor-pointer hover:border-brand/50',
      )}
      style={{ borderLeft: `4px solid hsl(${jobHue(step.job_id)} 70% 55%)` }}
      // Inner buttons and links keep their own action; a drag never reaches this click.
      onClick={(e) => {
        if (!(e.target as HTMLElement).closest('a, button, [data-card-menu]')) onOpen?.()
      }}
    >
      <div className="flex items-center gap-1.5 text-[11px] text-muted">
        <button
          type="button"
          className="font-semibold hover:text-brand"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onFocusJob}
        >
          {step.job.job_no}
        </button>
        <span>· {t('board.stage', { n: step.seq })}</span>
        {step.job.is_at_risk && <AlertTriangle className="ml-auto size-3.5 text-status-risk" aria-label={t('board.atRisk')} />}
        {onMoveTo && <SuggestButton stepId={step.id} currentMachine={step.machine_id} onPick={onMoveTo} className={step.job.is_at_risk ? '' : 'ml-auto'} />}
      </div>
      {(step.job.status !== 'in_production' || step.is_rework) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {step.job.status === 'pending_approval' && <span className="rounded bg-status-paused/10 px-1.5 text-[10px] text-status-paused">{t('board.reapproval')}</span>}
          {step.job.status === 'on_hold' && <span className="rounded bg-status-risk/10 px-1.5 text-[10px] text-status-risk">{t('jobStatus.on_hold')}</span>}
          {step.is_rework && <span className="rounded bg-status-paused/10 px-1.5 text-[10px] text-status-paused">{t('plan.rework')}</span>}
        </div>
      )}
      <div className="mt-1 flex items-center gap-1.5">
        <span className={cn('grid size-5 shrink-0 place-items-center rounded', style.cls)}>
          <style.Icon className="size-3" aria-hidden />
        </span>
        <button type="button" className="min-w-0 truncate text-left font-semibold hover:text-brand" onClick={onOpen} aria-label={t('board.detail.open', { name: processName })}>
          {processName}
        </button>
      </div>
      <div className="mt-0.5 truncate text-muted">
        <JobLink jobId={step.job_id} stepId={step.id} title={`${step.job.job_no} · ${step.job.title}`} className="hover:text-brand hover:underline">
          {step.job.title}
        </JobLink>
        {step.job.order?.customer?.name ? ` · ${step.job.order.customer.name}` : ''}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <span className="tabular">{t('plan.pcs', { n: Number(step.planned_qty).toLocaleString() })}</span>
        {step.est_minutes != null && <span className="tabular text-muted">· {formatMinutes(t, Number(step.est_minutes))}</span>}
        <span className={cn('ml-auto rounded-full px-1.5 py-0.5', statusTone[step.status] ?? 'bg-surface-2 text-muted')}>
          {t(`stepStatus.${step.status}`)}
        </span>
      </div>
      {(window || step.job.due_date) && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 border-t border-border pt-1.5 text-[11px] text-muted">
          {window && (
            <span className="tabular flex items-center gap-1">
              <CalendarClock className="size-3" aria-hidden />
              {window}
            </span>
          )}
          {step.job.due_date && (
            <span className={cn('ml-auto', step.job.is_at_risk && 'font-semibold text-status-risk')}>{t('board.due', { d: formatDate(step.job.due_date) })}</span>
          )}
        </div>
      )}
    </article>
  )
}

// Alternative machines (SRS §7.4): capable machines ordered by when the step would finish there.
function SuggestButton({ stepId, currentMachine, onPick, className }: { stepId: string; currentMachine: string | null; onPick: (machineId: string) => void; className?: string }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const suggestions = useSuggestMachines(open ? stepId : null)
  const time = new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <span data-card-menu className={cn('relative', className)} onPointerDown={(e) => e.stopPropagation()}>
      <button type="button" aria-label={t('board.suggest')} title={t('board.suggest')} className="rounded p-0.5 hover:bg-surface-2 hover:text-brand pointer-coarse:-m-2 pointer-coarse:p-2.5" onClick={() => setOpen((o) => !o)}>
        <ArrowLeftRight className="size-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-30 w-64 max-w-[80vw] rounded-lg border border-border bg-surface p-1 text-[12px] text-fg shadow-xl">
          <p className="px-2 py-1 text-[11px] font-medium text-muted">{t('board.suggest')}</p>
          {suggestions.isLoading && <p className="px-2 py-2 text-muted">…</p>}
          {suggestions.data?.length === 0 && <p className="px-2 py-2 text-muted">{t('board.noSuggestion')}</p>}
          {suggestions.data?.map((m, i) => (
            <button
              key={m.machine_id}
              type="button"
              disabled={m.machine_id === currentMachine}
              onClick={() => { setOpen(false); onPick(m.machine_id) }}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-60"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{m.name}{m.machine_id === currentMachine ? ` · ${t('board.current')}` : ''}</span>
                <span className="tabular text-muted">{formatMinutes(t, Number(m.est_minutes))} · {t('board.finishAt', { d: time.format(new Date(m.end_at)) })}</span>
              </span>
              {i === 0 && m.machine_id !== currentMachine && <span className="rounded bg-status-done/10 px-1.5 text-[10px] text-status-done">{t('board.fastest')}</span>}
            </button>
          ))}
        </div>
      )}
    </span>
  )
}
