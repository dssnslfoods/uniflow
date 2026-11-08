import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, GitFork, Layers, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select, Textarea } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useMachineProcesses, useMachines } from '../machines/api'
import { useProcesses } from '../processes/api'
import { stepTypeStyle } from '../processes/step-type'
import { useSaveTemplate, useTemplateSteps, useTemplates, type Template } from './api'

// Editor rows keep a "parallel with previous" flag; seq (stage) is derived on save (D-07).
type Row = { key: string; process_id: string; default_machine_id: string | null; parallel: boolean }

const rowKey = () => Math.random().toString(36).slice(2)

function toRows(steps: { seq: number; process_id: string; default_machine_id: string | null }[]): Row[] {
  return steps.map((s, i) => ({
    key: rowKey(),
    process_id: s.process_id,
    default_machine_id: s.default_machine_id,
    parallel: i > 0 && s.seq === steps[i - 1].seq,
  }))
}

function stages(rows: Row[]): number[] {
  const out: number[] = []
  rows.forEach((r, i) => out.push(i === 0 ? 1 : r.parallel ? out[i - 1] : out[i - 1] + 1))
  return out
}

export function TemplatesPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const templates = useTemplates()
  const [selected, setSelected] = useState<string | 'new' | null>(null)
  const canEdit = hasRole('admin', 'manager', 'supervisor')

  const list = templates.data ?? []
  useEffect(() => {
    if (selected === null && list.length) setSelected(list[0].id)
  }, [list, selected])

  const current = selected && selected !== 'new' ? list.find((x) => x.id === selected) ?? null : null

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('templates.title')}
        subtitle={t('templates.subtitle')}
        actions={
          canEdit && (
            <Button onClick={() => setSelected('new')}>
              <Plus className="size-4" aria-hidden />
              {t('templates.add')}
            </Button>
          )
        }
      />

      {templates.isLoading ? (
        <ListSkeleton />
      ) : templates.error ? (
        <ErrorNote>{errorMessage(templates.error)}</ErrorNote>
      ) : list.length === 0 && selected !== 'new' ? (
        <EmptyState
          Icon={Layers}
          title={t('templates.empty')}
          hint={t('templates.emptyHint')}
          actionLabel={canEdit ? t('templates.add') : undefined}
          onAction={() => setSelected('new')}
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-[240px_1fr]">
          <nav className="flex flex-col gap-1">
            {list.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => setSelected(tpl.id)}
                className={cn(
                  'rounded-lg px-3 py-2 text-left hover:bg-surface-2',
                  selected === tpl.id && 'bg-surface font-medium shadow-sm ring-1 ring-border',
                  !tpl.is_active && 'text-muted line-through',
                )}
              >
                {tpl.name}
              </button>
            ))}
          </nav>
          {selected ? (
            <TemplateEditor
              key={selected}
              template={current}
              canEdit={canEdit}
              onSaved={(id) => setSelected(id)}
            />
          ) : (
            <p className="text-muted">{t('templates.select')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function TemplateEditor({ template, canEdit, onSaved }: { template: Template | null; canEdit: boolean; onSaved: (id: string) => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const processes = useProcesses()
  const machines = useMachines()
  const links = useMachineProcesses()
  const steps = useTemplateSteps(template?.id ?? null)
  const save = useSaveTemplate()

  const [name, setName] = useState(template?.name ?? '')
  const [description, setDescription] = useState(template?.description ?? '')
  const [rows, setRows] = useState<Row[]>([])
  const [loaded, setLoaded] = useState(!template)

  useEffect(() => {
    if (template && steps.data && !loaded) {
      setRows(toRows(steps.data))
      setLoaded(true)
    }
  }, [template, steps.data, loaded])

  const processById = useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p])), [processes.data])
  const machinesFor = (processId: string) => {
    const ids = new Set((links.data ?? []).filter((l) => l.process_id === processId).map((l) => l.machine_id))
    return (machines.data ?? []).filter((m) => ids.has(m.id))
  }
  const seqs = stages(rows)

  const update = (i: number, patch: Partial<Row>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const move = (i: number, dir: -1 | 1) =>
    setRows((rs) => {
      const next = [...rs]
      ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
      next[0] = { ...next[0], parallel: false }
      return next
    })
  const remove = (i: number) =>
    setRows((rs) => {
      const next = rs.filter((_, j) => j !== i)
      if (next[0]) next[0] = { ...next[0], parallel: false }
      return next
    })

  function submit() {
    save.mutate(
      {
        id: template?.id,
        name: name.trim(),
        description: description.trim() || null,
        steps: rows.map((r, i) => ({ seq: seqs[i], process_id: r.process_id, default_machine_id: r.default_machine_id, note: null })),
      },
      {
        onSuccess: (id) => {
          toast({ tone: 'success', message: t('common.saved') })
          onSaved(id)
        },
      },
    )
  }

  if (template && !loaded) return <ListSkeleton rows={4} />

  return (
    <section className="flex flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('templates.name')}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} required autoFocus={!template} />}
        </Field>
        <Field label={t('templates.description')}>
          {(id) => <Textarea id={id} rows={1} className="min-h-9 field-sizing-content" value={description} onChange={(e) => setDescription(e.target.value)} disabled={!canEdit} />}
        </Field>
      </div>

      <div>
        <h3 className="mb-2 text-[13px] font-medium">{t('templates.steps')}</h3>
        {rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-muted">{t('templates.noSteps')}</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {rows.map((r, i) => {
              const p = processById.get(r.process_id)
              const style = p ? stepTypeStyle[p.step_type] : null
              const options = machinesFor(r.process_id)
              const newStage = i === 0 || seqs[i] !== seqs[i - 1]
              return (
                <li key={r.key} className={cn('flex flex-wrap items-center gap-3 rounded-lg border border-border px-3 py-2', r.parallel && 'ml-6 border-dashed')}>
                  <span className={cn('tabular w-16 shrink-0 text-xs font-medium', newStage ? 'text-fg' : 'text-muted')}>
                    {r.parallel ? <GitFork className="inline size-3.5" aria-label={t('templates.parallel')} /> : t('templates.level', { n: seqs[i] })}
                  </span>
                  {style && (
                    <span className={cn('grid size-7 shrink-0 place-items-center rounded-md', style.cls)}>
                      <style.Icon className="size-4" aria-hidden />
                    </span>
                  )}
                  <span className="min-w-32 flex-1 font-medium">{p?.name ?? '—'}</span>
                  {options.length > 0 && (
                    <Select
                      aria-label={t('templates.defaultMachine')}
                      className="h-8 w-44 text-xs"
                      value={r.default_machine_id ?? ''}
                      disabled={!canEdit}
                      onChange={(e) => update(i, { default_machine_id: e.target.value || null })}
                    >
                      <option value="">{t('templates.defaultMachine')}: {t('templates.anyMachine')}</option>
                      {options.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                    </Select>
                  )}
                  {canEdit && (
                    <div className="flex items-center gap-0.5">
                      {i > 0 && (
                        <label className="mr-2 flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                          <input type="checkbox" checked={r.parallel} onChange={(e) => update(i, { parallel: e.target.checked })} className="accent-[var(--brand)]" />
                          {t('templates.parallel')}
                        </label>
                      )}
                      <IconBtn label="up" disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></IconBtn>
                      <IconBtn label="down" disabled={i === rows.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></IconBtn>
                      <IconBtn label={t('common.delete')} onClick={() => remove(i)}><Trash2 className="size-4" /></IconBtn>
                    </div>
                  )}
                </li>
              )
            })}
          </ol>
        )}

        {canEdit && (
          (processes.data ?? []).length === 0 ? (
            <p className="mt-3 text-xs text-muted">{t('templates.needProcesses')}</p>
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              {(processes.data ?? []).map((p) => {
                const style = stepTypeStyle[p.step_type]
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setRows((rs) => [...rs, { key: rowKey(), process_id: p.id, default_machine_id: null, parallel: false }])}
                    className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm hover:border-brand hover:text-brand"
                  >
                    <Plus className="size-3.5" aria-hidden />
                    <style.Icon className="size-3.5 text-muted" aria-hidden />
                    {p.name}
                  </button>
                )
              })}
            </div>
          )
        )}
      </div>

      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      {canEdit && (
        <div className="flex justify-end border-t border-border pt-4">
          <Button onClick={submit} loading={save.isPending} disabled={!name.trim()}>
            {t('common.save')}
          </Button>
        </div>
      )}
    </section>
  )
}

function IconBtn({ label, children, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string }) {
  return (
    <button type="button" aria-label={label} title={label} className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-30 pointer-coarse:p-3" {...props}>
      {children}
    </button>
  )
}
