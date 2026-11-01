import { Suspense, useState, type ButtonHTMLAttributes } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, Building2, UserCog, CheckCheck, FileCheck2, Settings, Send, Truck, Factory, FileText, Gauge, Hammer, KanbanSquare, Languages, Layers, LifeBuoy, LogOut, Moon, Package, Sun, Users, Workflow } from 'lucide-react'
import { useAuth } from './auth'
import { useMyTenants, useSupportSession, useSwitchTenant } from '@/modules/platform/api'
import { usePendingApprovals } from '@/modules/production/api'
import { NotificationBell } from '@/modules/notifications/notification-bell'
import { useTenantRealtime } from './realtime'
import { useModules, type ModuleKey } from '@/modules/settings/api'
import { ListSkeleton } from '@/shared/ui/page'
import { setLanguage } from '@/shared/i18n'
import { useToast } from '@/shared/ui/toast'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

type NavItem = { to: string; key: string; Icon: typeof Factory; soon?: boolean; module?: ModuleKey }

const navGroups: { key?: string; items: NavItem[] }[] = [
  {
    items: [
      { to: '/dashboard', key: 'dashboard', Icon: Gauge },
      { to: '/board', key: 'board', Icon: KanbanSquare },
      { to: '/floor', key: 'floor', Icon: Hammer },
      { to: '/proofs', key: 'proofs', Icon: FileCheck2, module: 'proof' },
      { to: '/outsource', key: 'outsource', Icon: Send, module: 'outsource' },
      { to: '/deliveries', key: 'deliveries', Icon: Truck, module: 'delivery' },
      { to: '/inventory', key: 'inventory', Icon: Package, module: 'inventory' },
      { to: '/orders', key: 'orders', Icon: FileText },
      { to: '/approvals', key: 'approvals', Icon: CheckCheck },
    ],
  },
  {
    key: 'masters',
    items: [
      { to: '/customers', key: 'customers', Icon: Users },
      { to: '/machines', key: 'machines', Icon: Factory },
      { to: '/processes', key: 'processes', Icon: Workflow },
      { to: '/templates', key: 'templates', Icon: Layers },
      { to: '/settings', key: 'settings_page', Icon: Settings },
    ],
  },
]

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.dataset.theme === 'dark'
    || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches))
  const toggle = () => {
    const next = !dark
    document.documentElement.dataset.theme = next ? 'dark' : 'light'
    setDark(next)
  }
  return { dark, toggle }
}

export function AppShell() {
  const { t, i18n } = useTranslation()
  const auth = useAuth()
  const tenants = useMyTenants()
  const switchTenant = useSwitchTenant()
  const toast = useToast()
  const theme = useTheme()
  const current = tenants.data?.find((x) => x.tenant_id === auth.claims?.tenant_id)
  const pending = usePendingApprovals(auth.hasRole('manager'))
  const badges: Record<string, number> = { approvals: pending.data?.length ?? 0 }
  const support = useSupportSession()
  useTenantRealtime()
  const isPlatformAdmin = !!auth.claims?.platform_admin
  const hasTenant = !!auth.claims?.tenant_id
  // Platform admins without a tenant see only the console and the manual; with one, the console is added at the end.
  const modules = useModules()
  const shopGroups = navGroups.map((g) => ({ ...g, items: g.items.filter((i) => !i.module || modules.has(i.module)) }))
  const groups = [
    ...(hasTenant ? shopGroups : []),
    { key: 'help', items: [{ to: '/manual', key: 'manual', Icon: BookOpen }] },
    ...(isPlatformAdmin ? [{ key: 'platform', items: [{ to: '/admin', key: 'admin', Icon: Building2 }, { to: '/admin/users', key: 'adminUsers', Icon: UserCog }] }] : []),
  ]

  return (
    <div className="flex min-h-full flex-col md:flex-row">
      <aside className="flex shrink-0 flex-col gap-1 print:hidden border-b border-border bg-surface px-3 py-3 md:sticky md:top-0 md:h-screen md:w-60 md:border-b-0 md:border-r">
        <div className="flex items-center gap-2 px-2 pb-3">
          <div className="grid size-8 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-fg">U</div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-tight">{t('app.name')}</div>
            <div className="truncate text-xs text-muted">{current?.name ?? '—'}</div>
          </div>
          {hasTenant && <NotificationBell />}
        </div>

        <nav className="flex gap-1 overflow-x-auto md:flex-col">
          {groups.map((group, gi) => (
            <div key={gi} className="flex gap-1 md:flex-col">
              {group.key && (
                <div className="hidden px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted md:block">
                  {t(`nav.${group.key}`)}
                </div>
              )}
              {group.items.map(({ to, key, Icon, soon }) =>
                soon ? (
                  <span key={key} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-muted/70" aria-disabled>
                    <Icon className="size-4" aria-hidden />
                    <span className="flex-1 whitespace-nowrap">{t(`nav.${key}`)}</span>
                    <span className="rounded bg-surface-2 px-1.5 text-[10px]">{t('nav.soon')}</span>
                  </span>
                ) : (
                  <Link
                    key={key}
                    to={to}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-fg hover:bg-surface-2"
                    activeProps={{ className: 'bg-surface-2 font-medium' }}
                  >
                    <Icon className="size-4" aria-hidden />
                    <span className="flex-1 whitespace-nowrap">{t(`nav.${key}`)}</span>
                    {badges[key] > 0 && (
                      <span className="tabular rounded-full bg-status-paused px-1.5 text-[11px] font-semibold text-white">{badges[key]}</span>
                    )}
                  </Link>
                ),
              )}
            </div>
          ))}
        </nav>

        <div className="mt-auto hidden flex-col gap-2 border-t border-border pt-3 md:flex">
          {tenants.data && tenants.data.length > 1 && (
            <label className="flex flex-col gap-1 px-1 text-xs text-muted">
              {t('tenant.switch')}
              <select
                className="h-8 rounded-lg border border-border bg-surface px-2 text-sm text-fg"
                value={auth.claims?.tenant_id ?? ''}
                disabled={switchTenant.isPending}
                onChange={(e) =>
                  switchTenant.mutate(e.target.value, {
                    onError: (err) => toast({ tone: 'error', message: errorMessage(err) }),
                  })
                }
              >
                {tenants.data.map((x) => (
                  <option key={x.tenant_id} value={x.tenant_id}>
                    {x.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="flex items-center gap-1 px-1">
            <IconButton label="language" onClick={() => setLanguage(i18n.language === 'th' ? 'en' : 'th')}>
              <Languages className="size-4" />
              <span className="text-xs font-medium uppercase">{i18n.language}</span>
            </IconButton>
            <IconButton label="theme" onClick={theme.toggle}>
              {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
            </IconButton>
            <IconButton label={t('auth.signOut')} onClick={auth.signOut} className="ml-auto">
              <LogOut className="size-4" />
            </IconButton>
          </div>
          <div className="truncate px-1 text-xs text-muted">
            {auth.session?.user.email} · {auth.claims?.roles.map((r) => t(`role.${r}`)).join(', ')}
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 print:p-0">
        {current?.is_support && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-status-paused/40 bg-status-paused/10 px-4 py-2.5 text-sm text-status-paused">
            <LifeBuoy className="size-4" aria-hidden />
            <span className="flex-1">{t('admin.supportBanner', { name: current.name })}</span>
            <button
              className="font-semibold underline-offset-2 hover:underline"
              onClick={() => support.mutate({ tenantId: current.tenant_id, leave: true })}
            >
              {t('admin.leave')}
            </button>
          </div>
        )}
        <Suspense fallback={<ListSkeleton />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  )
}

function IconButton({
  label,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cn('flex h-8 items-center gap-1 rounded-lg px-2 text-muted hover:bg-surface-2 hover:text-fg', className)}
      {...props}
    />
  )
}
