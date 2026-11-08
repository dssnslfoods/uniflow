import { useMemo, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { AlertTriangle, CheckCheck, CircleCheck, Factory, OctagonAlert, PackageCheck, TrendingUp } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useMachines } from '../masters/machines/api'
import { formatDate } from '../orders/format'
import { useMachineLoad } from '../production/api'
import { useDashboard } from './api'
import { JobLink } from '../production/job-link'

// Load state uses the reserved status colours and always shows the % as text (dataviz: never colour alone).
function loadState(pct: number) {
  return pct > 100 ? { bar: 'bg-status-risk', text: 'text-status-risk' }
    : pct >= 80 ? { bar: 'bg-status-paused', text: 'text-status-paused' }
      : { bar: 'bg-status-done', text: 'text-fg' }
}

export function DashboardPage() {
  const { t } = useTranslation()
  const summary = useDashboard()
  const load = useMachineLoad(7)
  const machines = useMachines()

  const loadRows = useMemo(() => {
    const byMachine = new Map<string, { avail: number; planned: number }>()
    ;(load.data ?? []).forEach((r) => {
      const cur = byMachine.get(r.machine_id) ?? { avail: 0, planned: 0 }
      cur.avail += Number(r.available_min)
      cur.planned += Number(r.planned_min)
      byMachine.set(r.machine_id, cur)
    })
    return (machines.data ?? [])
      .filter((m) => m.status !== 'inactive')
      .map((m) => {
        const v = byMachine.get(m.id) ?? { avail: 0, planned: 0 }
        return { id: m.id, name: m.name, pct: v.avail > 0 ? Math.round((v.planned / v.avail) * 100) : 0, hours: v.planned / 60 }
      })
      .sort((a, b) => b.pct - a.pct)
  }, [load.data, machines.data])

  if (summary.isLoading) return <ListSkeleton />
  if (summary.error) return <ErrorNote>{errorMessage(summary.error)}</ErrorNote>
  const s = summary.data!
  const otd = s.otd_30d.finished > 0 ? Math.round((s.otd_30d.on_time / s.otd_30d.finished) * 100) : null
  const wasteToday = s.today.good + s.today.waste > 0 ? (s.today.waste / (s.today.good + s.today.waste)) * 100 : 0
  const maxDown = Math.max(1, ...s.downtime_7d.map((d) => Number(d.minutes)))

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('dashboard.title')} subtitle={t('dashboard.subtitle')} />

      {s.machines_down.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-status-risk/40 bg-status-risk/10 px-4 py-2.5 text-sm text-status-risk">
          <OctagonAlert className="size-4" aria-hidden />
          <b>{t('dashboard.downNow')}:</b>
          {s.machines_down.map((d) => `${d.machine} (${t(`downtime.${d.reason}`)})`).join(' · ')}
        </div>
      )}

      <dl className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Tile Icon={Factory} label={t('dashboard.inProduction')} value={s.counts.in_production} to="/board" />
        <Tile Icon={AlertTriangle} label={t('dashboard.atRisk')} value={s.counts.at_risk} tone={s.counts.at_risk > 0 ? 'risk' : undefined} to="/board" />
        <Tile Icon={CheckCheck} label={t('dashboard.pendingApproval')} value={s.counts.pending_approval} tone={s.counts.pending_approval > 0 ? 'warn' : undefined} to="/approvals" />
        <Tile Icon={PackageCheck} label={t('dashboard.readyToDeliver')} value={s.counts.ready_to_deliver} />
        <Tile Icon={TrendingUp} label={t('dashboard.otd')} value={otd == null ? '—' : `${otd}%`} hint={otd == null ? t('dashboard.otdNone') : `${s.otd_30d.on_time}/${s.otd_30d.finished}`} />
      </dl>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Card title={t('dashboard.load')} hint={t('dashboard.loadHint')}>
          <ul className="flex flex-col gap-3">
            {loadRows.map((m) => {
              const st = loadState(m.pct)
              return (
                <li key={m.id} title={`${m.name}: ${m.pct}% · ${m.hours.toFixed(1)} h`}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="truncate">{m.name}</span>
                    <span className={cn('tabular font-semibold', st.text)}>{m.pct}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className={cn('h-full rounded-full', st.bar)} style={{ width: `${Math.min(m.pct, 100)}%` }} />
                  </div>
                </li>
              )
            })}
          </ul>
        </Card>

        <Card title={t('dashboard.riskJobs')}>
          {s.at_risk_jobs.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted"><CircleCheck className="size-4 text-status-done" aria-hidden />{t('dashboard.noRisk')}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {s.at_risk_jobs.map((j) => (
                <li key={j.id} className="py-2">
                  <JobLink jobId={j.id} title={`${j.job_no} · ${j.title}`} className="block w-full hover:text-brand">
                    <div className="flex items-baseline justify-between gap-2 text-sm">
                      <span className="truncate font-medium">{j.job_no} {j.title}</span>
                      <span className="shrink-0 text-xs text-status-risk">{t('board.due', { d: formatDate(j.due_date) })}</span>
                    </div>
                    <div className="text-xs text-muted">{j.customer} · {t('dashboard.expected', { d: formatDate(j.planned_finish_at) })}</div>
                  </JobLink>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title={t('dashboard.todayOutput')}>
          <div className="grid grid-cols-3 gap-3">
            <Hero label={t('dashboard.good')} value={Number(s.today.good).toLocaleString()} />
            <Hero label={t('dashboard.waste')} value={Number(s.today.waste).toLocaleString()} sub={`${wasteToday.toFixed(1)}%`} />
            <Hero label={t('dashboard.stepsDone')} value={String(s.today.steps_done)} />
          </div>
          {s.waste_7d.length > 0 ? (
            <>
              <h3 className="mb-2 mt-5 text-[13px] font-medium">{t('dashboard.waste7d')}</h3>
              <table className="w-full text-sm">
                <tbody>
                  {s.waste_7d.map((w) => (
                    <tr key={w.process} className="border-t border-border">
                      <td className="py-1.5">{w.process}</td>
                      <td className="tabular py-1.5 text-right text-muted">{Number(w.good).toLocaleString()} / {Number(w.waste).toLocaleString()}</td>
                      <td className="tabular w-16 py-1.5 text-right font-medium">{w.waste_pct ?? 0}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="mt-4 text-sm text-muted">{t('dashboard.noWaste')}</p>
          )}
        </Card>

        <Card title={t('dashboard.downtime')}>
          {s.downtime_7d.length === 0 ? (
            <p className="text-sm text-muted">{t('dashboard.noDowntime')}</p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {s.downtime_7d.map((d) => (
                <li key={d.reason} title={`${t(`downtime.${d.reason}`)}: ${d.minutes} min`}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span>{t(`downtime.${d.reason}`)}</span>
                    <span className="tabular font-medium">{Number(d.minutes).toLocaleString()}</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                    <div className="h-full rounded-full bg-brand" style={{ width: `${(Number(d.minutes) / maxDown) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}

function Card({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <h2 className="font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-xs text-muted">{hint}</p>}
      <div className={hint ? '' : 'mt-3'}>{children}</div>
    </section>
  )
}

function Tile({ Icon, label, value, hint, tone, to }: { Icon: typeof Factory; label: string; value: number | string; hint?: string; tone?: 'risk' | 'warn'; to?: string }) {
  const body = (
    <>
      <dt className="flex items-center gap-1.5 text-xs text-muted"><Icon className="size-3.5" aria-hidden />{label}</dt>
      <dd className={cn('tabular mt-1 text-3xl font-semibold', tone === 'risk' && 'text-status-risk', tone === 'warn' && 'text-status-paused')}>{value}</dd>
      {hint && <dd className="text-xs text-muted">{hint}</dd>}
    </>
  )
  const cls = 'rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3'
  return to ? <Link to={to} className={cn(cls, 'block hover:border-brand/60')}>{body}</Link> : <div className={cls}>{body}</div>
}

function Hero({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="tabular text-2xl font-semibold">{value}</div>
      {sub && <div className="tabular text-xs text-muted">{sub}</div>}
    </div>
  )
}
