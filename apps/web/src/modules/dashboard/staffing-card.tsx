import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CircleCheck, Info, UsersRound } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { ErrorNote } from '@/shared/ui/page'
import type { Machine } from '../masters/machines/api'
import type { LoadRow } from '../production/api'
import { personWorkload, workloadTone } from '../production/workload'
import { useMembers } from '../settings/api'
import { assessStaffing, inShift, pct, useStaffingReport, type Finding, type Verdict } from './staffing'

const hours = (min: number) => (Number(min) / 60).toLocaleString(undefined, { maximumFractionDigits: 1 })

const verdictTone: Record<Verdict, string> = {
  short: 'bg-status-risk/10 text-status-risk',
  balanced: 'bg-status-done/10 text-status-done',
  surplus: 'bg-status-paused/10 text-status-paused',
  nodata: 'bg-surface-2 text-muted',
}

const findingIcon = { risk: AlertTriangle, warn: AlertTriangle, info: Info, ok: CircleCheck }
const findingTone = { risk: 'text-status-risk', warn: 'text-status-paused', info: 'text-muted', ok: 'text-status-done' }

// Executive staffing report: hours per person/machine, utilisation, overtime, and whether the
// shop has enough people for the coming week.
export function StaffingCard({ load, machines }: { load: LoadRow[]; machines: Machine[] }) {
  const { t } = useTranslation()
  const [days, setDays] = useState(30)
  const report = useStaffingReport(days)
  const members = useMembers()

  const forward = useMemo(() => {
    const ops = new Map<string, string[]>()
    ;(members.data ?? []).filter((m) => m.is_active && !m.is_support)
      .forEach((m) => m.machine_ids.forEach((id) => ops.set(id, [...(ops.get(id) ?? []), m.membership_id])))
    const planned = new Map<string, number>()
    load.forEach((r) => planned.set(r.machine_id, (planned.get(r.machine_id) ?? 0) + Number(r.planned_min)))
    const unstaffedQueue = machines.filter((m) => m.status !== 'inactive' && (planned.get(m.id) ?? 0) > 0 && !ops.get(m.id)?.length).map((m) => m.name)
    return { loads: personWorkload(load, ops), unstaffedQueue }
  }, [members.data, load, machines])

  const result = useMemo(() => (report.data ? assessStaffing(report.data, forward) : null), [report.data, forward])

  return (
    <section className="min-w-0 rounded-[var(--radius-card)] border border-border bg-surface p-4 sm:p-5 lg:col-span-2">
      <header className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 font-semibold"><UsersRound className="size-4 text-muted" aria-hidden />{t('staffing.title')}</h2>
          <p className="text-xs text-muted">{t('staffing.hint')}</p>
        </div>
        <div className="flex rounded-lg border border-border bg-surface p-0.5" role="tablist" aria-label={t('staffing.period')}>
          {[7, 30, 90].map((d) => (
            <button key={d} role="tab" aria-selected={days === d} onClick={() => setDays(d)}
              className={cn('rounded-md px-3 py-1 text-xs pointer-coarse:py-2.5', days === d ? 'bg-surface-2 font-medium' : 'text-muted hover:text-fg')}>
              {t('staffing.days', { n: d })}
            </button>
          ))}
        </div>
      </header>

      {report.isLoading && <p className="text-sm text-muted">…</p>}
      {report.error && <ErrorNote>{errorMessage(report.error)}</ErrorNote>}
      {report.data && result && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <span className={cn('rounded-full px-3 py-1 text-sm font-semibold', verdictTone[result.verdict])}>{t(`staffing.verdict.${result.verdict}`)}</span>
            <span className="text-xs text-muted">{t('staffing.forward', { p: Math.round(result.totals.forwardPct) })}</span>
          </div>

          <dl className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kpi label={t('staffing.kpi.shift')} value={`${hours(result.totals.shift)} ${t('staffing.h')}`} />
            <Kpi label={t('staffing.kpi.run')} value={`${hours(result.totals.run)} ${t('staffing.h')}`} />
            <Kpi label={t('staffing.kpi.util')} value={`${Math.round(result.totals.util * 100)}%`} hint={t('staffing.kpi.utilHint')} />
            <Kpi label={t('staffing.kpi.ot')} value={`${hours(result.totals.ot)} ${t('staffing.h')}`} hint={t('staffing.kpi.otHint', { p: Math.round(result.totals.otShare * 100) })}
              tone={result.totals.otShare > 0.1 ? 'warn' : undefined} />
          </dl>

          <ul className="mb-5 flex flex-col gap-1.5">
            {result.findings.map((f: Finding) => {
              const Icon = findingIcon[f.tone]
              return (
                <li key={f.key} className="flex items-start gap-2 text-sm">
                  <Icon className={cn('mt-0.5 size-4 shrink-0', findingTone[f.tone])} aria-hidden />
                  <span>{t(`staffing.finding.${f.key}`, f.params)}</span>
                </li>
              )
            })}
          </ul>

          <h3 className="mb-2 text-[13px] font-medium">{t('staffing.byPerson')}</h3>
          <div className="mb-5 overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 font-medium">{t('staffing.col.person')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.shift')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.run')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.util')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.ot')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.next7')}</th>
                </tr>
              </thead>
              <tbody>
                {report.data.people.map((p) => {
                  const u = pct(inShift(p), Number(p.shift_min))
                  const next = p.membership_id ? forward.loads.get(p.membership_id) : undefined
                  return (
                    <tr key={p.profile_id} className={cn('border-t border-border', !p.is_active && 'text-muted')}>
                      <td className="py-1.5">
                        <div className="font-medium">{p.name}{!p.is_active && ` · ${t('staffing.left')}`}</div>
                        <div className="truncate text-xs text-muted">{p.machines.length ? p.machines.join(', ') : t('staff.noOperator')}</div>
                      </td>
                      <td className="tabular py-1.5 text-right">{hours(p.shift_min)}</td>
                      <td className="tabular py-1.5 text-right">{hours(p.run_min)}</td>
                      <td className="tabular py-1.5 text-right font-medium">{u == null ? '—' : `${u}%`}</td>
                      <td className={cn('tabular py-1.5 text-right', Number(p.ot_min) > 0 && 'text-status-paused')}>{hours(p.ot_min)}</td>
                      <td className={cn('tabular py-1.5 text-right font-medium', next && workloadTone(next.pct))}>{next ? `${Math.round(next.pct)}%` : '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <h3 className="mb-2 text-[13px] font-medium">{t('staffing.byMachine')}</h3>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr>
                  <th className="py-1.5 font-medium">{t('staffing.col.machine')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.avail')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.run')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.util')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.ot')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.unstaffed')}</th>
                  <th className="py-1.5 text-right font-medium">{t('staffing.col.people')}</th>
                </tr>
              </thead>
              <tbody>
                {report.data.machines.map((m) => {
                  const u = pct(inShift(m), Number(m.avail_min))
                  return (
                    <tr key={m.machine_id} className="border-t border-border">
                      <td className="py-1.5 font-medium">{m.name}</td>
                      <td className="tabular py-1.5 text-right">{hours(m.avail_min)}</td>
                      <td className="tabular py-1.5 text-right">{hours(m.run_min)}</td>
                      <td className="tabular py-1.5 text-right font-medium">{u == null ? '—' : `${u}%`}</td>
                      <td className={cn('tabular py-1.5 text-right', Number(m.ot_min) > 0 && 'text-status-paused')}>{hours(m.ot_min)}</td>
                      <td className={cn('tabular py-1.5 text-right', Number(m.unstaffed_min) > 0 && 'text-status-risk')}>{hours(m.unstaffed_min)}</td>
                      <td className="tabular py-1.5 text-right">{m.people}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">{t('staffing.footnote')}</p>
        </>
      )}
    </section>
  )
}

function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'warn' }) {
  return (
    <div className="rounded-lg bg-surface-2/60 px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={cn('tabular text-xl font-semibold', tone === 'warn' && 'text-status-paused')}>{value}</dd>
      {hint && <dd className="text-[11px] text-muted">{hint}</dd>}
    </div>
  )
}
