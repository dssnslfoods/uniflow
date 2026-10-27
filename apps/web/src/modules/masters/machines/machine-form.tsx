import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Select } from '@/shared/ui/input'
import type { CapacityUnit, Machine, MachineInput } from './api'

const units: CapacityUnit[] = ['sheet', 'impression', 'piece', 'meter', 'kg']

const blank: MachineInput = {
  code: '',
  name: '',
  machine_type: '',
  capacity_unit: 'sheet',
  max_cap_per_hour: 0,
  setup_min: 0,
  efficiency_pct: 85,
  crew_size: 1,
}

type Props = {
  machine: Machine | null
  open: boolean
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (input: MachineInput & { id?: string }) => void
}

export function MachineForm({ machine, open, saving, error, onClose, onSave }: Props) {
  const { t } = useTranslation()
  const [form, setForm] = useState<MachineInput>(machine ?? blank)
  const set = <K extends keyof MachineInput>(k: K, v: MachineInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (v: string) => (v === '' ? 0 : Number(v))

  function submit(e: FormEvent) {
    e.preventDefault()
    onSave({ ...form, machine_type: form.machine_type || null, id: machine?.id })
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
        <Field label={t('machines.crew')}>
          {(id) => (
            <Input id={id} type="number" inputMode="numeric" min={0} step={1} className="tabular"
              value={form.crew_size} onChange={(e) => set('crew_size', num(e.target.value))} />
          )}
        </Field>
        {error && (
          <p className="col-span-2 rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{error}</p>
        )}
      </form>
    </Drawer>
  )
}
