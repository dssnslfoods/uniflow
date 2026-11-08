import { useQuery } from '@tanstack/react-query'
import { rpc } from '@/lib/supabase'
import { localDate } from '@/shared/locale'
import { useTenantKey } from '@/shared/data'
import type { PersonLoad } from '../production/workload'

// api.staffing_report — minutes over a past period (see the migration for the definitions).
export type StaffingPerson = {
  profile_id: string
  membership_id: string | null
  name: string
  is_active: boolean
  roles: string[]
  machines: string[]
  shift_min: number
  run_min: number
  ot_min: number
}
export type StaffingMachine = {
  machine_id: string
  name: string
  avail_min: number
  run_min: number
  ot_min: number
  unstaffed_min: number
  people: number
}
export type StaffingReport = { from: string; to: string; people: StaffingPerson[]; machines: StaffingMachine[] }

function daysAgo(n: number) {
  const d = new Date(`${localDate()}T00:00:00`)
  d.setDate(d.getDate() - n)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function useStaffingReport(days: number) {
  const key = useTenantKey('staffing-report', days)
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await rpc().rpc('staffing_report', { p_from: daysAgo(days - 1), p_to: localDate() })
      if (error) throw error
      return data as StaffingReport
    },
  })
}

export const inShift = (r: { run_min: number; ot_min: number }) => Math.max(Number(r.run_min) - Number(r.ot_min), 0)
export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : null)

export type Finding = { tone: 'risk' | 'warn' | 'info' | 'ok'; key: string; params?: Record<string, string | number> }
export type Verdict = 'short' | 'balanced' | 'surplus' | 'nodata'

// Thresholds for the advice. Kept together so the manual and the code say the same thing.
export const RULES = { overloadPct: 100, otShare: 0.1, busyUtil: 0.75, idleUtil: 0.4, idleLoadPct: 50 }

type Forward = { loads: Map<string, PersonLoad>; unstaffedQueue: string[] }

// Turn the report (what happened) and the 7-day queue (what is coming) into a verdict and advice.
export function assessStaffing(report: StaffingReport, forward: Forward) {
  const people = report.people.filter((p) => p.is_active)
  const shift = people.reduce((s, p) => s + Number(p.shift_min), 0)
  const run = report.machines.reduce((s, m) => s + Number(m.run_min), 0)
  const ot = report.machines.reduce((s, m) => s + Number(m.ot_min), 0)
  const unstaffed = report.machines.reduce((s, m) => s + Number(m.unstaffed_min), 0)
  const staffedInShift = people.reduce((s, p) => s + inShift(p), 0)
  const util = shift > 0 ? staffedInShift / shift : 0
  const otShare = run > 0 ? ot / run : 0

  const loads = people.flatMap((p) => (p.membership_id && forward.loads.get(p.membership_id) ? [{ p, l: forward.loads.get(p.membership_id)! }] : []))
  const queue = loads.reduce((s, x) => s + x.l.queueMin, 0)
  const avail = loads.reduce((s, x) => s + x.l.availMin, 0)
  const forwardPct = avail > 0 ? (queue / avail) * 100 : 0
  const perPersonAvail = loads.length ? avail / loads.length : 0
  const extraPeople = perPersonAvail > 0 && queue > avail ? Math.ceil((queue - avail) / perPersonAvail) : 0

  const over = loads.filter((x) => x.l.pct > RULES.overloadPct).map((x) => x.p.name)
  const idle = people
    .filter((p) => Number(p.shift_min) > 0 && inShift(p) / Number(p.shift_min) < RULES.idleUtil
      && (!p.membership_id || (forward.loads.get(p.membership_id)?.pct ?? 0) < RULES.idleLoadPct))
    .map((p) => p.name)

  const findings: Finding[] = []
  if (over.length) findings.push({ tone: 'risk', key: 'over', params: { names: over.join(', ') } })
  if (extraPeople > 0) findings.push({ tone: 'risk', key: 'addPeople', params: { n: extraPeople, p: Math.round(forwardPct) } })
  if (forward.unstaffedQueue.length) findings.push({ tone: 'warn', key: 'noOperator', params: { machines: forward.unstaffedQueue.join(', ') } })
  if (otShare > RULES.otShare) {
    findings.push(util >= RULES.busyUtil
      ? { tone: 'warn', key: 'otJustified', params: { ot: Math.round(otShare * 100), u: Math.round(util * 100) } }
      : { tone: 'warn', key: 'otAvoidable', params: { ot: Math.round(otShare * 100), u: Math.round(util * 100) } })
  } else if (ot > 0) {
    findings.push({ tone: 'ok', key: 'otLow', params: { ot: Math.round(otShare * 100) } })
  }
  if (idle.length) findings.push({ tone: 'info', key: 'spare', params: { names: idle.join(', ') } })
  if (unstaffed > 0) findings.push({ tone: 'info', key: 'unstaffedRun', params: { m: Math.round(unstaffed) } })

  const verdict: Verdict =
    shift === 0 && run === 0 && loads.length === 0 ? 'nodata'
      : forwardPct > RULES.overloadPct || over.length >= 2 || (otShare > RULES.otShare && util >= RULES.busyUtil) ? 'short'
        : forwardPct < RULES.idleLoadPct && util < RULES.idleUtil + 0.1 && otShare <= RULES.otShare / 2 ? 'surplus'
          : 'balanced'
  if (verdict === 'balanced' && findings.every((f) => f.tone === 'ok' || f.tone === 'info')) findings.unshift({ tone: 'ok', key: 'balanced' })

  return { verdict, findings, totals: { shift, run, ot, unstaffed, util, otShare, forwardPct } }
}
