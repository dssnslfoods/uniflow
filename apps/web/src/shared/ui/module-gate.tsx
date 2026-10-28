import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Lock } from 'lucide-react'
import { useModules, type ModuleKey } from '@/modules/settings/api'
import { EmptyState, ListSkeleton } from './page'

// Pages of an optional module show a notice instead of failing on every command.
export function ModuleGate({ module, children }: { module: ModuleKey; children: ReactNode }) {
  const { t } = useTranslation()
  const mods = useModules()
  if (!mods.ready) return <ListSkeleton />
  if (!mods.has(module)) return <EmptyState Icon={Lock} title={t(`module.${module}`)} hint={t('module.disabled')} />
  return <>{children}</>
}
