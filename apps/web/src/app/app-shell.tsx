import { Suspense, useState, type ButtonHTMLAttributes } from 'react'
import { Link, Outlet } from '@tanstack/react-router'
import { useTranslation } from 'react-i18next'
import { BookOpen, Building2, UserCog, CheckCheck, Settings, Send, Truck, Factory, FileText, Gauge, Hammer, KanbanSquare, Languages, Layers, LifeBuoy, LogOut, Menu, Moon, Package, Store, Sun, Users, Workflow } from 'lucide-react'
import { useAuth } from './auth'
import { isFloorOnly, isOfficeOnly } from '@/lib/claims'
import { useMyTenants, useSupportSession, useSwitchTenant } from '@/modules/platform/api'
import { usePendingApprovals } from '@/modules/production/api'
import { NotificationBell } from '@/modules/notifications/notification-bell'
import { useTenantRealtime } from './realtime'
import { useModules, type ModuleKey } from '@/modules/settings/api'
import { ListSkeleton } from '@/shared/ui/page'
import { Drawer } from '@/shared/ui/drawer'
import { setLanguage } from '@/shared/i18n'
import { useToast } from '@/shared/ui/toast'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'

type NavItem = { to: string; key: string; Icon: typeof Factory; soon?: boolean; module?: ModuleKey }

const navGroups: { key?: string; items: NavItem[] }[] = [
  {
    items: [{ to: '/dashboard', key: 'dashboard', Icon: Gauge }],
  },
  {
    key: 'workflow',
    items: [
      // In the order work flows: PO → plan approval → materials → schedule → floor → outside → delivery.
      { to: '/orders', key: 'orders', Icon: FileText },
      { to: '/approvals', key: 'approvals', Icon: CheckCheck },
      { to: '/inventory', key: 'inventory', Icon: Package, module: 'inventory' },
      { to: '/board', key: 'board', Icon: KanbanSquare },
      { to: '/floor', key: 'floor', Icon: Hammer },
      { to: '/outsource', key: 'outsource', Icon: Send, module: 'outsource' },
      { to: '/deliveries', key: 'deliveries', Icon: Truck, module: 'delivery' },
    ],
  },
  {
    key: 'masters',
    items: [
      { to: '/customers', key: 'customers', Icon: Users },
      { to: '/vendors', key: 'vendors', Icon: Store },
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
  const floorOnly = isFloorOnly(auth.claims)
  const shopGroups = navGroups.map((g) => ({
    ...g,
    items: g.items.filter((i) => (!i.module || modules.has(i.module)) && !(floorOnly && isOfficeOnly(i.to))),
  }))
  const groups = [
    ...(hasTenant ? shopGroups : []),
    { key: 'help', items: [{ to: '/manual', key: 'manual', Icon: BookOpen }] },
    ...(isPlatformAdmin ? [{ key: 'platform', items: [{ to: '/admin', key: 'admin', Icon: Building2 }, { to: '/admin/users', key: 'adminUsers', Icon: UserCog }] }] : []),
  ]

  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)

  const nav = (onNavigate?: () => void) => (
    <nav className="flex flex-col gap-1">
      {groups.map((group, gi) => (
        <div key={gi} className="flex flex-col gap-1">
          {group.key && (
            <div className="px-2.5 pb-1 pt-4 text-[11px] font-medium uppercase tracking-wide text-muted">
              {t(`nav.${group.key}`)}
            </div>
          )}
          {group.items.map(({ to, key, Icon, soon }) =>
            soon ? (
              <span key={key} className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-muted/70 pointer-coarse:min-h-11" aria-disabled>
                <Icon className="size-4" aria-hidden />
                <span className="flex-1 whitespace-nowrap">{t(`nav.${key}`)}</span>
                <span className="rounded bg-surface-2 px-1.5 text-[10px]">{t('nav.soon')}</span>
              </span>
            ) : (
              <Link
                key={key}
                to={to}
                onClick={onNavigate}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-fg hover:bg-surface-2 pointer-coarse:min-h-11"
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
  )

  const controls = (
    <div className="flex flex-col gap-2">
      {tenants.data && tenants.data.length > 1 && (
        <label className="flex flex-col gap-1 px-1 text-xs text-muted">
          {t('tenant.switch')}
          <select
            className="h-8 rounded-lg border border-border bg-surface px-2 text-sm text-fg pointer-coarse:h-11 pointer-coarse:text-base"
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
  )

  const brand = (
    <>
      <div className="grid size-8 shrink-0 place-items-center rounded-lg bg-brand text-sm font-bold text-brand-fg">U</div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold leading-tight">{t('app.name')}</div>
        <div className="truncate text-xs text-muted">{current?.name ?? '—'}</div>
      </div>
    </>
  )

  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      {/* Phones and tablets (< lg): a slim top bar; the menu opens as a drawer so pages get the full width. */}
      <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-border bg-surface/95 px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] backdrop-blur print:hidden lg:hidden">
        <button
          onClick={() => setMenuOpen(true)}
          aria-label="menu"
          aria-expanded={menuOpen}
          className="relative grid size-11 place-items-center rounded-lg text-fg hover:bg-surface-2"
        >
          <Menu className="size-5" aria-hidden />
          {badges.approvals > 0 && <span className="absolute right-2 top-2 size-2 rounded-full bg-status-paused" aria-hidden />}
        </button>
        {brand}
        {hasTenant && <NotificationBell />}
      </header>
      <Drawer
        open={menuOpen}
        side="left"
        className="max-w-[min(20rem,85vw)]"
        onClose={closeMenu}
        title={<span className="flex items-center gap-2">{brand}</span>}
        footer={<div className="w-full">{controls}</div>}
      >
        <div className="-mx-2 -mt-3">{nav(closeMenu)}</div>
      </Drawer>

      {/* Desktop (lg+): the permanent sidebar. */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col gap-1 border-r border-border bg-surface px-3 py-3 print:hidden lg:flex">
        <div className="flex items-center gap-2 px-2 pb-3">
          {brand}
          {hasTenant && <NotificationBell />}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{nav()}</div>
        <div className="border-t border-border pt-3">{controls}</div>
      </aside>

      <main className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 print:p-0">
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
      className={cn('flex h-8 min-w-8 items-center justify-center gap-1 rounded-lg px-2 text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:h-11 pointer-coarse:min-w-11', className)}
      {...props}
    />
  )
}
