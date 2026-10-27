import { useTranslation } from 'react-i18next'
import { CheckCircle2, CircleDashed, CircleX, Clock, Factory, PackageCheck, Pause, Truck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { JobStatus } from './api'

const styles: Record<JobStatus, { cls: string; Icon: typeof Clock }> = {
  planning: { cls: 'bg-status-pending/10 text-status-pending', Icon: CircleDashed },
  pending_approval: { cls: 'bg-status-paused/10 text-status-paused', Icon: Clock },
  approved: { cls: 'bg-status-ready/10 text-status-ready', Icon: CheckCircle2 },
  in_production: { cls: 'bg-status-progress/10 text-status-progress', Icon: Factory },
  on_hold: { cls: 'bg-status-paused/10 text-status-paused', Icon: Pause },
  ready_to_deliver: { cls: 'bg-status-done/10 text-status-done', Icon: PackageCheck },
  partially_delivered: { cls: 'bg-status-done/10 text-status-done', Icon: Truck },
  completed: { cls: 'bg-surface-2 text-muted', Icon: CheckCircle2 },
  cancelled: { cls: 'bg-status-risk/10 text-status-risk', Icon: CircleX },
}

export function JobStatusPill({ status }: { status: JobStatus }) {
  const { t } = useTranslation()
  const { cls, Icon } = styles[status]
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', cls)}>
      <Icon className="size-3.5" aria-hidden />
      {t(`jobStatus.${status}`)}
    </span>
  )
}
