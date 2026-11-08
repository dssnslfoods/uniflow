import { localDate } from '@/shared/locale'
import type { BoardStep, LoadRow } from './api'

// Workload of the people assigned to machines, from the machine load rows (planned minutes and
// shift minutes per machine per day). A machine's queue is split evenly between the people on it;
// a person's hours per day are the longest shift among their machines (two machines on one
// calendar do not double their hours) — the same rules as api.staffing_report.
export type PersonLoad = { queueMin: number; availMin: number; pct: number; machines: number }

export function personWorkload(rows: LoadRow[], operatorsByMachine: Map<string, string[]>): Map<string, PersonLoad> {
  const planned = new Map<string, number>()
  const availByMachineDay = new Map<string, Map<string, number>>()
  rows.forEach((r) => {
    planned.set(r.machine_id, (planned.get(r.machine_id) ?? 0) + Number(r.planned_min))
    const days = availByMachineDay.get(r.machine_id) ?? new Map<string, number>()
    days.set(r.day, Number(r.available_min))
    availByMachineDay.set(r.machine_id, days)
  })

  const machinesOf = new Map<string, string[]>()
  operatorsByMachine.forEach((people, machine) =>
    people.forEach((p) => machinesOf.set(p, [...(machinesOf.get(p) ?? []), machine])),
  )

  const out = new Map<string, PersonLoad>()
  machinesOf.forEach((machines, person) => {
    let queueMin = 0
    const perDay = new Map<string, number>()
    machines.forEach((m) => {
      queueMin += (planned.get(m) ?? 0) / Math.max(operatorsByMachine.get(m)?.length ?? 1, 1)
      availByMachineDay.get(m)?.forEach((min, day) => perDay.set(day, Math.max(perDay.get(day) ?? 0, min)))
    })
    const availMin = [...perDay.values()].reduce((a, b) => a + b, 0)
    out.set(person, { queueMin, availMin, pct: availMin > 0 ? (queueMin / availMin) * 100 : 0, machines: machines.length })
  })
  return out
}

export function initials(name: string) {
  const parts = name.replace(/@.*/, '').trim().split(/[\s._-]+/).filter(Boolean)
  if (parts.length === 0) return '?'
  // Thai names: first grapheme of first name (+ of last name when present)
  // Skip Thai leading vowels (เ แ โ ใ ไ) so "เกียรติ" gives "ก", not "เ".
  const first = (s: string) => Array.from(s.replace(/^[\u0E40-\u0E44]/, ''))[0] ?? ''
  return (first(parts[0]) + (parts[1] ? first(parts[1]) : '')).toUpperCase()
}

// Stable avatar hue per person.
export function personHue(id: string) {
  let h = 7
  for (const c of id) h = (h * 33 + c.charCodeAt(0)) % 360
  return h
}


// 7-day workload tone (staffing report).
export function workloadTone(pct: number) {
  return pct > 100 ? 'text-status-risk' : pct >= 80 ? 'text-status-paused' : 'text-status-done'
}

// Capacity a machine still has today: its shift minutes today minus the planned minutes of the
// cards that start on it today (same rule as api.machine_load). leftPct is null when the machine
// has no shift today; overPct > 0 when today's cards need more than the shift.
export type MachineToday = {
  availMin: number
  plannedMin: number
  cards: number
  leftMin: number
  leftPct: number | null
  overPct: number
}

const OPEN = new Set(['pending', 'ready', 'in_progress', 'paused'])

export function machineToday(steps: BoardStep[], rows: LoadRow[]): Map<string, MachineToday> {
  const today = localDate()
  const out = new Map<string, MachineToday>()
  const get = (id: string) => {
    let v = out.get(id)
    if (!v) out.set(id, (v = { availMin: 0, plannedMin: 0, cards: 0, leftMin: 0, leftPct: null, overPct: 0 }))
    return v
  }
  rows.forEach((r) => {
    if (r.day === today) get(r.machine_id).availMin = Number(r.available_min)
  })
  steps.forEach((s) => {
    if (!s.machine_id || !s.planned_start || s.job.status !== 'in_production' || !OPEN.has(s.status)) return
    const d = new Date(s.planned_start)
    const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    if (day !== today) return
    const v = get(s.machine_id)
    v.cards += 1
    v.plannedMin += Number(s.est_minutes ?? 0)
  })
  out.forEach((v) => {
    if (v.availMin <= 0) return
    const used = (v.plannedMin / v.availMin) * 100
    v.leftMin = Math.max(v.availMin - v.plannedMin, 0)
    v.leftPct = Math.max(Math.round(100 - used), 0)
    v.overPct = used > 100 ? Math.round(used - 100) : 0
  })
  return out
}

// Plenty left = green, 20% or less = amber, full or over = red. No shift = muted.
export function capacityTone(c?: MachineToday) {
  if (!c || c.leftPct == null) return 'text-muted'
  return c.overPct > 0 || c.leftPct === 0 ? 'text-status-risk' : c.leftPct <= 20 ? 'text-status-paused' : 'text-status-done'
}

export function capacityBar(c?: MachineToday) {
  if (!c || c.leftPct == null) return 'bg-surface-2'
  return c.overPct > 0 || c.leftPct === 0 ? 'bg-status-risk' : c.leftPct <= 20 ? 'bg-status-paused' : 'bg-status-done'
}

type T = (k: string, o?: Record<string, unknown>) => string
const hrs = (t: T, min: number) => t('capacity.h', { h: (Math.round((min / 60) * 10) / 10).toLocaleString() })

// Short label: "ว่าง 63%", "เต็ม", "เกิน 25%", "ไม่มีกะ".
export function capacityLabel(t: T, c?: MachineToday) {
  if (!c || c.leftPct == null) return t('capacity.noShift')
  if (c.overPct > 0) return t('capacity.over', { p: c.overPct })
  if (c.leftPct === 0) return t('capacity.full')
  return t('capacity.left', { p: c.leftPct })
}

// Tooltip: "วันนี้ กะ 8 ชม. · งาน 3 การ์ด 3 ชม. · ว่าง 5 ชม. (63%)".
export function capacityTitle(t: T, c?: MachineToday) {
  if (!c || c.leftPct == null) return t('capacity.titleNoShift', { n: c?.cards ?? 0 })
  return t('capacity.title', {
    a: hrs(t, c.availMin),
    n: c.cards,
    w: hrs(t, c.plannedMin),
    rest: c.overPct > 0 ? t('capacity.overBy', { h: hrs(t, c.plannedMin - c.availMin), p: c.overPct }) : t('capacity.leftBy', { h: hrs(t, c.leftMin), p: c.leftPct }),
  })
}
