import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/app/auth'
import { cn } from '@/lib/utils'
import { ErrorNote, PageHeader } from '@/shared/ui/page'
import { GeneralTab } from './general-tab'
import { MembersTab } from './members-tab'
import { CalendarTab } from './calendar-tab'
import { MaterialsTab } from './materials-tab'

const tabs = ['general', 'members', 'calendar', 'materials'] as const
type Tab = (typeof tabs)[number]

export function SettingsPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const [tab, setTab] = useState<Tab>('general')

  if (!hasRole('admin', 'manager', 'supervisor')) return <ErrorNote>{t('errors.auth.forbidden')}</ErrorNote>

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title={t('settings.title')} subtitle={t('settings.subtitle')} />
      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {tabs.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn(
              '-mb-px whitespace-nowrap border-b-2 px-4 py-2 text-sm',
              tab === k ? 'border-brand font-medium text-fg' : 'border-transparent text-muted hover:text-fg',
            )}
          >
            {t(`settings.tabs.${k}`)}
          </button>
        ))}
      </div>
      {tab === 'general' && <GeneralTab />}
      {tab === 'members' && <MembersTab />}
      {tab === 'calendar' && <CalendarTab />}
      {tab === 'materials' && <MaterialsTab />}
    </div>
  )
}
