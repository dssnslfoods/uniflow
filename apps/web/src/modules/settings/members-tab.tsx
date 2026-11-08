import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, KeyRound, LifeBuoy, Mail, UserMinus, UserPlus } from 'lucide-react'
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
import {
  useInviteMember, useMembers, useRemoveMember, useSendPasswordReset, useSetMemberName, useSetMemberPassword,
  useSetMemberRoles, useSetOperatorMachines, type Member,
} from './api'

const allRoles: Role[] = ['admin', 'executive', 'manager', 'supervisor', 'staff']

export function RolePicker({ value, onChange, disabled }: { value: Role[]; onChange: (r: Role[]) => void; disabled?: boolean }) {
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
      {editing && <MemberDrawer member={editing} isAdmin={isAdmin} isSelf={editing.user_id === session?.user.id} onClose={() => setEditing(null)} />}
    </div>
  )
}

function InviteDrawer({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const invite = useInviteMember()
  const [mode, setMode] = useState<'invite' | 'password'>('invite')
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [roles, setRoles] = useState<Role[]>(['staff'])
  const withPassword = mode === 'password'

  function submit(e: FormEvent) {
    e.preventDefault()
    invite.mutate(
      {
        email: email.trim(),
        roles,
        fullName: fullName.trim() || undefined,
        password: withPassword ? password : undefined,
      },
      {
        onSuccess: (r) => {
          const key = r.created ? 'settings.created' : r.invited ? 'settings.invited' : withPassword ? 'settings.addedExisting' : 'settings.added'
          toast({ tone: 'success', message: t(key, { email: email.trim() }) })
          onClose()
        },
      },
    )
  }

  const canSubmit = !!email.trim() && roles.length > 0 && (!withPassword || password.length >= 6)

  return (
    <Drawer
      open
      title={t('settings.invite')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="invite-form" loading={invite.isPending} disabled={!canSubmit}>
            {withPassword ? <UserPlus className="size-4" aria-hidden /> : <Mail className="size-4" aria-hidden />}
            {withPassword ? t('settings.createMember') : t('settings.invite')}
          </Button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className="flex flex-col gap-4">
        <div role="radiogroup" className="grid grid-cols-2 gap-1 rounded-[var(--radius-card)] border border-border bg-surface-2/50 p-1">
          {(['invite', 'password'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={mode === m}
              onClick={() => { setMode(m); invite.reset() }}
              className={cn(
                'inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm',
                mode === m ? 'bg-surface font-medium text-fg shadow-sm' : 'text-muted hover:text-fg',
              )}
            >
              {m === 'invite' ? <Mail className="size-4" aria-hidden /> : <KeyRound className="size-4" aria-hidden />}
              {m === 'invite' ? t('settings.byInvite') : t('settings.byPassword')}
            </button>
          ))}
        </div>
        <p className="text-sm text-muted">{withPassword ? t('settings.passwordModeHint') : t('settings.inviteHint')}</p>
        <Field label={t('settings.email')}>
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />}
        </Field>
        <Field label={t('auth.fullName')}>
          {(id) => <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="off" />}
        </Field>
        {withPassword && (
          <Field label={t('settings.initialPassword')}>
            {(id) => (
              <Input
                id={id}
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                minLength={6}
                required
                autoComplete="new-password"
                spellCheck={false}
              />
            )}
          </Field>
        )}
        <div>
          <p className="mb-1.5 text-[13px] font-medium">{t('settings.roles')}</p>
          <RolePicker value={roles} onChange={setRoles} />
        </div>
        {invite.error && <ErrorNote>{errorMessage(invite.error)}</ErrorNote>}
      </form>
    </Drawer>
  )
}

function MemberDrawer({ member, isAdmin, isSelf, onClose }: { member: Member; isAdmin: boolean; isSelf: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const machines = useMachines()
  const setRolesM = useSetMemberRoles()
  const setMachinesM = useSetOperatorMachines()
  const setNameM = useSetMemberName()
  const setPasswordM = useSetMemberPassword()
  const sendReset = useSendPasswordReset()
  const removeM = useRemoveMember()
  // Name and password belong to the login; change them only when no other shop shares it.
  const ownAccount = isAdmin && member.only_here
  const [fullName, setFullName] = useState(member.full_name ?? '')
  const [newPassword, setNewPassword] = useState('')
  const [roles, setRoles] = useState<Role[]>(member.roles)
  const [active, setActive] = useState(member.is_active)
  const [machineIds, setMachineIds] = useState<string[]>(member.machine_ids)

  async function save() {
    try {
      if (ownAccount && fullName.trim() !== (member.full_name ?? '')) {
        await setNameM.mutateAsync({ id: member.membership_id, fullName })
      }
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

  function setPassword() {
    setPasswordM.mutate({ id: member.membership_id, password: newPassword }, {
      onSuccess: () => { setNewPassword(''); toast({ tone: 'success', message: t('settings.passwordSet') }) },
      onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
    })
  }

  function reset() {
    sendReset.mutate(member.email, {
      onSuccess: () => toast({ tone: 'success', message: t('settings.resetSent', { email: member.email }) }),
      onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
    })
  }

  function remove() {
    if (!window.confirm(t('settings.removeConfirm', { name: member.full_name ?? member.email }))) return
    removeM.mutate(member.membership_id, {
      onSuccess: () => { toast({ tone: 'success', message: t('settings.removed') }); onClose() },
      onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
    })
  }

  return (
    <Drawer
      open
      title={member.full_name ?? member.email}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button onClick={save} loading={setRolesM.isPending || setMachinesM.isPending || setNameM.isPending} disabled={roles.length === 0}>{t('common.save')}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <p className="text-sm text-muted">{member.email}</p>
        {ownAccount && (
          <Field label={t('settings.memberName')}>
            {(id) => <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} />}
          </Field>
        )}
        {isAdmin && !member.only_here && <p className="rounded-lg bg-surface-2 px-3 py-2 text-xs text-muted">{t('settings.sharedAccount')}</p>}
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
        {isAdmin && !isSelf && (
          <section className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <p className="text-[13px] font-medium">{t('settings.passwordSection')}</p>
            <Button variant="secondary" size="sm" className="self-start" onClick={reset} loading={sendReset.isPending}>
              <Mail className="size-3.5" aria-hidden />{t('settings.sendReset')}
            </Button>
            {member.only_here && (
              <div className="flex flex-wrap items-end gap-2">
                <Field label={t('settings.setPassword')} className="min-w-48 flex-1">
                  {(id) => <Input id={id} type="text" autoComplete="off" minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder={t('settings.passwordMin')} />}
                </Field>
                <Button size="sm" onClick={setPassword} loading={setPasswordM.isPending} disabled={newPassword.length < 6}>
                  <KeyRound className="size-3.5" aria-hidden />{t('settings.setPasswordBtn')}
                </Button>
              </div>
            )}
          </section>
        )}
        {isAdmin && !isSelf && (
          <Button variant="ghost" className="self-start text-status-risk" onClick={remove} loading={removeM.isPending}>
            <UserMinus className="size-4" aria-hidden />{t('settings.removeMember')}
          </Button>
        )}
      </div>
    </Drawer>
  )
}
