import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { History, PackagePlus, Package, Scale } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Select, Textarea } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { appLocale } from '@/shared/locale'
import { formatMoney } from '../orders/format'
import { fmtQty, useAdjustStock, useMovements, useReceiveStock, useStock, type StockRow } from './api'


// Inventory (FR-8): balances with reservations, receipts, count adjustments and a stock card per material.
export function InventoryPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const stock = useStock()
  const [drawer, setDrawer] = useState<{ kind: 'receive' | 'adjust' | 'card'; row: StockRow } | null>(null)
  const [filter, setFilter] = useState<'all' | 'short' | 'low'>('all')
  const canReceive = hasRole('admin', 'manager', 'supervisor')
  const canAdjust = hasRole('admin', 'manager')

  const rows = useMemo(
    () => (stock.data ?? []).filter((r) => filter === 'all' || (filter === 'short' ? r.shortage > 0 : r.below_min)),
    [stock.data, filter],
  )
  const counts = { short: (stock.data ?? []).filter((r) => r.shortage > 0).length, low: (stock.data ?? []).filter((r) => r.below_min).length }

  if (stock.isLoading) return <ListSkeleton />
  if (stock.error) return <ErrorNote>{errorMessage(stock.error)}</ErrorNote>

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title={t('inventory.title')} subtitle={t('inventory.subtitle')} />

      {(stock.data ?? []).length === 0 ? (
        <EmptyState Icon={Package} title={t('inventory.title')} hint={t('inventory.empty')} />
      ) : (
        <>
          <div className="mb-3 flex flex-wrap gap-2">
            {(['all', 'short', 'low'] as const).map((f) => (
              <button key={f} onClick={() => setFilter(f)}
                className={cn('rounded-full border px-3 py-1 text-sm', filter === f ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-border text-muted hover:bg-surface-2')}>
                {f === 'all' ? t('inventory.all') : f === 'short' ? `${t('inventory.short')} · ${counts.short}` : `${t('inventory.belowMin')} · ${counts.low}`}
              </button>
            ))}
          </div>
          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full text-sm">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">{t('inventory.material')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('inventory.onHand')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('inventory.reserved')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('inventory.available')}</th>
                  <th className="px-3 py-2 text-right font-medium">{t('inventory.minStock')}</th>
                  {canAdjust && <th className="px-3 py-2 text-right font-medium">{t('inventory.avgCost')}</th>}
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.material_id} className="border-t border-border">
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{r.name}</div>
                      <div className="text-xs text-muted">{r.code} · {t(`settings.categories.${r.category}`)}</div>
                    </td>
                    <td className="tabular px-3 py-2.5 text-right">{fmtQty(r.on_hand)} <span className="text-xs text-muted">{r.uom}</span></td>
                    <td className="tabular px-3 py-2.5 text-right text-muted">{fmtQty(r.reserved)}</td>
                    <td className="tabular px-3 py-2.5 text-right">
                      <span className={cn('font-medium', r.available <= 0 && 'text-status-risk')}>{fmtQty(r.available)}</span>
                      {r.shortage > 0 && <div className="text-xs text-status-risk">{t('inventory.shortage')} {fmtQty(r.shortage)}</div>}
                      {r.shortage <= 0 && r.below_min && <div className="text-xs text-status-paused">{t('inventory.belowMin')}</div>}
                    </td>
                    <td className="tabular px-3 py-2.5 text-right text-muted">{fmtQty(r.min_stock)}</td>
                    {canAdjust && <td className="tabular px-3 py-2.5 text-right text-muted">{r.avg_cost == null ? '—' : formatMoney(r.avg_cost)}</td>}
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        {canReceive && (
                          <Button size="sm" variant="secondary" onClick={() => setDrawer({ kind: 'receive', row: r })}>
                            <PackagePlus className="size-3.5" aria-hidden />{t('inventory.receive')}
                          </Button>
                        )}
                        {canAdjust && (
                          <Button size="sm" variant="ghost" aria-label={t('inventory.adjust')} title={t('inventory.adjust')} onClick={() => setDrawer({ kind: 'adjust', row: r })}>
                            <Scale className="size-3.5" aria-hidden />
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" aria-label={t('inventory.card')} title={t('inventory.card')} onClick={() => setDrawer({ kind: 'card', row: r })}>
                          <History className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {drawer?.kind === 'receive' && <ReceiveDrawer row={drawer.row} onClose={() => setDrawer(null)} />}
      {drawer?.kind === 'adjust' && <AdjustDrawer row={drawer.row} onClose={() => setDrawer(null)} />}
      {drawer?.kind === 'card' && <CardDrawer row={drawer.row} onClose={() => setDrawer(null)} />}
    </div>
  )
}

function ReceiveDrawer({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const receive = useReceiveStock()
  const factor = Number(row.conversion_factor) || 1
  const units = row.purchase_uom && factor !== 1 ? [row.purchase_uom, row.uom] : [row.uom]
  const [unit, setUnit] = useState(units[0])
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState(row.avg_cost ? String(unit === row.uom ? row.avg_cost : row.avg_cost * factor) : '')
  const [ref, setRef] = useState('')
  const [note, setNote] = useState('')
  const inPurchase = unit !== row.uom

  function submit(e: FormEvent) {
    e.preventDefault()
    // Stock is kept in the stock unit; purchase units convert by the material's factor.
    const q = Number(qty) * (inPurchase ? factor : 1)
    const c = Number(cost || 0) / (inPurchase ? factor : 1)
    receive.mutate(
      { p_material: row.material_id, p_qty: q, p_unit_cost: c, p_ref: ref || null, p_note: note || null },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: `${t('inventory.received')} · ${row.name} +${fmtQty(q)} ${row.uom}` })
          onClose()
        },
        onError: (er) => toast({ tone: 'error', message: errorMessage(er) }),
      },
    )
  }

  return (
    <Drawer open title={`${t('inventory.receive')} · ${row.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="rcv" loading={receive.isPending}>{t('inventory.receive')}</Button></>}>
      <form id="rcv" onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[1fr_auto] gap-3">
          <Field label={t('inventory.qty')}>{(id) => <Input id={id} type="number" min={0} step="any" required autoFocus value={qty} onChange={(e) => setQty(e.target.value)} />}</Field>
          <Field label={t('inventory.inUnit')}>
            {(id) => (
              <Select id={id} value={unit} onChange={(e) => setUnit(e.target.value)} disabled={units.length === 1}>
                {units.map((u) => <option key={u} value={u}>{u}</option>)}
              </Select>
            )}
          </Field>
        </div>
        {inPurchase && qty && <p className="-mt-2 text-xs text-muted">= {fmtQty(Number(qty) * factor)} {row.uom}</p>}
        <Field label={t('inventory.unitCost', { u: unit })}>{(id) => <Input id={id} type="number" min={0} step="any" required value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        <Field label={t('inventory.ref')}>{(id) => <Input id={id} value={ref} onChange={(e) => setRef(e.target.value)} />}</Field>
        <Field label={t('inventory.note')}>{(id) => <Textarea id={id} rows={2} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
      </form>
    </Drawer>
  )
}

function AdjustDrawer({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const adjust = useAdjustStock()
  const [count, setCount] = useState(String(Number(row.on_hand)))
  const [reason, setReason] = useState('')
  const diff = Number(count || 0) - Number(row.on_hand)

  function submit(e: FormEvent) {
    e.preventDefault()
    adjust.mutate(
      { p_material: row.material_id, p_new_on_hand: Number(count), p_reason: reason },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: t('inventory.adjusted') })
          onClose()
        },
        onError: (er) => toast({ tone: 'error', message: errorMessage(er) }),
      },
    )
  }

  return (
    <Drawer open title={`${t('inventory.adjust')} · ${row.name}`} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="adj" loading={adjust.isPending} disabled={diff === 0}>{t('inventory.adjust')}</Button></>}>
      <form id="adj" onSubmit={submit} className="flex flex-col gap-4">
        <p className="text-sm text-muted">
          {t('inventory.onHand')} {fmtQty(row.on_hand)} · {t('inventory.reserved')} {fmtQty(row.reserved)} {row.uom}
        </p>
        <Field label={t('inventory.counted', { u: row.uom })}>
          {(id) => <Input id={id} type="number" min={0} step="any" required autoFocus value={count} onChange={(e) => setCount(e.target.value)} />}
        </Field>
        {diff !== 0 && <p className={cn('-mt-2 text-sm font-medium', diff < 0 ? 'text-status-risk' : 'text-status-done')}>{diff > 0 ? '+' : ''}{fmtQty(diff)} {row.uom}</p>}
        <Field label={t('inventory.reason')}>{(id) => <Textarea id={id} rows={2} required value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
      </form>
    </Drawer>
  )
}

function CardDrawer({ row, onClose }: { row: StockRow; onClose: () => void }) {
  const { t } = useTranslation()
  const moves = useMovements(row.material_id)
  const dt = new Intl.DateTimeFormat(appLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <Drawer open size="xl" title={`${t('inventory.card')} · ${row.name}`} onClose={onClose}>
      {moves.isLoading ? <ListSkeleton rows={4} /> : moves.error ? <ErrorNote>{errorMessage(moves.error)}</ErrorNote> : (moves.data ?? []).length === 0 ? (
        <p className="text-sm text-muted">{t('inventory.noMovements')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="py-2 text-left font-medium">{t('common.date')}</th>
              <th className="py-2 text-left font-medium" />
              <th className="py-2 text-right font-medium">{t('inventory.qty')}</th>
              <th className="py-2 text-right font-medium">{t('inventory.balance')}</th>
              <th className="py-2 pl-4 text-left font-medium">{t('inventory.note')}</th>
            </tr>
          </thead>
          <tbody>
            {moves.data!.map((m) => (
              <tr key={m.id} className="border-t border-border align-top">
                <td className="whitespace-nowrap py-2 text-xs text-muted">{dt.format(new Date(m.created_at))}</td>
                <td className="py-2">{t(`inventory.types.${m.type}`)}</td>
                <td className={cn('tabular py-2 text-right font-medium', m.qty < 0 ? 'text-status-risk' : 'text-status-done')}>{m.qty > 0 ? '+' : ''}{fmtQty(m.qty)}</td>
                <td className="tabular py-2 text-right">{fmtQty(m.balance_after)}</td>
                <td className="py-2 pl-4 text-xs text-muted">
                  {m.job_no && <span className="mr-1 font-medium text-fg">{m.job_no}</span>}
                  {[m.ref, m.note].filter(Boolean).join(' · ')}
                  {m.unit_cost != null && m.type === 'receive' && <span className="ml-1">@{formatMoney(m.unit_cost)}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Drawer>
  )
}
