import { Brush, ClipboardCheck, Factory, Truck, Users } from 'lucide-react'
import type { StepType } from './api'

// Same look everywhere a step type appears (process list, templates, later the board).
export const stepTypeStyle: Record<StepType, { cls: string; Icon: typeof Factory }> = {
  design: { cls: 'bg-status-progress/10 text-status-progress', Icon: Brush },
  internal: { cls: 'bg-status-ready/10 text-status-ready', Icon: Factory },
  outsource: { cls: 'bg-status-paused/10 text-status-paused', Icon: Users },
  qc: { cls: 'bg-status-done/10 text-status-done', Icon: ClipboardCheck },
  delivery: { cls: 'bg-status-pending/10 text-status-pending', Icon: Truck },
}
