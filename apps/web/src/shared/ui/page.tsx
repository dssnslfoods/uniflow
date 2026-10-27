import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import { Button } from './button'
import { Plus } from 'lucide-react'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-muted">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}

type EmptyProps = { Icon: LucideIcon; title: string; hint: string; actionLabel?: string; onAction?: () => void }

// Empty states always point to the next step (design §8.0).
export function EmptyState({ Icon, title, hint, actionLabel, onAction }: EmptyProps) {
  return (
    <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-6 py-16 text-center">
      <div className="mb-4 grid size-12 place-items-center rounded-xl bg-surface-2">
        <Icon className="size-6 text-muted" aria-hidden />
      </div>
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="mt-1 max-w-sm text-muted">{hint}</p>
      {actionLabel && onAction && (
        <Button className="mt-5" onClick={onAction}>
          <Plus className="size-4" aria-hidden />
          {actionLabel}
        </Button>
      )}
    </div>
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="h-12 animate-pulse rounded-lg bg-surface-2" />
      ))}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{children}</p>
}
