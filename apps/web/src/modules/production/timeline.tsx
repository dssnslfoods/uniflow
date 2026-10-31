import { useMemo, useState } from 'react'
import { appLocale } from '@/shared/locale'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Machine } from '../masters/machines/api'
import { formatMinutes, type BoardStep } from './api'

const HOUR = 3_600_000
const DAY = 24 * HOUR

// Bars wear the reserved status colours and always carry a text label (state is never colour alone).
const barTone: Record<string, string> = {
  pending: 'border border-dashed border-status-pending/60 bg-surface-2 text-muted',
  ready: 'bg-status-ready/85 text-white',
  in_progress: 'bg-status-progress/90 text-white',
  paused: 'bg-status-paused/85 text-white',
}

type Row = { id: string; label: string; steps: BoardStep[]; down?: boolean }

// Gantt (FR-6.4): machines as rows, planned windows as bars, today → N days.
export function Timeline({
  steps, machines, processName, downMachines, matches, onOpenStep,
}: {
  steps: BoardStep[]
  machines: Machine[]
  processName: Map<string, string>
  downMachines: Set<string>
  matches: (s: BoardStep) => boolean
  onOpenStep: (id: string) => void
}) {
  const { t } = useTranslation()
  const [days, setDays] = useState(3)
  const start = useMemo(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d.getTime()
  }, [])
  const end = start + days * DAY
  const now = Date.now()

  const rows: Row[] = useMemo(() => {
    const scheduled = steps.filter((s) => s.planned_start && s.planned_end)
    const out: Row[] = machines.map((m) => ({
      id: m.id, label: m.name, steps: scheduled.filter((s) => s.machine_id === m.id), down: downMachines.has(m.id),
    }))
    const outsource = scheduled.filter((s) => !s.machine_id && s.step_type === 'outsource')
    const manual = scheduled.filter((s) => !s.machine_id && s.step_type !== 'outsource')
    if (outsource.length) out.push({ id: 'outsource', label: t('board.outsource'), steps: outsource })
    if (manual.length) out.push({ id: 'manual', label: t('board.manual'), steps: manual })
    return out
  }, [steps, machines, downMachines, t])

  const pct = (ms: number) => ((Math.min(Math.max(ms, start), end) - start) / (end - start)) * 100
  const dayFmt = new Intl.DateTimeFormat(appLocale(), { weekday: 'short', day: 'numeric', month: 'short' })
  const timeFmt = new Intl.DateTimeFormat(appLocale(), { hour: '2-digit', minute: '2-digit' })
  const ticks = Array.from({ length: days }, (_, i) => start + i * DAY)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="mb-2 flex justify-end gap-1">
        {[3, 7, 14].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={cn('rounded-lg px-3 py-1 text-sm', days === d ? 'bg-surface font-medium shadow-sm ring-1 ring-border' : 'text-muted hover:bg-surface-2')}>
            {t('board.days', { n: d })}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border border-border bg-surface">
        <div className="min-w-[900px]">
          <div className="sticky top-0 z-10 grid grid-cols-[180px_1fr] border-b border-border bg-surface-2 text-xs text-muted">
            <div className="px-3 py-2" />
            <div className="relative h-8">
              {ticks.map((d) => (
                <span key={d} className="absolute top-0 flex h-full items-center border-l border-border pl-2" style={{ left: `${pct(d)}%` }}>
                  {dayFmt.format(new Date(d))}
                </span>
              ))}
            </div>
          </div>
          {rows.map((row) => (
            <div key={row.id} className="grid grid-cols-[180px_1fr] border-b border-border last:border-0">
              <div className={cn('truncate px-3 py-3 text-sm font-medium', row.down && 'text-status-risk')}>
                {row.label}{row.down ? ' ⛔' : ''}
              </div>
              <div className="relative h-12">
                {ticks.map((d) => <span key={d} className="absolute inset-y-0 border-l border-border/60" style={{ left: `${pct(d)}%` }} aria-hidden />)}
                {now >= start && now <= end && (
                  <span className="absolute inset-y-0 z-[1] w-0.5 bg-status-risk" style={{ left: `${pct(now)}%` }} title={t('board.now')} />
                )}
                {row.steps.map((s) => {
                  const a = new Date(s.planned_start!).getTime()
                  const b = new Date(s.planned_end!).getTime()
                  if (b < start || a > end) return null
                  const left = pct(a)
                  const width = Math.max(pct(b) - left, 0.6)
                  const label = `${s.job.job_no} · ${processName.get(s.process_id) ?? ''}`
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => onOpenStep(s.id)}
                      title={`${label}\n${s.job.title}\n${timeFmt.format(new Date(a))} – ${timeFmt.format(new Date(b))} (${formatMinutes(t, Number(s.est_minutes ?? 0))})\n${t(`stepStatus.${s.status}`)}${s.job.is_at_risk ? ` · ${t('board.atRisk')}` : ''}`}
                      className={cn(
                        'absolute top-2 flex h-8 items-center overflow-hidden rounded-md px-1.5 text-left text-[11px] font-medium transition-opacity hover:z-[2] hover:ring-2 hover:ring-brand',
                        barTone[s.status] ?? barTone.pending,
                        s.job.is_at_risk && 'ring-2 ring-status-risk',
                        !matches(s) && 'opacity-25',
                      )}
                      style={{ left: `${left}%`, width: `${width}%` }}
                    >
                      <span className="truncate">{label}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
