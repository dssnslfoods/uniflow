import { useTranslation } from 'react-i18next'
import { CircleCheck, CircleSlash, Wrench } from 'lucide-react'
import { cn } from '@/lib/utils'

export type MachineStatus = 'active' | 'maintenance' | 'inactive'

const styles: Record<MachineStatus, { cls: string; Icon: typeof CircleCheck }> = {
  active: { cls: 'text-status-done bg-status-done/10', Icon: CircleCheck },
  maintenance: { cls: 'text-status-paused bg-status-paused/10', Icon: Wrench },
  inactive: { cls: 'text-status-pending bg-status-pending/10', Icon: CircleSlash },
}

// Icon + text, never colour alone (design §8.0 accessibility).
export function StatusBadge({ status }: { status: MachineStatus }) {
  const { t } = useTranslation()
  const { cls, Icon } = styles[status]
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', cls)}>
      <Icon className="size-3.5" aria-hidden />
      {t(`status.${status}`)}
    </span>
  )
}
