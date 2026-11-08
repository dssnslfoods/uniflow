import type { Role } from '@/lib/claims'
import type { ModuleKey } from '../settings/api'

// Text markup: [[i18n.key]] shows that label exactly as the app does; **text** is emphasis.
export type Block =
  | { p: string }
  | { h: string }
  | { steps: string[] }
  | { bullets: string[] }
  | { tip: string }
  | { warn: string }
  | { defs: { term: string; desc: string }[] }
  | { matrix: { label: string; roles: Role[] }[] }
  | { flow: true }

export type SectionText = { title: string; summary: string; blocks: Block[] }

type Meta = {
  id: string
  group: 'start' | 'daily' | 'data' | 'reference' | 'platform'
  roles: Role[] | 'all'
  module?: ModuleKey
  platformOnly?: boolean
  to?: '/dashboard' | '/board' | '/floor' | '/outsource' | '/deliveries' | '/inventory' | '/orders' | '/approvals'
    | '/customers' | '/machines' | '/processes' | '/templates' | '/settings' | '/admin'
}

const planners: Role[] = ['admin', 'manager', 'supervisor']
const owners: Role[] = ['admin', 'manager']
const makers: Role[] = ['admin', 'manager', 'supervisor', 'staff']

export const sections = [
  { id: 'overview', group: 'start', roles: 'all' },
  { id: 'roles', group: 'start', roles: 'all' },
  { id: 'signin', group: 'start', roles: 'all' },
  { id: 'setup', group: 'start', roles: owners },

  { id: 'orders', group: 'daily', roles: planners, to: '/orders' },
  { id: 'plan', group: 'daily', roles: planners, to: '/orders' },
  { id: 'approvals', group: 'daily', roles: ['manager'], to: '/approvals' },
  { id: 'board', group: 'daily', roles: planners, to: '/board' },
  { id: 'floor', group: 'daily', roles: makers, to: '/floor' },
  { id: 'job', group: 'daily', roles: makers, to: '/board' },
  { id: 'outsource', group: 'daily', roles: planners, module: 'outsource', to: '/outsource' },
  { id: 'inventory', group: 'daily', roles: makers, module: 'inventory', to: '/inventory' },
  { id: 'deliveries', group: 'daily', roles: planners, module: 'delivery', to: '/deliveries' },
  { id: 'dashboard', group: 'daily', roles: ['admin', 'executive', 'manager', 'supervisor'], to: '/dashboard' },
  { id: 'notifications', group: 'daily', roles: 'all' },

  { id: 'processes', group: 'data', roles: owners, to: '/processes' },
  { id: 'machines', group: 'data', roles: planners, to: '/machines' },
  { id: 'templates', group: 'data', roles: planners, to: '/templates' },
  { id: 'customers', group: 'data', roles: planners, to: '/customers' },
  { id: 'settings', group: 'data', roles: planners, to: '/settings' },

  { id: 'statuses', group: 'reference', roles: 'all' },
  { id: 'trouble', group: 'reference', roles: 'all' },

  { id: 'platform', group: 'platform', roles: 'all', platformOnly: true, to: '/admin' },
] as const satisfies readonly Meta[]

export type SectionId = (typeof sections)[number]['id']
export type ManualText = Record<SectionId, SectionText>
export type { Meta as SectionMeta }

// The route of a PO, stage by stage, with who acts at each one.
export const flowStages: { id: SectionId; key: string; roles: Role[] }[] = [
  { id: 'orders', key: 'po', roles: planners },
  { id: 'plan', key: 'plan', roles: planners },
  { id: 'approvals', key: 'approve', roles: ['manager'] },
  { id: 'board', key: 'release', roles: planners },
  { id: 'floor', key: 'produce', roles: makers },
  { id: 'deliveries', key: 'deliver', roles: planners },
]
