import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Factory, Plus, Search } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { StatusBadge, type MachineStatus } from '@/shared/ui/status-badge'
import { useToast } from '@/shared/ui/toast'
import { MachineForm } from './machine-form'
import { useProcesses } from '../processes/api'
import {
  useArchiveMachine,
  useMachineCosts,
  useMachineProcesses,
  useMachines,
  useSaveMachine,
  useSetMachineStatus,
  type Machine,
} from './api'

const statuses: MachineStatus[] = ['active', 'maintenance', 'inactive']

export function MachinesPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const machines = useMachines()
  const save = useSaveMachine()
  const setStatus = useSetMachineStatus()
  const archive = useArchiveMachine()

  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Machine | 'new' | null>(null)

  const canEdit = hasRole('admin', 'manager')
  const canSetStatus = hasRole('admin', 'manager', 'supervisor')
  const showCost = hasRole('admin', 'manager', 'executive')
  const processes = useProcesses()
  const links = useMachineProcesses()
  const costs = useMachineCosts(showCost)
  const processName = useMemo(() => new Map((processes.data ?? []).map((p) => [p.id, p.name])), [processes.data])
  const processesOf = (machineId: string) =>
    (links.data ?? []).filter((l) => l.machine_id === machineId).map((l) => l.process_id)

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = machines.data ?? []
    return q ? all.filter((m) => `${m.code} ${m.name} ${m.machine_type ?? ''}`.toLowerCase().includes(q)) : all
  }, [machines.data, query])

  function archiveMachine(m: Machine) {
    archive.mutate(
      { id: m.id },
      {
        onSuccess: () =>
          toast({
            tone: 'success',
            message: t('machines.archived'),
            action: { label: t('machines.undo'), run: () => archive.mutate({ id: m.id, restore: true }) },
          }),
        onError: (err) => toast({ tone: 'error', message: errorMessage(err) }),
      },
    )
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{t('machines.title')}</h1>
          <p className="mt-1 text-muted">{t('machines.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('machines.search')}
              className="w-full pl-9 sm:w-56"
              aria-label={t('machines.search')}
            />
          </div>
          {canEdit && (
            <Button onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              {t('machines.add')}
            </Button>
          )}
        </div>
      </header>

      {machines.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-36 animate-pulse rounded-[var(--radius-card)] bg-surface-2" />
          ))}
        </div>
      ) : machines.error ? (
        <p className="rounded-lg bg-status-risk/10 px-4 py-3 text-status-risk">{errorMessage(machines.error)}</p>
      ) : rows.length === 0 && !query ? (
        <div className="flex flex-col items-center rounded-[var(--radius-card)] border border-dashed border-border bg-surface px-6 py-16 text-center">
          <div className="mb-4 grid size-12 place-items-center rounded-xl bg-surface-2">
            <Factory className="size-6 text-muted" aria-hidden />
          </div>
          <h2 className="text-lg font-semibold">{t('machines.empty')}</h2>
          <p className="mt-1 text-muted">{t('machines.emptyHint')}</p>
          {canEdit && (
            <Button className="mt-5" onClick={() => setEditing('new')}>
              <Plus className="size-4" aria-hidden />
              {t('machines.add')}
            </Button>
          )}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((m) => (
            <article
              key={m.id}
              className="group flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-sm transition-shadow hover:shadow-md"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  className="min-w-0 text-left disabled:cursor-default"
                  disabled={!canEdit}
                  onClick={() => setEditing(m)}
                >
                  <div className="text-xs font-medium text-muted">{m.code}{m.machine_type ? ` · ${m.machine_type}` : ''}</div>
                  <div className="truncate font-semibold group-hover:text-brand">{m.name}</div>
                </button>
                <StatusBadge status={m.status} />
              </div>
              <dl className="grid grid-cols-3 gap-2 text-xs">
                <Stat label={t('machines.capacity')} value={`${m.max_cap_per_hour.toLocaleString()} ${t(`unit.${m.capacity_unit}`)}`} />
                <Stat label={t('machines.efficiency')} value={`${m.efficiency_pct}%`} />
                <Stat label={t('machines.setup')} value={m.setup_min.toLocaleString()} />
              </dl>
              {processesOf(m.id).length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {processesOf(m.id).map((pid) => (
                    <span key={pid} className="rounded-md bg-surface-2 px-1.5 py-0.5 text-[11px] text-muted">
                      {processName.get(pid)}
                    </span>
                  ))}
                </div>
              )}
              {(canSetStatus || canEdit) && (
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  {canSetStatus && (
                    <select
                      aria-label={t('machines.status')}
                      className="h-8 rounded-lg border border-border bg-surface px-2 text-xs text-fg focus:outline-none focus:ring-2 focus:ring-brand/40"
                      value={m.status}
                      onChange={(e) =>
                        setStatus.mutate(
                          { id: m.id, status: e.target.value as MachineStatus },
                          { onError: (err) => toast({ tone: 'error', message: errorMessage(err) }) },
                        )
                      }
                    >
                      {statuses.map((s) => (
                        <option key={s} value={s}>{t(`status.${s}`)}</option>
                      ))}
                    </select>
                  )}
                  {canEdit && (
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => archiveMachine(m)}>
                      <Archive className="size-3.5" aria-hidden />
                      {t('machines.archive')}
                    </Button>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {editing && (
        <MachineForm
          key={editing === 'new' ? 'new' : editing.id}
          open
          machine={editing === 'new' ? null : editing}
          processes={processes.data ?? []}
          processIds={editing === 'new' ? [] : processesOf(editing.id)}
          cost={editing === 'new' ? 0 : costs.data?.get(editing.id) ?? 0}
          showCost={canEdit}
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
                toast({ tone: 'success', message: t('machines.saved') })
              },
            })
          }
        />
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-2 px-2.5 py-2">
      <dt className="truncate text-muted">{label}</dt>
      <dd className="tabular mt-0.5 font-semibold text-fg">{value}</dd>
    </div>
  )
}
