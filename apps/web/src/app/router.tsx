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
import { MachinesPage } from '@/modules/masters/machines/machines-page'
import { ProcessesPage } from '@/modules/masters/processes/processes-page'
import { CustomersPage } from '@/modules/masters/customers/customers-page'
import { TemplatesPage } from '@/modules/masters/templates/templates-page'
import { OrdersPage } from '@/modules/orders/orders-page'
import { NewOrderPage, OrderEditorPage } from '@/modules/orders/order-editor-page'
import { PlanPage } from '@/modules/production/plan-page'
import { ApprovalsPage } from '@/modules/production/approvals-page'

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
  beforeLoad: ({ context }) => {
    if (!context.auth.session) throw redirect({ to: '/login' })
    if (!context.auth.claims?.tenant_id) throw redirect({ to: '/onboarding' })
  },
  component: AppShell,
})

const indexRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/orders' })
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
