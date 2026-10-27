import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { Building2, LogIn, LogOut, Search, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { formatDate } from '../orders/format'
import { useAdminTenants, useAdminUpdateTenant, useSupportSession, type AdminTenant } from './api'

const plans = ['trial', 'starter', 'pro', 'business']
const statuses: AdminTenant['status'][] = ['trial', 'active', 'suspended', 'closed']

// SaaS operator console: every print shop on the platform (platform_admin only).
export function AdminTenantsPage() {
  const { t } = useTranslation()
  const { claims } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const tenants = useAdminTenants(!!claims?.platform_admin)
  const update = useAdminUpdateTenant()
  const support = useSupportSession()
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = tenants.data ?? []
    return q ? all.filter((x) => `${x.name} ${x.owner_email ?? ''}`.toLowerCase().includes(q)) : all
  }, [tenants.data, query])

  if (!claims?.platform_admin) return <ErrorNote>{t('errors.auth.forbidden')}</ErrorNote>

  const totals = (tenants.data ?? []).reduce(
    (acc, x) => ({ shops: acc.shops + 1, users: acc.users + x.members, machines: acc.machines + x.machines, jobs: acc.jobs + x.active_jobs }),
    { shops: 0, users: 0, machines: 0, jobs: 0 },
  )

  function change(id: string, patch: { plan?: string; status?: AdminTenant['status'] }) {
    update.mutate(
      { id, ...patch },
      {
        onSuccess: () => toast({ tone: 'success', message: t('common.saved') }),
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  function enter(x: AdminTenant) {
    support.mutate(
      { tenantId: x.tenant_id },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: t('admin.entered', { name: x.name }) })
          navigate({ to: '/orders' })
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  function leave(x: AdminTenant) {
    support.mutate(
      { tenantId: x.tenant_id, leave: true },
      { onError: (e) => toast({ tone: 'error', message: errorMessage(e) }) },
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('admin.title')}
        subtitle={t('admin.subtitle')}
        actions={
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} className="w-64 pl-9" aria-label={t('common.search')} />
          </div>
        }
      />

      <dl className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(
          [
            ['shops', totals.shops],
            ['users', totals.users],
            ['machines', totals.machines],
            ['jobs', totals.jobs],
          ] as const
        ).map(([k, v]) => (
          <div key={k} className="rounded-[var(--radius-card)] border border-border bg-surface px-4 py-3">
            <dt className="text-xs text-muted">{t(`admin.kpi.${k}`)}</dt>
            <dd className="tabular mt-1 text-2xl font-semibold">{v.toLocaleString()}</dd>
          </div>
        ))}
      </dl>

      {tenants.isLoading ? (
        <ListSkeleton />
      ) : tenants.error ? (
        <ErrorNote>{errorMessage(tenants.error)}</ErrorNote>
      ) : rows.length === 0 ? (
        <EmptyState Icon={Building2} title={t('admin.empty')} hint={t('admin.emptyHint')} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-full min-w-[860px] text-left">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('admin.shop')}</th>
                <th className="px-4 py-2.5 font-medium">{t('admin.plan')}</th>
                <th className="px-4 py-2.5 font-medium">{t('admin.status')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('admin.kpi.users')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('admin.kpi.machines')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('admin.openOrders')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('admin.kpi.jobs')}</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((x) => (
                <tr key={x.tenant_id} className={cn('border-t border-border', x.supporting && 'bg-status-paused/5')}>
                  <td className="px-4 py-3">
                    <div className="font-medium">{x.name}</div>
                    <div className="text-xs text-muted">{x.owner_email ?? '—'} · {formatDate(x.created_at)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <Select aria-label={t('admin.plan')} className="h-8 w-28 text-xs" value={x.plan_id} onChange={(e) => change(x.tenant_id, { plan: e.target.value })}>
                      {plans.map((p) => <option key={p} value={p}>{p}</option>)}
                    </Select>
                  </td>
                  <td className="px-4 py-3">
                    <Select
                      aria-label={t('admin.status')}
                      className={cn('h-8 w-32 text-xs', (x.status === 'suspended' || x.status === 'closed') && 'border-status-risk text-status-risk')}
                      value={x.status}
                      onChange={(e) => change(x.tenant_id, { status: e.target.value as AdminTenant['status'] })}
                    >
                      {statuses.map((s) => <option key={s} value={s}>{t(`admin.tenantStatus.${s}`)}</option>)}
                    </Select>
                  </td>
                  <td className="tabular px-4 py-3 text-right">{x.members}</td>
                  <td className="tabular px-4 py-3 text-right">{x.machines}</td>
                  <td className="tabular px-4 py-3 text-right">{x.open_orders}</td>
                  <td className="tabular px-4 py-3 text-right">{x.active_jobs}</td>
                  <td className="px-4 py-3 text-right">
                    {x.supporting ? (
                      <Button variant="ghost" size="sm" onClick={() => leave(x)} loading={support.isPending}>
                        <LogOut className="size-3.5" aria-hidden />
                        {t('admin.leave')}
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => enter(x)}
                        loading={support.isPending}
                        disabled={x.status === 'suspended' || x.status === 'closed'}
                      >
                        <LogIn className="size-3.5" aria-hidden />
                        {t('admin.enter')}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 flex items-center gap-1.5 text-xs text-muted">
        <ShieldCheck className="size-3.5" aria-hidden />
        {t('admin.auditNote')}
      </p>
    </div>
  )
}
