import { lazy } from 'react'
import type { RouteComponent } from '@tanstack/react-router'
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'
import type { AuthState } from './auth'
import { AppShell } from './app-shell'
import { LoginPage } from '@/modules/platform/login-page'
import { OnboardingPage } from '@/modules/platform/onboarding-page'
import { SetPasswordPage } from '@/modules/platform/set-password-page'
import { isFloorOnly, isOfficeOnly } from '@/lib/claims'
import { needsPassword } from '@/lib/supabase'
import { ModuleGate } from '@/shared/ui/module-gate'
import type { ModuleKey } from '@/modules/settings/api'


// Pages load on demand (one chunk each); login and onboarding stay in the main bundle.
const MachinesPage = lazy(() => import('@/modules/masters/machines/machines-page').then((m) => ({ default: m.MachinesPage })))
const ProcessesPage = lazy(() => import('@/modules/masters/processes/processes-page').then((m) => ({ default: m.ProcessesPage })))
const VendorsPage = lazy(() => import('@/modules/masters/vendors/vendors-page').then((m) => ({ default: m.VendorsPage })))
const CustomersPage = lazy(() => import('@/modules/masters/customers/customers-page').then((m) => ({ default: m.CustomersPage })))
const TemplatesPage = lazy(() => import('@/modules/masters/templates/templates-page').then((m) => ({ default: m.TemplatesPage })))
const OrdersPage = lazy(() => import('@/modules/orders/orders-page').then((m) => ({ default: m.OrdersPage })))
const NewOrderPage = lazy(() => import('@/modules/orders/order-editor-page').then((m) => ({ default: m.NewOrderPage })))
const OrderEditorPage = lazy(() => import('@/modules/orders/order-editor-page').then((m) => ({ default: m.OrderEditorPage })))
const PlanPage = lazy(() => import('@/modules/production/plan-page').then((m) => ({ default: m.PlanPage })))
const ApprovalsPage = lazy(() => import('@/modules/production/approvals-page').then((m) => ({ default: m.ApprovalsPage })))
const BoardPage = lazy(() => import('@/modules/production/board-page').then((m) => ({ default: m.BoardPage })))
const FloorPage = lazy(() => import('@/modules/production/floor-page').then((m) => ({ default: m.FloorPage })))
const JobPage = lazy(() => import('@/modules/production/job-page').then((m) => ({ default: m.JobPage })))
const JobTicketPage = lazy(() => import('@/modules/production/job-page').then((m) => ({ default: m.JobTicketPage })))
const AdminTenantsPage = lazy(() => import('@/modules/platform/admin-tenants-page').then((m) => ({ default: m.AdminTenantsPage })))
const SettingsPage = lazy(() => import('@/modules/settings/settings-page').then((m) => ({ default: m.SettingsPage })))
const OutsourcePage = lazy(() => import('@/modules/outsource/outsource-page').then((m) => ({ default: m.OutsourcePage })))
const DeliveryPage = lazy(() => import('@/modules/delivery/delivery-page').then((m) => ({ default: m.DeliveryPage })))
const DeliveryNotePage = lazy(() => import('@/modules/delivery/delivery-page').then((m) => ({ default: m.DeliveryNotePage })))
const InventoryPage = lazy(() => import('@/modules/inventory/inventory-page').then((m) => ({ default: m.InventoryPage })))
const AdminUsersPage = lazy(() => import('@/modules/platform/admin-users-page').then((m) => ({ default: m.AdminUsersPage })))
const DashboardPage = lazy(() => import('@/modules/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage })))
const ManualPage = lazy(() => import('@/modules/manual/manual-page').then((m) => ({ default: m.ManualPage })))

type Ctx = { auth: AuthState }

const rootRoute = createRootRouteWithContext<Ctx>()({ component: Outlet })

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  beforeLoad: ({ context }) => {
    if (context.auth.session) throw redirect({ to: '/' })
  },
  component: LoginPage,
})

const setPasswordRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/set-password',
  component: SetPasswordPage,
})

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  beforeLoad: ({ context }) => {
    if (!context.auth.session) throw redirect({ to: '/login' })
    if (context.auth.claims?.tenant_id) throw redirect({ to: '/' })
  },
  component: OnboardingPage,
})

// Everything inside needs a session and an active tenant in the JWT.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: ({ context, location }) => {
    if (!context.auth.session) throw redirect({ to: '/login' })
    if (needsPassword()) throw redirect({ to: '/set-password' })
    if (!context.auth.claims?.tenant_id) {
      // Platform admins work without a tenant; only the admin console and the manual are reachable then.
      if (context.auth.claims?.platform_admin) {
        if (!location.pathname.startsWith('/admin') && location.pathname !== '/manual') throw redirect({ to: '/admin' })
      } else {
        throw redirect({ to: '/onboarding' })
      }
    }
    if (isFloorOnly(context.auth.claims) && isOfficeOnly(location.pathname)) throw redirect({ to: '/floor' })
  },
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/dashboard' })
  },
})

const machinesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/machines',
  component: MachinesPage,
})

// Generic keeps the literal path so typed <Link to> knows every route.
const page = <P extends string>(path: P, component: RouteComponent) =>
  createRoute({ getParentRoute: () => appRoute, path, component })
const gated = (module: ModuleKey, Page: RouteComponent) => () => <ModuleGate module={module}><Page /></ModuleGate>

const adminUsersRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/admin/users',
  validateSearch: (s: Record<string, unknown>) => ({ shop: typeof s.shop === 'string' ? s.shop : undefined }),
  component: function AdminUsersRoute() {
    const { shop } = adminUsersRoute.useSearch()
    return <AdminUsersPage shop={shop} />
  },
})

const ordersRoute = page('/orders', OrdersPage)
const newOrderRoute = page('/orders/new', NewOrderPage)
const orderRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/orders/$orderId',
  component: function OrderRoute() {
    const { orderId } = orderRoute.useParams()
    return <OrderEditorPage orderId={orderId} />
  },
})

const planRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/orders/$orderId/plan',
  component: function PlanRoute() {
    const { orderId } = planRoute.useParams()
    return <PlanPage key={orderId} orderId={orderId} />
  },
})

const floorStepRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/floor/step/$stepId',
  component: function FloorStepRoute() {
    const { stepId } = floorStepRoute.useParams()
    return <FloorPage focusStepId={stepId} />
  },
})

const jobRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/jobs/$jobId',
  component: function JobRoute() {
    const { jobId } = jobRoute.useParams()
    return <JobPage key={jobId} jobId={jobId} />
  },
})

const jobTicketRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/jobs/$jobId/ticket',
  component: function JobTicketRoute() {
    const { jobId } = jobTicketRoute.useParams()
    return <JobTicketPage jobId={jobId} />
  },
})

const deliveryNoteRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/deliveries/$deliveryId',
  component: function DeliveryNoteRoute() {
    const { deliveryId } = deliveryNoteRoute.useParams()
    return <ModuleGate module="delivery"><DeliveryNotePage deliveryId={deliveryId} /></ModuleGate>
  },
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  onboardingRoute,
  setPasswordRoute,
  appRoute.addChildren([
    indexRoute,
    ordersRoute,
    newOrderRoute,
    orderRoute,
    planRoute,
    page('/approvals', ApprovalsPage),
    page('/board', BoardPage),
    page('/floor', () => <FloorPage />),
    floorStepRoute,
    jobRoute,
    jobTicketRoute,
    page('/admin', AdminTenantsPage),
    adminUsersRoute,
    page('/settings', SettingsPage),
    page('/dashboard', DashboardPage),
    page('/manual', ManualPage),
    page('/outsource', gated('outsource', OutsourcePage)),
    page('/deliveries', gated('delivery', DeliveryPage)),
    page('/inventory', gated('inventory', InventoryPage)),
    deliveryNoteRoute,
    machinesRoute,
    page('/processes', ProcessesPage),
    page('/customers', CustomersPage),
    page('/vendors', VendorsPage),
    page('/templates', TemplatesPage),
  ]),
])

export const router = createRouter({ routeTree, context: { auth: undefined! } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
