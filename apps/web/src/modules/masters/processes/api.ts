import { useList } from '@/shared/data'
import type { CapacityUnit } from '../machines/api'

export type StepType = 'design' | 'internal' | 'outsource' | 'qc' | 'delivery'
export const stepTypes: StepType[] = ['design', 'internal', 'outsource', 'qc', 'delivery']

export type Process = {
  id: string
  code: string
  name: string
  step_type: StepType
  capacity_unit: CapacityUnit
  default_setup_min: number
  default_running_waste_pct: number
  default_crew_size: number
  sort_order: number
}

export type ProcessInput = Omit<Process, 'id'> & { id?: string }

export const processColumns =
  'id, code, name, step_type, capacity_unit, default_setup_min, default_running_waste_pct, default_crew_size, sort_order'

export const useProcesses = () => useList<Process>('processes', processColumns, { order: ['sort_order', 'code'] })
