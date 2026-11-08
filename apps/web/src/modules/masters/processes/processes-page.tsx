import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Plus, Workflow } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { useArchiveRow, useSaveRow } from '@/shared/data'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Select } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { stepTypeStyle } from './step-type'
import { stepTypes, useProcesses, type Process, type ProcessInput, type StepType } from './api'
import type { CapacityUnit } from '../machines/api'

const units: CapacityUnit[] = ['sheet', 'impression', 'piece', 'meter', 'kg']

const blank: ProcessInput = {
  code: '',
  name: '',
  step_type: 'internal',
  capacity_unit: 'sheet',
  default_setup_min: 0,
  default_running_waste_pct: 0,
  default_crew_size: 1,
  sort_order: 0,
}

export function ProcessesPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const processes = useProcesses()
  const save = useSaveRow<ProcessInput>('processes')
  const archive = useArchiveRow('processes')
  const [editing, setEditing] = useState<Process | 'new' | null>(null)
  const canEdit = hasRole('admin', 'manager')

  function archiveRow(p: Process) {
    archive.mutate(
      { id: p.id },
      {
        onSuccess: () =>
          toast({
            tone: 'success',
            message: t('common.archived'),
            action: { label: t('common.undo'), run: () => archive.mutate({ id: p.id, restore: true }) },
          }),
        onError: (err) => toast({ tone: 'error', message: errorMessage(err) }),
      },
    )
  }

  const rows = processes.data ?? []

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('processes.title')}
        subtitle={t('processes.subtitle')}
        actions={
          canEdit && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              {t('processes.add')}
            </Button>
          )
        }
      />

      {processes.isLoading ? (
        <ListSkeleton />
      ) : processes.error ? (
        <ErrorNote>{errorMessage(processes.error)}</ErrorNote>
      ) : rows.length === 0 ? (
        <EmptyState
          Icon={Workflow}
          title={t('processes.empty')}
          hint={t('processes.emptyHint')}
          actionLabel={canEdit ? t('processes.add') : undefined}
          onAction={() => setEditing('new')}
        />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-full min-w-[560px] text-left">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('processes.name')}</th>
                <th className="px-4 py-2.5 font-medium">{t('processes.type')}</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">{t('processes.setup')}</th>
                <th className="hidden px-4 py-2.5 text-right font-medium sm:table-cell">{t('processes.waste')}</th>
                <th className="w-24" />
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => {
                const style = stepTypeStyle[p.step_type]
                return (
                  <tr key={p.id} className="group border-t border-border hover:bg-surface-2/60">
                    <td className="px-4 py-3">
                      <button className="text-left disabled:cursor-default" disabled={!canEdit} onClick={() => setEditing(p)}>
                        <div className="font-medium group-hover:text-brand">{p.name}</div>
                        <div className="text-xs text-muted">{p.code}</div>
                      </button>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${style.cls}`}>
                        <style.Icon className="size-3.5" aria-hidden />
                        {t(`stepType.${p.step_type}`)}
                      </span>
                    </td>
                    <td className="tabular hidden px-4 py-3 text-right sm:table-cell">{p.default_setup_min}</td>
                    <td className="tabular hidden px-4 py-3 text-right sm:table-cell">{p.default_running_waste_pct}%</td>
                    <td className="px-2 py-3 text-right">
                      {canEdit && (
                        <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => archiveRow(p)}>
                          <Archive className="size-3.5" aria-hidden />
                          {t('common.archive')}
                        </Button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProcessForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? blank : editing}
          title={editing === 'new' ? t('processes.add') : editing.name}
          saving={save.isPending}
          error={save.error ? errorMessage(save.error) : null}
          onClose={() => {
            save.reset()
            setEditing(null)
          }}
          onSave={(input) =>
            save.mutate(input, {
              onSuccess: () => {
                setEditing(null)
                toast({ tone: 'success', message: t('common.saved') })
              },
            })
          }
        />
      )}
    </div>
  )
}

type FormProps = {
  initial: ProcessInput
  title: string
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (input: ProcessInput) => void
}

function ProcessForm({ initial, title, saving, error, onClose, onSave }: FormProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState<ProcessInput>(initial)
  const set = <K extends keyof ProcessInput>(k: K, v: ProcessInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const num = (v: string) => (v === '' ? 0 : Number(v))

  function submit(e: FormEvent) {
    e.preventDefault()
    onSave(form)
  }

  return (
    <Drawer
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="process-form" loading={saving}>{t('common.save')}</Button>
        </>
      }
    >
      <form id="process-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label={t('processes.code')}>
          {(id) => <Input id={id} value={form.code} onChange={(e) => set('code', e.target.value)} required autoFocus />}
        </Field>
        <Field label={t('processes.type')}>
          {(id) => (
            <Select id={id} value={form.step_type} onChange={(e) => set('step_type', e.target.value as StepType)}>
              {stepTypes.map((s) => <option key={s} value={s}>{t(`stepType.${s}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('processes.name')} className="col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} required />}
        </Field>
        <Field label={t('processes.unit')}>
          {(id) => (
            <Select id={id} value={form.capacity_unit} onChange={(e) => set('capacity_unit', e.target.value as CapacityUnit)}>
              {units.map((u) => <option key={u} value={u}>{t(`unit.${u}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('processes.setup')}>
          {(id) => <Input id={id} type="number" min={0} step="any" className="tabular" value={form.default_setup_min} onChange={(e) => set('default_setup_min', num(e.target.value))} />}
        </Field>
        <Field label={t('processes.waste')}>
          {(id) => <Input id={id} type="number" min={0} max={100} step="any" className="tabular" value={form.default_running_waste_pct} onChange={(e) => set('default_running_waste_pct', num(e.target.value))} />}
        </Field>
        <Field label={t('processes.crew')}>
          {(id) => <Input id={id} type="number" min={0} step={1} className="tabular" value={form.default_crew_size} onChange={(e) => set('default_crew_size', num(e.target.value))} />}
        </Field>
        {error && <div className="col-span-2"><ErrorNote>{error}</ErrorNote></div>}
      </form>
    </Drawer>
  )
}
