import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <div className="grid min-h-full place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2.5">
          <div className="grid size-10 place-items-center rounded-xl bg-brand text-lg font-bold text-brand-fg">U</div>
          <div>
            <div className="text-lg font-semibold leading-tight">{t('app.name')}</div>
            <div className="text-xs text-muted">{t('app.tagline')}</div>
          </div>
        </div>
        <div className="rounded-[var(--radius-card)] border border-border bg-surface p-6 shadow-sm">
          <h1 className="text-xl font-semibold">{title}</h1>
          {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  )
}
