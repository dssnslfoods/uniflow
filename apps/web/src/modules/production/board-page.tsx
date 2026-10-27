import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
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
import { AlertTriangle, CalendarClock, Inbox, KanbanSquare, Play, RefreshCw, Search, Users, Wrench } from 'lucide-react'
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
import {
  formatMinutes,
  useBoard,
  useMachineLoad,
  useMoveStep,
  useReleaseJobs,
  useReschedule,
  type BoardStep,
  type LoadRow,
} from './api'

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
  const release = useReleaseJobs()
  const reschedule = useReschedule()
  const canMove = hasRole('admin', 'manager', 'supervisor')

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
    const today = new Date().toISOString().slice(0, 10)
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

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{t('board.title')}</h1>
          <p className="mt-1 text-muted">{t('board.subtitle')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('board.search')} className="w-64 pl-9" aria-label={t('board.search')} />
          </div>
          <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-2 text-sm">
            <input type="checkbox" checked={onlyRisk} onChange={(e) => setOnlyRisk(e.target.checked)} className="accent-[var(--status-risk)]" />
            <AlertTriangle className="size-4 text-status-risk" aria-hidden />
            {t('board.onlyRisk')}
          </label>
          <Button variant="secondary" onClick={() => reschedule.mutate()} loading={reschedule.isPending} title={t('board.refresh')}>
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
              release.mutate(
                { p_jobs: approved.map((j) => j.id) },
                {
                  onSuccess: (n) => toast({ tone: 'success', message: t('board.released', { n }) }),
                  onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
                },
              )
            }
          >
            {t('board.releaseAll')}
          </Button>
        </div>
      )}

      {focusJob && (
        <button className="mb-3 self-start rounded-full bg-brand/10 px-3 py-1 text-xs text-brand" onClick={() => setFocusJob(null)}>
          {t('board.focus', { job: steps.find((s) => s.job_id === focusJob)?.job.job_no })}
        </button>
      )}

      {steps.length === 0 && approved.length === 0 ? (
        <EmptyState Icon={KanbanSquare} title={t('board.empty')} hint={t('board.emptyHint')} />
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd} onDragCancel={() => { setActiveId(null); setColumns(serverColumns) }}>
          <div className="-mx-4 flex min-h-0 flex-1 gap-3 overflow-x-auto px-4 pb-4 md:-mx-8 md:px-8">
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
                        draggable={canMove && (s.status === 'pending' || s.status === 'ready') && col.id !== 'outsource' && col.id !== 'manual'}
                        dimmed={!matches(s)}
                        onFocusJob={() => setFocusJob((f) => (f === s.job_id ? null : s.job_id))}
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
        'flex w-72 shrink-0 flex-col rounded-[var(--radius-card)] border bg-surface-2/60 transition-opacity',
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

type CardProps = { step: BoardStep; processName: string; dimmed?: boolean; lifted?: boolean; onFocusJob?: () => void }

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
  const day = new Intl.DateTimeFormat(undefined, { weekday: 'short', day: 'numeric', month: 'short' })
  const time = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' })
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
function Card({ step, processName, dimmed, lifted, onFocusJob }: CardProps) {
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
      )}
      style={{ borderLeft: `4px solid hsl(${jobHue(step.job_id)} 70% 55%)` }}
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
      </div>
      <div className="mt-1 flex items-center gap-1.5">
        <span className={cn('grid size-5 shrink-0 place-items-center rounded', style.cls)}>
          <style.Icon className="size-3" aria-hidden />
        </span>
        <span className="truncate font-semibold">{processName}</span>
      </div>
      <div className="mt-0.5 truncate text-muted">
        {step.job.title}
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
