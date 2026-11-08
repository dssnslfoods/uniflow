import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useDraggable, useDroppable } from '@dnd-kit/core'
import { Check, Factory, UserMinus, UsersRound, X } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useTenantKey } from '@/shared/data'
import type { Member } from '../settings/api'
import type { Machine } from '../masters/machines/api'
import { formatMinutes } from './api'
import { initials, personHue, workloadTone, type PersonLoad } from './workload'

// Drag ids/data for people. Cards use plain step ids; people are prefixed so the two never mix.
export type PersonDrag = { kind: 'person'; membershipId: string; from: string | null }
export type PersonDrop = { kind: 'person'; machineId: string | null }
export const personDragId = (membershipId: string, from: string | null) => `person:${membershipId}:${from ?? ''}`
export const STAFF_STRIP = 'staffdrop:'
export const staffDropId = (machineId: string) => `staffdrop:${machineId}`

// One person, one machine: putting someone on a machine moves them there (to = null takes them off).
// api.assign_operator does it in one transaction and the database keeps the dated history.
export function useAssignOperator() {
  const qc = useQueryClient()
  const key = useTenantKey('members')
  return useMutation({
    mutationFn: async ({ membershipId, to }: { membershipId: string; to: string | null }) => {
      const { error } = await rpc().rpc('assign_operator', { p_membership: membershipId, p_machine: to })
      if (error) throw error
    },
    onMutate: async ({ membershipId, to }) => {
      await qc.cancelQueries({ queryKey: key })
      const prev = qc.getQueryData<Member[]>(key)
      qc.setQueryData<Member[]>(key, (list) =>
        list?.map((m) => (m.membership_id === membershipId ? { ...m, machine_ids: to ? [to] : [] } : m)),
      )
      return { prev }
    },
    onError: (_e, _v, ctx) => ctx?.prev && qc.setQueryData(key, ctx.prev),
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

export function displayName(m: Pick<Member, 'full_name' | 'email'>) {
  return m.full_name?.trim() || m.email.replace(/@.*/, '')
}

// Chip label: the name without a trailing "(…)" note, e.g. "พนักงาน 1 (เดโม)" → "พนักงาน 1".
function shortName(m: Pick<Member, 'full_name' | 'email'>) {
  return displayName(m).replace(/\s*\(.*\)\s*$/, '') || displayName(m)
}

function Avatar({ member, className }: { member: Member; className?: string }) {
  const hue = personHue(member.membership_id)
  return (
    <span
      aria-hidden
      className={cn('grid size-6 shrink-0 place-items-center rounded-full text-[10px] font-semibold text-white', className)}
      style={{ background: `hsl(${hue} 55% 45%)` }}
    >
      {initials(displayName(member))}
    </span>
  )
}

export function loadTitle(t: (k: string, o?: Record<string, unknown>) => string, name: string, load?: PersonLoad, machine?: string) {
  if (!load) return t('staff.unassigned', { name })
  return t('staff.loadTitle', {
    name,
    machine: machine ?? '',
    q: formatMinutes(t, load.queueMin),
    a: formatMinutes(t, load.availMin),
    p: Math.round(load.pct),
  })
}

type ChipProps = {
  member: Member
  load?: PersonLoad
  from: string | null
  draggable: boolean
  onRemove?: () => void
  onClick?: () => void
  compact?: boolean
  // The machine this person holds, shown as a tag (staff strip only).
  machine?: string
}

// A person pill: avatar, short name and their 7-day workload %. Long-press / drag to move.
export function PersonChip({ member, load, from, draggable, onRemove, onClick, compact, machine }: ChipProps) {
  const { t } = useTranslation()
  const data: PersonDrag = { kind: 'person', membershipId: member.membership_id, from }
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: personDragId(member.membership_id, from), data, disabled: !draggable })
  const name = displayName(member)
  return (
    <span
      ref={setNodeRef}
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-surface py-0.5 pl-0.5 text-xs shadow-sm',
        onRemove ? 'pr-0.5' : 'pr-2',
        draggable && 'cursor-grab active:cursor-grabbing',
        isDragging && 'opacity-30',
      )}
      title={loadTitle(t, name, load, machine)}
      {...attributes}
      {...listeners}
      onClick={onClick}
      role={onClick ? 'button' : attributes.role}
      aria-label={loadTitle(t, name, load, machine)}
    >
      <Avatar member={member} />
      {!compact && <span className="max-w-[7.5rem] truncate">{shortName(member)}</span>}
      {machine && (
        <span className="inline-flex max-w-[6rem] items-center gap-0.5 rounded-full bg-brand/10 px-1.5 text-[10px] text-brand" title={t('staff.onMachine', { machine })}>
          <Factory className="size-2.5 shrink-0" aria-hidden />
          <span className="truncate">{machine}</span>
        </span>
      )}
      {load && <span className={cn('tabular font-semibold', workloadTone(load.pct))}>{Math.round(load.pct)}%</span>}
      {onRemove && (
        <button
          type="button"
          className="grid size-5 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-status-risk pointer-coarse:size-7"
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation()
            onRemove()
          }}
          aria-label={t('staff.remove', { name })}
          title={t('staff.remove', { name })}
        >
          <X className="size-3" />
        </button>
      )}
    </span>
  )
}

// Floating copy shown under the finger/pointer while dragging.
export function PersonChipOverlay({ member, load }: { member: Member; load?: PersonLoad }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-brand bg-surface py-0.5 pl-0.5 pr-2 text-xs shadow-xl ring-2 ring-brand/30">
      <Avatar member={member} />
      <span className="max-w-[8rem] truncate">{shortName(member)}</span>
      {load && <span className={cn('tabular font-semibold', workloadTone(load.pct))}>{Math.round(load.pct)}%</span>}
    </span>
  )
}

type StripProps = {
  members: Member[]
  loads: Map<string, PersonLoad>
  machines: Machine[]
  canAssign: boolean
  dragging: boolean
  onPick: (membershipId: string, machineId: string | null) => void
}

// Everyone who can be put on a machine. Drop a person back here to take them off that machine.
export function StaffStrip({ members, loads, machines, canAssign, dragging, onPick }: StripProps) {
  const { t } = useTranslation()
  const data: PersonDrop = { kind: 'person', machineId: null }
  const { setNodeRef, isOver } = useDroppable({ id: STAFF_STRIP, data, disabled: !canAssign })
  const [menu, setMenu] = useState<string | null>(null)
  const opened = members.find((m) => m.membership_id === menu)
  const machineName = new Map(machines.map((m) => [m.id, m.name]))

  return (
    <div
      ref={setNodeRef}
      className={cn(
        'relative mb-3 flex items-center gap-2 rounded-lg border bg-surface px-2 py-1.5',
        dragging ? 'border-dashed border-brand/60' : 'border-border',
        isOver && 'bg-status-risk/5 ring-2 ring-status-risk/30',
      )}
      aria-label={t('staff.strip')}
    >
      <span className="flex shrink-0 items-center gap-1 px-1 text-xs text-muted">
        {dragging ? <UserMinus className="size-4 text-status-risk" aria-hidden /> : <UsersRound className="size-4" aria-hidden />}
        <span className="hidden sm:inline">{dragging ? t('staff.dropToRemove') : canAssign ? t('staff.hint') : t('staff.title')}</span>
      </span>
      <div className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto py-0.5">
        {members.length === 0 && <span className="text-xs text-muted">{t('staff.none')}</span>}
        {members.map((m) => (
          <PersonChip
            key={m.membership_id}
            member={m}
            load={loads.get(m.membership_id)}
            from={m.machine_ids[0] ?? null}
            machine={m.machine_ids[0] ? machineName.get(m.machine_ids[0]) ?? '—' : undefined}
            draggable={canAssign}
            onClick={canAssign ? () => setMenu((x) => (x === m.membership_id ? null : m.membership_id)) : undefined}
          />
        ))}
      </div>
      {opened && (
        <AssignMenu member={opened} machines={machines} onPick={(mid) => { onPick(opened.membership_id, mid); setMenu(null) }} onClose={() => setMenu(null)} />
      )}
    </div>
  )
}

// Keyboard/tap alternative to dragging: pick the one machine this person looks after.
function AssignMenu({ member, machines, onPick, onClose }: { member: Member; machines: Machine[]; onPick: (machineId: string | null) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const away = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    // Defer so the click that opened the menu does not close it.
    const id = setTimeout(() => document.addEventListener('pointerdown', away))
    document.addEventListener('keydown', esc)
    return () => {
      clearTimeout(id)
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [onClose])
  const current = member.machine_ids[0] ?? null
  const options: { id: string | null; name: string }[] = [...machines.map((m) => ({ id: m.id as string | null, name: m.name })), { id: null, name: t('staff.noMachine') }]
  return (
    <div ref={ref} role="dialog" aria-label={t('staff.menuTitle', { name: displayName(member) })}
      className="absolute left-2 top-full z-30 mt-1 w-72 max-w-[calc(100vw-3rem)] rounded-lg border border-border bg-surface p-1 text-sm shadow-xl">
      <p className="px-2 py-1 text-[11px] font-medium text-muted">{t('staff.menuTitle', { name: displayName(member) })}</p>
      <div role="radiogroup">
        {options.map((o) => {
          const on = o.id === current
          return (
            <button key={o.id ?? 'none'} type="button" role="radio" aria-checked={on}
              onClick={() => (on ? onClose() : onPick(o.id))}
              className={cn('flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-surface-2 pointer-coarse:py-2.5', o.id === null && 'mt-1 border-t border-border text-muted')}>
              <span className={cn('grid size-4 place-items-center rounded-full border', on ? 'border-brand bg-brand text-white' : 'border-border')}>
                {on && <Check className="size-3" aria-hidden />}
              </span>
              <span className="min-w-0 flex-1 truncate">{o.name}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// Drop target covering a whole machine column while a person is being dragged.
export function useStaffDrop(machineId: string | null, enabled: boolean) {
  const data: PersonDrop = { kind: 'person', machineId }
  return useDroppable({ id: machineId ? staffDropId(machineId) : 'staffdrop:none', data, disabled: !enabled || !machineId })
}
