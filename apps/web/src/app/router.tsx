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


// Pages load on demand (one chunk each); login and onboarding stay in the main bundle.
const MachinesPage = lazy(() => import('@/modules/masters/machines/machines-page').then((m) => ({ default: m.MachinesPage })))
const ProcessesPage = lazy(() => import('@/modules/masters/processes/processes-page').then((m) => ({ default: m.ProcessesPage })))
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
const DashboardPage = lazy(() => import('@/modules/dashboard/dashboard-page').then((m) => ({ default: m.DashboardPage })))

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

const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  beforeLoad: ({ context }) => {
    if (!context.auth.session) throw redirect({ to: '/login' })
  },
  component: OnboardingPage,
})

// Everything inside needs a session and an active tenant in the JWT.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  beforeLoad: ({ context, location }) => {
    if (!context.auth.session) throw redirect({ to: '/login' })
    if (!context.auth.claims?.tenant_id) {
      // Platform admins work without a tenant; only the admin console is reachable then.
      if (context.auth.claims?.platform_admin) {
        if (location.pathname !== '/admin') throw redirect({ to: '/admin' })
      } else {
        throw redirect({ to: '/onboarding' })
      }
    }
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

const routeTree = rootRoute.addChildren([
  loginRoute,
  onboardingRoute,
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
    page('/settings', SettingsPage),
    page('/dashboard', DashboardPage),
    machinesRoute,
    page('/processes', ProcessesPage),
    page('/customers', CustomersPage),
    page('/templates', TemplatesPage),
  ]),
])

export const router = createRouter({ routeTree, context: { auth: undefined! } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
