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
    throw redirect({ to: '/machines' })
  },
})

const machinesRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/machines',
  component: MachinesPage,
})

const routeTree = rootRoute.addChildren([
  loginRoute,
  onboardingRoute,
  appRoute.addChildren([indexRoute, machinesRoute]),
])

export const router = createRouter({ routeTree, context: { auth: undefined! } })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
