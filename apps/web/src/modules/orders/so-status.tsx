import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleDashed, CircleX, Factory, PackageCheck, Lock } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { SoStatus } from './api'

const styles: Record<SoStatus, { cls: string; Icon: typeof CircleCheck }> = {
  draft: { cls: 'bg-status-pending/10 text-status-pending', Icon: CircleDashed },
  confirmed: { cls: 'bg-status-ready/10 text-status-ready', Icon: CircleCheck },
  in_progress: { cls: 'bg-status-progress/10 text-status-progress', Icon: Factory },
  delivered: { cls: 'bg-status-done/10 text-status-done', Icon: PackageCheck },
  closed: { cls: 'bg-surface-2 text-muted', Icon: Lock },
  cancelled: { cls: 'bg-status-risk/10 text-status-risk', Icon: CircleX },
}

// prefix names what the status belongs to where other statuses sit nearby (e.g. "PO" on the plan page).
export function SoStatusPill({ status, prefix }: { status: SoStatus; prefix?: string }) {
  const { t } = useTranslation()
  const { cls, Icon } = styles[status]
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', cls)}>
      <Icon className="size-3.5" aria-hidden />
      {prefix && <span className="opacity-70">{prefix} ·</span>}
      {t(`soStatus.${status}`)}
    </span>
  )
}
