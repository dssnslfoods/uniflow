import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Building2, Lock, Mail, Plus, UserPlus } from 'lucide-react'
import { useAuth } from '@/app/auth'
import type { Role } from '@/lib/claims'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Select } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { formatDate } from '../orders/format'
import { availableModules, type ModuleKey } from '../settings/api'
import { RolePicker } from '../settings/members-tab'
import {
  useAdminCreateTenant,
  useAdminInvite,
  useAdminMembers,
  useAdminSetMember,
  useAdminSetModules,
  useAdminTenants,
  type AdminMember,
  type AdminTenant,
} from './api'

const plans = ['trial', 'starter', 'pro', 'business']
// Planned modules, shown so the operator sees the full menu of topics.
const upcoming: ModuleKey[] = ['costing', 'reports']

// Super admin: per shop, who runs it (its admins) and which topics it uses.
export function AdminUsersPage({ shop }: { shop?: string }) {
  const { t } = useTranslation()
  const { claims } = useAuth()
  const navigate = useNavigate()
  const tenants = useAdminTenants(!!claims?.platform_admin)
  const [creating, setCreating] = useState(false)

  if (!claims?.platform_admin) return <ErrorNote>{t('errors.auth.forbidden')}</ErrorNote>
  if (tenants.isLoading) return <ListSkeleton />
  if (tenants.error) return <ErrorNote>{errorMessage(tenants.error)}</ErrorNote>
  const list = tenants.data ?? []
  const current = list.find((x) => x.tenant_id === shop) ?? list[0]
  const pick = (id: string) => navigate({ to: '/admin/users', search: { shop: id } })

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('adminUsers.title')}
        subtitle={t('adminUsers.subtitle')}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {list.length > 0 && (
              <Select aria-label={t('adminUsers.shop')} className="w-64" value={current?.tenant_id} onChange={(e) => pick(e.target.value)}>
                {list.map((x) => <option key={x.tenant_id} value={x.tenant_id}>{x.name}</option>)}
              </Select>
            )}
            <Button onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />{t('adminUsers.newShop')}</Button>
          </div>
        }
      />

      {!current ? (
        <EmptyState Icon={Building2} title={t('admin.empty')} hint={t('adminUsers.subtitle')} actionLabel={t('adminUsers.newShop')} onAction={() => setCreating(true)} />
      ) : (
        <div className="flex flex-col gap-6">
          <ShopSummary shop={current} />
          <ModulesSection key={`m-${current.tenant_id}`} shop={current} />
          <MembersSection key={`u-${current.tenant_id}`} shop={current} />
        </div>
      )}

      {creating && <CreateShopDrawer onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); pick(id) }} />}
    </div>
  )
}

function ShopSummary({ shop }: { shop: AdminTenant }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-[var(--radius-card)] border border-border bg-surface px-5 py-3 text-sm">
      <span className="font-semibold">{shop.name}</span>
      <span className="text-muted">{t('admin.plan')}: <span className="text-fg">{shop.plan_id}</span></span>
      <span className="text-muted">{t('admin.status')}: <span className="text-fg">{t(`admin.tenantStatus.${shop.status}`)}</span></span>
      <span className="text-muted">{t('admin.kpi.users')}: <span className="tabular text-fg">{shop.members}</span></span>
      <span className="text-muted">{formatDate(shop.created_at)}</span>
    </div>
  )
}

// Topics: the core flow is always on; each optional module switches on its own pages and commands.
function ModulesSection({ shop }: { shop: AdminTenant }) {
  const { t } = useTranslation()
  const toast = useToast()
  const setModules = useAdminSetModules()

  function toggle(m: ModuleKey) {
    const next = shop.modules.includes(m) ? shop.modules.filter((k) => k !== m) : [...shop.modules, m]
    setModules.mutate(
      { id: shop.tenant_id, modules: next },
      {
        onSuccess: () => toast({ tone: 'success', message: `${t('module.saved')} · ${shop.name}` }),
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <section>
      <h2 className="mb-1 font-semibold">{t('module.title')}</h2>
      <p className="mb-3 text-sm text-muted">{t('adminUsers.modulesHint')}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <ModuleCard title={t('module.core')} desc={t('module.desc.core')} state="always" />
        {availableModules.map((m) => (
          <ModuleCard key={m} title={t(`module.${m}`)} desc={t(`module.desc.${m}`)} state={shop.modules.includes(m) ? 'on' : 'off'}
            busy={setModules.isPending} onToggle={() => toggle(m)} />
        ))}
        {upcoming.map((m) => <ModuleCard key={m} title={t(`module.${m}`)} desc={t(`module.desc.${m}`)} state="soon" />)}
      </div>
    </section>
  )
}

function ModuleCard({ title, desc, state, busy, onToggle }: {
  title: string; desc: string; state: 'always' | 'on' | 'off' | 'soon'; busy?: boolean; onToggle?: () => void
}) {
  const { t } = useTranslation()
  const on = state === 'on' || state === 'always'
  return (
    <div className={cn('flex items-start gap-3 rounded-[var(--radius-card)] border bg-surface p-4',
      on ? 'border-brand/40' : 'border-border', state === 'soon' && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <div className="font-medium">{title}</div>
        <p className="mt-0.5 text-xs text-muted">{desc}</p>
      </div>
      {state === 'always' && <Lock className="mt-0.5 size-4 text-muted" aria-label={t('module.core')} />}
      {state === 'soon' && <span className="rounded bg-surface-2 px-1.5 text-[11px] text-muted">{t('nav.soon')}</span>}
      {(state === 'on' || state === 'off') && (
        <button type="button" role="switch" aria-checked={on} aria-label={title} disabled={busy} onClick={onToggle}
          className={cn('relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60', on ? 'bg-brand' : 'bg-border')}>
          <span className={cn('absolute top-0.5 size-5 rounded-full bg-white shadow transition-all', on ? 'left-[22px]' : 'left-0.5')} />
        </button>
      )}
    </div>
  )
}

function MembersSection({ shop }: { shop: AdminTenant }) {
  const { t } = useTranslation()
  const members = useAdminMembers(shop.tenant_id)
  const admins = (members.data ?? []).filter((m) => m.is_active && m.roles.includes('admin')).length

  return (
    <section>
      <h2 className="mb-1 font-semibold">{t('adminUsers.users')}</h2>
      <p className="mb-3 text-sm text-muted">{t('adminUsers.usersHint')}</p>
      <InviteForm shop={shop} />
      {members.isLoading ? <ListSkeleton rows={3} /> : members.error ? <ErrorNote>{errorMessage(members.error)}</ErrorNote> : (
        (members.data ?? []).length === 0 ? (
          <p className="mt-3 rounded-[var(--radius-card)] border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{t('adminUsers.noUsers')}</p>
        ) : (
          <ul className="mt-3 overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
            {members.data!.map((m, i) => <MemberRow key={m.membership_id} member={m} first={i === 0} lastAdmin={admins <= 1 && m.roles.includes('admin') && m.is_active} />)}
          </ul>
        )
      )}
    </section>
  )
}

function InviteForm({ shop }: { shop: AdminTenant }) {
  const { t } = useTranslation()
  const toast = useToast()
  const invite = useAdminInvite()
  const [email, setEmail] = useState('')
  const [roles, setRoles] = useState<Role[]>(['admin'])

  function submit(e: FormEvent) {
    e.preventDefault()
    invite.mutate(
      { tenantId: shop.tenant_id, email, roles },
      {
        onSuccess: (r) => {
          toast({ tone: 'success', message: r.invited ? t('adminUsers.invited', { email }) : t('adminUsers.added', { email }) })
          setEmail('')
          setRoles(['admin'])
        },
        onError: (er) => toast({ tone: 'error', message: errorMessage(er) }),
      },
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={t('auth.email')} className="min-w-64 flex-1">
          {(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@shop.co.th" />}
        </Field>
        <Button type="submit" loading={invite.isPending} disabled={roles.length === 0}>
          <UserPlus className="size-4" aria-hidden />{t('adminUsers.invite')}
        </Button>
      </div>
      <RolePicker value={roles} onChange={setRoles} />
      <p className="text-xs text-muted">{t('adminUsers.inviteHint')}</p>
    </form>
  )
}

function MemberRow({ member, first, lastAdmin }: { member: AdminMember; first: boolean; lastAdmin: boolean }) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useAdminSetMember()
  const [roles, setRoles] = useState<Role[]>(member.roles)
  const changed = roles.join() !== member.roles.join()

  function apply(next: { roles?: Role[]; active?: boolean }) {
    save.mutate(
      { id: member.membership_id, roles: next.roles ?? member.roles, active: next.active ?? member.is_active },
      {
        onSuccess: () => toast({ tone: 'success', message: t('common.saved') }),
        onError: (e) => {
          setRoles(member.roles)
          toast({ tone: 'error', message: errorMessage(e) })
        },
      },
    )
  }

  return (
    <li className={cn('flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center', !first && 'border-t border-border', !member.is_active && 'opacity-60')}>
      <div className="min-w-0 sm:w-64">
        <div className="truncate font-medium">{member.full_name || member.email}</div>
        <div className="flex items-center gap-1.5 truncate text-xs text-muted">
          {member.full_name && <span className="truncate">{member.email}</span>}
          {!member.is_active ? (
            <span className="rounded bg-surface-2 px-1.5">{t('adminUsers.inactive')}</span>
          ) : member.invited_pending ? (
            <span className="inline-flex items-center gap-1 rounded bg-status-paused/10 px-1.5 text-status-paused"><Mail className="size-3" aria-hidden />{t('adminUsers.pending')}</span>
          ) : (
            <span>{t('adminUsers.lastSeen', { d: formatDate(member.last_sign_in_at) })}</span>
          )}
        </div>
      </div>
      <div className="flex-1"><RolePicker value={roles} onChange={setRoles} disabled={save.isPending} /></div>
      <div className="flex shrink-0 gap-2">
        {changed && <Button size="sm" onClick={() => apply({ roles })} loading={save.isPending} disabled={roles.length === 0}>{t('common.save')}</Button>}
        <Button size="sm" variant="ghost" disabled={save.isPending || (member.is_active && lastAdmin)}
          title={member.is_active && lastAdmin ? t('errors.member.last_admin') : undefined}
          onClick={() => apply({ active: !member.is_active })}>
          {member.is_active ? t('adminUsers.deactivate') : t('adminUsers.reactivate')}
        </Button>
      </div>
    </li>
  )
}

function CreateShopDrawer({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const create = useAdminCreateTenant()
  const invite = useAdminInvite()
  const [name, setName] = useState('')
  const [plan, setPlan] = useState('trial')
  const [modules, setModules] = useState<ModuleKey[]>(['outsource', 'delivery', 'inventory'])
  const [email, setEmail] = useState('')

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const id = await create.mutateAsync({ name, plan, modules })
      if (email.trim()) {
        const r = await invite.mutateAsync({ tenantId: id, email: email.trim(), roles: ['admin'] })
        toast({ tone: 'success', message: `${t('adminUsers.created', { name })} · ${r.invited ? t('adminUsers.invited', { email }) : t('adminUsers.added', { email })}` })
      } else {
        toast({ tone: 'success', message: t('adminUsers.created', { name }) })
      }
      onCreated(id)
    } catch (er) {
      toast({ tone: 'error', message: errorMessage(er) })
    }
  }

  return (
    <Drawer open title={t('adminUsers.newShop')} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="new-shop" loading={create.isPending || invite.isPending}>{t('adminUsers.create')}</Button></>}>
      <form id="new-shop" onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('settings.shopName')}>{(id) => <Input id={id} required autoFocus value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <Field label={t('admin.plan')}>
          {(id) => <Select id={id} value={plan} onChange={(e) => setPlan(e.target.value)}>{plans.map((p) => <option key={p} value={p}>{p}</option>)}</Select>}
        </Field>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t('module.title')}</legend>
          {availableModules.map((m) => (
            <label key={m} className="flex items-start gap-2.5 text-sm">
              <input type="checkbox" className="mt-0.5 accent-[var(--brand)]" checked={modules.includes(m)}
                onChange={(e) => setModules(e.target.checked ? [...modules, m] : modules.filter((x) => x !== m))} />
              <span><span className="font-medium">{t(`module.${m}`)}</span><span className="block text-xs text-muted">{t(`module.desc.${m}`)}</span></span>
            </label>
          ))}
        </fieldset>
        <Field label={t('adminUsers.firstAdmin')} hint={t('adminUsers.firstAdminHint')}>
          {(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="admin@shop.co.th" />}
        </Field>
      </form>
    </Drawer>
  )
}
