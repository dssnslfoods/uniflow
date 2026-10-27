import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Select } from '@/shared/ui/input'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Process } from '../processes/api'
import type { CapacityUnit, Machine, MachineInput } from './api'

const units: CapacityUnit[] = ['sheet', 'impression', 'piece', 'meter', 'kg']

const blank: Omit<MachineInput, 'process_ids' | 'cost_per_hour'> = {
  code: '',
  name: '',
  machine_type: '',
  capacity_unit: 'sheet',
  max_cap_per_hour: 0,
  setup_min: 0,
  efficiency_pct: 85,
  makeready_waste_units: 0,
  crew_size: 1,
}

type Props = {
  machine: Machine | null
  processes: Process[]
  processIds: string[]
  cost: number | null
  showCost: boolean
  open: boolean
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (input: MachineInput & { id?: string }) => void
}

export function MachineForm({ machine, processes, processIds, cost, showCost, open, saving, error, onClose, onSave }: Props) {
  const { t } = useTranslation()
  const [form, setForm] = useState<MachineInput>({
    ...(machine ?? blank),
    process_ids: processIds,
    cost_per_hour: cost,
  })
  // Machines run in-house steps; design/outsource/delivery never sit on a machine.
  const capable = processes.filter((p) => p.step_type === 'internal' || p.step_type === 'qc')
  const toggleProcess = (id: string) =>
    set('process_ids', form.process_ids.includes(id) ? form.process_ids.filter((x) => x !== id) : [...form.process_ids, id])
  const set = <K extends keyof MachineInput>(k: K, v: MachineInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (v: string) => (v === '' ? 0 : Number(v))

  function submit(e: FormEvent) {
    e.preventDefault()
    const { id: _ignored, status: _s, sort_order: _o, ...values } = form as MachineInput & Partial<Machine>
    onSave({
      ...values,
      machine_type: form.machine_type || null,
      cost_per_hour: showCost ? form.cost_per_hour ?? 0 : null,
      id: machine?.id,
    })
  }

  return (
    <Drawer
      open={open}
      title={machine ? machine.name : t('machines.add')}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('machines.cancel')}
          </Button>
          <Button type="submit" form="machine-form" loading={saving}>
            {t('machines.save')}
          </Button>
        </>
      }
    >
      <form id="machine-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label={t('machines.code')}>
          {(id) => <Input id={id} value={form.code} onChange={(e) => set('code', e.target.value)} required autoFocus />}
        </Field>
        <Field label={t('machines.type')}>
          {(id) => <Input id={id} value={form.machine_type ?? ''} onChange={(e) => set('machine_type', e.target.value)} placeholder="Offset 4 สี" />}
        </Field>
        <Field label={t('machines.name')} className="col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} required />}
        </Field>
        <Field label={t('machines.capacity')}>
          {(id) => (
            <Input id={id} type="number" inputMode="decimal" min={0.01} step="any" className="tabular"
              value={form.max_cap_per_hour || ''} onChange={(e) => set('max_cap_per_hour', num(e.target.value))} required />
          )}
        </Field>
        <Field label={t('machines.unit')}>
          {(id) => (
            <Select id={id} value={form.capacity_unit} onChange={(e) => set('capacity_unit', e.target.value as CapacityUnit)}>
              {units.map((u) => (
                <option key={u} value={u}>{t(`unit.${u}`)}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label={t('machines.setup')}>
          {(id) => (
            <Input id={id} type="number" inputMode="decimal" min={0} step="any" className="tabular"
              value={form.setup_min} onChange={(e) => set('setup_min', num(e.target.value))} />
          )}
        </Field>
        <Field label={t('machines.efficiency')} hint="Max cap × % = กำลังผลิตจริง">
          {(id) => (
            <Input id={id} type="number" inputMode="decimal" min={1} max={100} step="any" className="tabular"
              value={form.efficiency_pct} onChange={(e) => set('efficiency_pct', num(e.target.value))} required />
          )}
        </Field>
        <Field label={t('machines.makeready')}>
          {(id) => (
            <Input id={id} type="number" inputMode="decimal" min={0} step="any" className="tabular"
              value={form.makeready_waste_units} onChange={(e) => set('makeready_waste_units', num(e.target.value))} />
          )}
        </Field>
        <Field label={t('machines.crew')}>
          {(id) => (
            <Input id={id} type="number" inputMode="numeric" min={0} step={1} className="tabular"
              value={form.crew_size} onChange={(e) => set('crew_size', num(e.target.value))} />
          )}
        </Field>
        {showCost && (
          <Field label={t('machines.costPerHour')}>
            {(id) => (
              <Input id={id} type="number" inputMode="decimal" min={0} step="any" className="tabular"
                value={form.cost_per_hour ?? ''} onChange={(e) => set('cost_per_hour', num(e.target.value))} />
            )}
          </Field>
        )}
        <fieldset className="col-span-2 flex flex-col gap-2">
          <legend className="mb-1.5 text-[13px] font-medium">{t('machines.processes')}</legend>
          {capable.length === 0 ? (
            <p className="text-xs text-muted">{t('machines.noProcesses')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {capable.map((p) => {
                const on = form.process_ids.includes(p.id)
                return (
                  <button
                    key={p.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleProcess(p.id)}
                    className={cn(
                      'inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors',
                      on ? 'border-brand bg-brand/10 text-brand' : 'border-border text-muted hover:text-fg',
                    )}
                  >
                    {on && <Check className="size-3.5" aria-hidden />}
                    {p.name}
                  </button>
                )
              })}
            </div>
          )}
        </fieldset>
        {error && (
          <p className="col-span-2 rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{error}</p>
        )}
      </form>
    </Drawer>
  )
}
