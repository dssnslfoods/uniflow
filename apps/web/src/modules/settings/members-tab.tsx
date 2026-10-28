import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, LifeBuoy, Mail, UserPlus } from 'lucide-react'
import { useAuth } from '@/app/auth'
import type { Role } from '@/lib/claims'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input } from '@/shared/ui/input'
import { ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useMachines } from '../masters/machines/api'
import { useInviteMember, useMembers, useSetMemberRoles, useSetOperatorMachines, type Member } from './api'

const allRoles: Role[] = ['admin', 'executive', 'manager', 'supervisor', 'staff']

function RolePicker({ value, onChange, disabled }: { value: Role[]; onChange: (r: Role[]) => void; disabled?: boolean }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap gap-1.5">
      {allRoles.map((r) => {
        const on = value.includes(r)
        return (
          <button
            key={r}
            type="button"
            disabled={disabled}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== r) : [...value, r])}
            className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs disabled:opacity-60',
              on ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-fg',
            )}
          >
            {on && <Check className="size-3" aria-hidden />}
            {t(`role.${r}`)}
          </button>
        )
      })}
    </div>
  )
}

export function MembersTab() {
  const { t } = useTranslation()
  const { hasRole, session } = useAuth()
  const members = useMembers()
  const machines = useMachines()
  const [inviting, setInviting] = useState(false)
  const [editing, setEditing] = useState<Member | null>(null)
  const isAdmin = hasRole('admin')
  const canAssign = hasRole('admin', 'manager', 'supervisor')
  const machineName = new Map((machines.data ?? []).map((m) => [m.id, m.name]))

  if (members.isLoading) return <ListSkeleton />
  if (members.error) return <ErrorNote>{errorMessage(members.error)}</ErrorNote>

  return (
    <div className="flex flex-col gap-4">
      {isAdmin && (
        <div className="flex justify-end">
          <Button onClick={() => setInviting(true)}>
            <UserPlus className="size-4" aria-hidden />
            {t('settings.invite')}
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
        {(members.data ?? []).map((m, i) => (
          <button
            key={m.membership_id}
            type="button"
            disabled={!canAssign || m.is_support}
            onClick={() => setEditing(m)}
            className={cn(
              'flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 disabled:cursor-default disabled:hover:bg-transparent',
              i > 0 && 'border-t border-border',
              !m.is_active && 'opacity-50',
            )}
          >
            <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand/10 text-sm font-semibold text-brand">
              {(m.full_name ?? m.email).slice(0, 1).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">
                {m.full_name ?? m.email}
                {m.user_id === session?.user.id && <span className="ml-1.5 text-xs text-muted">({t('settings.you')})</span>}
              </div>
              <div className="truncate text-xs text-muted">{m.email}</div>
            </div>
            <div className="flex flex-wrap gap-1">
              {m.is_support ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-status-paused/10 px-2 py-0.5 text-xs text-status-paused">
                  <LifeBuoy className="size-3" aria-hidden />{t('settings.support')}
                </span>
              ) : (
                m.roles.map((r) => <span key={r} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{t(`role.${r}`)}</span>)
              )}
            </div>
            {m.machine_ids.length > 0 && (
              <div className="w-full pl-12 text-xs text-muted">
                {t('settings.machines')}: {m.machine_ids.map((id) => machineName.get(id)).filter(Boolean).join(', ')}
              </div>
            )}
          </button>
        ))}
      </div>

      {inviting && <InviteDrawer onClose={() => setInviting(false)} />}
      {editing && <MemberDrawer member={editing} isAdmin={isAdmin} onClose={() => setEditing(null)} />}
    </div>
  )
}

function InviteDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const invite = useInviteMember()
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<Role[]>(['staff'])

  function submit(e: FormEvent) {
    e.preventDefault()
    invite.mutate(
      { email: email.trim(), roles },
      {
        onSuccess: (r) => {
          toast({ tone: 'success', message: r.invited ? t('settings.invited', { email }) : t('settings.added', { email }) })
          onClose()
        },
      },
    )
  }

  return (
    <Drawer
      open
      title={t('settings.invite')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="invite-form" loading={invite.isPending} disabled={!email.trim() || roles.length === 0}>
            <Mail className="size-4" aria-hidden />
            {t('settings.invite')}
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">{t('settings.inviteHint')}</p>
        <Field label={t('settings.email')}>
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}
        </Field>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">{t('settings.roles')}</p>
          <RolePicker value={roles} onChange={setRoles} />
        </div>
        {invite.error && <ErrorNote>{errorMessage(invite.error)}</ErrorNote>}
      </form>
    </Drawer>
  )
}

function MemberDrawer({ member, isAdmin, onClose }: { member: Member; isAdmin: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const machines = useMachines()
  const setRolesM = useSetMemberRoles()
  const setMachinesM = useSetOperatorMachines()
  const [roles, setRoles] = useState<Role[]>(member.roles)
  const [active, setActive] = useState(member.is_active)
  const [machineIds, setMachineIds] = useState<string[]>(member.machine_ids)

  async function save() {
    try {
      if (isAdmin && (roles.join() !== member.roles.join() || active !== member.is_active)) {
        await setRolesM.mutateAsync({ id: member.membership_id, roles, active })
      }
      if (machineIds.slice().sort().join() !== member.machine_ids.slice().sort().join()) {
        await setMachinesM.mutateAsync({ membershipId: member.membership_id, machineIds })
      }
      toast({ tone: 'success', message: t('common.saved') })
      onClose()
    } catch (e) {
      toast({ tone: 'error', message: errorMessage(e) })
    }
  }

  return (
    <Drawer
      open
      title={member.full_name ?? member.email}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={save} loading={setRolesM.isPending || setMachinesM.isPending} disabled={roles.length === 0}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">{member.email}</p>
        <div>
          <p className="mb-1.5 text-[13px] font-medium">{t('settings.roles')}</p>
          <RolePicker value={roles} onChange={setRoles} disabled={!isAdmin} />
        </div>
        <div>
          <p className="mb-1 text-[13px] font-medium">{t('settings.machines')}</p>
          <p className="mb-2 text-xs text-muted">{t('settings.machinesHint')}</p>
          <div className="flex flex-wrap gap-1.5">
            {(machines.data ?? []).map((m) => {
              const on = machineIds.includes(m.id)
              return (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setMachineIds((ids) => (on ? ids.filter((x) => x !== m.id) : [...ids, m.id]))}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs',
                    on ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-fg',
                  )}
                >
                  {on && <Check className="size-3" aria-hidden />}
                  {m.name}
                </button>
              )
            })}
          </div>
        </div>
        {isAdmin && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="accent-[var(--brand)]" checked={active} onChange={(e) => setActive(e.target.checked)} />
            {active ? t('settings.active') : t('settings.inactive')}
          </label>
        )}
      </div>
    </Drawer>
  )
}
