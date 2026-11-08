import type { LoadRow } from './api'

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

export function workloadTone(pct: number) {
  return pct > 100 ? 'text-status-risk' : pct >= 80 ? 'text-status-paused' : 'text-status-done'
}
