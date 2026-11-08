import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Calculator, Minus, PackageMinus, Plus, Trash2 } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input, Select } from '@/shared/ui/input'
import { useToast } from '@/shared/ui/toast'
import { useModules } from '../settings/api'
import { fmtQty, useIssueMaterial, useJobMaterials, useSetJobMaterials, useStock, type StockRow } from './api'

type Line = { material_id: string; required_qty: string }

// Sheets the first sheet-fed step needs: pieces ÷ n-up, plus the process waste and machine make-ready.
export type SheetHint = { sheets: number } | null

// Bill of materials on a job card (FR-8.2). Reserved on approval, re-checked at release.
export function JobMaterialsEditor({ jobId, editable, sheetHint }: { jobId: string; editable: boolean; sheetHint: SheetHint }) {
  const { t } = useTranslation()
  const toast = useToast()
  const modules = useModules()
  const stock = useStock()
  const current = useJobMaterials(jobId)
  const save = useSetJobMaterials()
  const [lines, setLines] = useState<Line[]>([])
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (current.data && !dirty) setLines(current.data.map((m) => ({ material_id: m.material_id, required_qty: String(Number(m.required_qty)) })))
  }, [current.data, dirty])

  if (!modules.has('inventory') || current.isLoading || stock.isLoading) return null
  const byId = new Map((stock.data ?? []).map((s) => [s.material_id, s]))
  const saved = new Map((current.data ?? []).map((m) => [m.material_id, m]))
  if (!editable && lines.length === 0) return null

  const edit = (next: Line[]) => {
    setLines(next)
    setDirty(true)
  }
  const unused = (stock.data ?? []).filter((s) => !lines.some((l) => l.material_id === s.material_id))

  function onSave() {
    save.mutate(
      { p_job: jobId, p_items: lines.filter((l) => Number(l.required_qty) > 0).map((l) => ({ material_id: l.material_id, required_qty: Number(l.required_qty) })) },
      {
        onSuccess: (short) => {
          setDirty(false)
          toast({ tone: short ? 'error' : 'success', message: short ? t('inventory.bomShort') : t('inventory.bomSaved') })
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <section className="border-t border-border px-5 py-3">
      <div className="mb-2 flex flex-wrap items-baseline gap-2">
        <h3 className="text-sm font-semibold">{t('inventory.bom')}</h3>
        <span className="text-xs text-muted">{t('inventory.bomHint')}</span>
      </div>
      <ul className="flex flex-col gap-1.5">
        {lines.map((l, i) => {
          const s = byId.get(l.material_id)
          const m = saved.get(l.material_id)
          const short = m && Number(m.reserved_qty) < Number(m.required_qty) - Number(m.issued_qty)
          return (
            <li key={l.material_id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate">{s?.name ?? '—'} <span className="text-xs text-muted">{s?.code}</span></span>
              {editable && s?.category === 'paper' && sheetHint && (
                <button type="button" className="inline-flex items-center gap-1 text-xs text-brand hover:underline"
                  onClick={() => edit(lines.map((x, j) => (j === i ? { ...x, required_qty: String(sheetHint.sheets) } : x)))}>
                  <Calculator className="size-3" aria-hidden />{t('inventory.calcSheets')} ({fmtQty(sheetHint.sheets)})
                </button>
              )}
              {editable ? (
                <Input type="number" min={0} step="any" aria-label={t('inventory.required')} className="tabular h-8 w-28 text-right"
                  value={l.required_qty} onChange={(e) => edit(lines.map((x, j) => (j === i ? { ...x, required_qty: e.target.value } : x)))} />
              ) : (
                <span className="tabular">{fmtQty(Number(l.required_qty))}</span>
              )}
              <span className="w-12 text-xs text-muted">{s?.uom}</span>
              {m && !dirty && (
                <span className={cn('tabular w-32 text-right text-xs', short ? 'text-status-risk' : 'text-muted')}>
                  {short ? t('inventory.short') : `${t('inventory.reserved')} ${fmtQty(m.reserved_qty)}`}
                </span>
              )}
              {editable && (
                <button type="button" aria-label={t('common.delete')} disabled={!!m && Number(m.issued_qty) > 0}
                  className="rounded p-1 text-muted hover:bg-surface-2 hover:text-status-risk disabled:opacity-30"
                  onClick={() => edit(lines.filter((_, j) => j !== i))}>
                  <Trash2 className="size-3.5" aria-hidden />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {editable && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {unused.length > 0 && (
            <Select aria-label={t('inventory.addMaterial')} className="h-8 w-56 text-xs" value=""
              onChange={(e) => e.target.value && edit([...lines, { material_id: e.target.value, required_qty: '' }])}>
              <option value="">+ {t('inventory.addMaterial')}</option>
              {unused.map((s) => <option key={s.material_id} value={s.material_id}>{s.code} · {s.name} ({t('inventory.available')} {fmtQty(s.available)} {s.uom})</option>)}
            </Select>
          )}
          {dirty && (
            <Button size="sm" className="ml-auto" onClick={onSave} loading={save.isPending}>{t('inventory.saveBom')}</Button>
          )}
        </div>
      )}
    </section>
  )
}

// Issue to the floor / return leftovers (FR-8.3) from the job page.
export function JobMaterialsIssue({ jobId, active }: { jobId: string; active: boolean }) {
  const { t } = useTranslation()
  const modules = useModules()
  const stock = useStock()
  const current = useJobMaterials(jobId)
  const [open, setOpen] = useState<{ row: StockRow; dir: 1 | -1 } | null>(null)

  if (!modules.has('inventory') || !current.data?.length) return null
  const byId = new Map((stock.data ?? []).map((s) => [s.material_id, s]))

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <h2 className="mb-2 font-semibold">{t('inventory.bom')}</h2>
      <div className="overflow-x-auto">
      <table className="w-full min-w-[420px] text-sm">
        <thead className="text-xs text-muted">
          <tr>
            <th className="py-1.5 text-left font-medium">{t('inventory.material')}</th>
            <th className="py-1.5 text-right font-medium">{t('inventory.required')}</th>
            <th className="py-1.5 text-right font-medium">{t('inventory.issued')}</th>
            <th className="py-1.5 text-right font-medium">{t('inventory.reserved')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {current.data.map((m) => {
            const s = byId.get(m.material_id)
            return (
              <tr key={m.material_id} className="border-t border-border">
                <td className="py-2">{s?.name} <span className="text-xs text-muted">{s?.uom}</span></td>
                <td className="tabular py-2 text-right">{fmtQty(m.required_qty)}</td>
                <td className="tabular py-2 text-right font-medium">{fmtQty(m.issued_qty)}</td>
                <td className="tabular py-2 text-right text-muted">{fmtQty(m.reserved_qty)}</td>
                <td className="py-2 pl-2 text-right">
                  {active && s && (
                    <div className="inline-flex gap-1">
                      <Button size="sm" variant="secondary" onClick={() => setOpen({ row: s, dir: 1 })}>
                        <PackageMinus className="size-3.5" aria-hidden />{t('inventory.issue')}
                      </Button>
                      {Number(m.issued_qty) > 0 && (
                        <Button size="sm" variant="ghost" onClick={() => setOpen({ row: s, dir: -1 })}>{t('inventory.returnIt')}</Button>
                      )}
                    </div>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      </div>
      {open && (
        <IssueForm jobId={jobId} row={open.row} dir={open.dir}
          suggested={Math.max(0, open.dir === 1
            ? Number(current.data.find((m) => m.material_id === open.row.material_id)!.required_qty) - Number(current.data.find((m) => m.material_id === open.row.material_id)!.issued_qty)
            : 0)}
          onClose={() => setOpen(null)} />
      )}
    </section>
  )
}

function IssueForm({ jobId, row, dir, suggested, onClose }: { jobId: string; row: StockRow; dir: 1 | -1; suggested: number; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const issue = useIssueMaterial()
  const [qty, setQty] = useState(suggested ? String(suggested) : '')

  function submit() {
    issue.mutate(
      { p_job: jobId, p_material: row.material_id, p_qty: dir * Number(qty), p_note: null },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: `${dir === 1 ? t('inventory.issuedOk') : t('inventory.returnedOk')} · ${row.name} ${fmtQty(Number(qty))} ${row.uom}` })
          onClose()
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-surface-2 p-3 text-sm">
      {dir === 1 ? <Minus className="size-4 text-status-risk" aria-hidden /> : <Plus className="size-4 text-status-done" aria-hidden />}
      <span className="font-medium">{row.name}</span>
      <Input type="number" min={0} step="any" autoFocus aria-label={dir === 1 ? t('inventory.issueQty', { u: row.uom }) : t('inventory.returnQty', { u: row.uom })}
        className="tabular h-8 w-28 text-right" value={qty} onChange={(e) => setQty(e.target.value)} />
      <span className="text-xs text-muted">{row.uom} · {t('inventory.onHand')} {fmtQty(row.on_hand)}</span>
      <div className="ml-auto flex gap-2">
        <Button size="sm" variant="ghost" onClick={onClose}>{t('common.cancel')}</Button>
        <Button size="sm" onClick={submit} disabled={!(Number(qty) > 0)} loading={issue.isPending}>{dir === 1 ? t('inventory.issue') : t('inventory.returnIt')}</Button>
      </div>
    </div>
  )
}
