import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, ExternalLink, FileUp, Lock, Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select, Textarea } from '@/shared/ui/input'
import { ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { defaultAddress, useCustomers } from '../masters/customers/api'
import {
  orderTotal,
  useCancelOrder,
  useConfirmOrder,
  useOrder,
  usePoFileUrl,
  useReopenOrder,
  useSaveOrder,
  type Order,
  type OrderHeader,
  type OrderItem,
} from './api'
import { formatMoney } from './format'
import { SoStatusPill } from './so-status'

const MAX_FILE = 20 * 1024 * 1024
const today = () => new Date().toISOString().slice(0, 10)

type Line = OrderItem & { key: string }
const newKey = () => Math.random().toString(36).slice(2)
const blankLine = (): Line => ({
  key: newKey(),
  line_no: 0,
  description: '',
  spec: {},
  qty: 0,
  uom: 'ชิ้น',
  unit_price: 0,
  due_date: null,
  note: null,
})

export function NewOrderPage() {
  return <OrderEditor order={null} />
}

export function OrderEditorPage({ orderId }: { orderId: string }) {
  const order = useOrder(orderId)
  if (order.isLoading) return <ListSkeleton />
  if (order.error) return <ErrorNote>{errorMessage(order.error)}</ErrorNote>
  return <OrderEditor key={`${order.data!.id}-${order.data!.status}`} order={order.data!} />
}

function OrderEditor({ order }: { order: Order | null }) {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const customers = useCustomers()
  const save = useSaveOrder()
  const confirm = useConfirmOrder()
  const reopen = useReopenOrder()
  const cancel = useCancelOrder()

  const editable = (!order || order.status === 'draft') && hasRole('admin', 'manager', 'supervisor')
  const canManage = hasRole('admin', 'manager')

  const [header, setHeader] = useState<OrderHeader>(() => ({
    customer_id: order?.customer_id ?? '',
    customer_po_no: order?.customer_po_no ?? '',
    po_date: order?.po_date ?? today(),
    due_date: order?.due_date ?? null,
    delivery_info: order?.delivery_info ?? {},
    note: order?.note ?? null,
  }))
  const [lines, setLines] = useState<Line[]>(() =>
    order?.items.length ? order.items.map((i) => ({ ...i, key: newKey() })) : [blankLine()],
  )
  const [file, setFile] = useState<File | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)

  const set = <K extends keyof OrderHeader>(k: K, v: OrderHeader[K]) => setHeader((h) => ({ ...h, [k]: v }))
  const setLine = (key: string, patch: Partial<OrderItem>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const setSpec = (key: string, k: keyof OrderItem['spec'], v: string) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, spec: { ...l.spec, [k]: v } } : l)))

  // Prefill the delivery address from the customer when it is still empty.
  function pickCustomer(id: string) {
    set('customer_id', id)
    const c = customers.data?.find((x) => x.id === id)
    if (c && !header.delivery_info.address) set('delivery_info', { ...header.delivery_info, address: defaultAddress(c) })
  }

  function acceptFile(f: File | undefined) {
    if (!f) return
    if (!['application/pdf', 'image/png', 'image/jpeg'].includes(f.type)) return setFileError(t('orders.fileHint'))
    if (f.size > MAX_FILE) return setFileError(t('orders.fileHint'))
    setFileError(null)
    setFile(f)
  }

  const filled = lines.filter((l) => l.description.trim() || l.qty > 0)
  const total = orderTotal(filled)
  const busy = save.isPending || confirm.isPending

  async function persist(): Promise<string> {
    return save.mutateAsync({
      id: order?.id,
      header: { ...header, customer_po_no: header.customer_po_no.trim(), note: header.note?.trim() || null },
      items: filled.map(({ key: _key, ...item }) => item),
      file,
    })
  }

  async function onSaveDraft() {
    try {
      const id = await persist()
      setFile(null)
      toast({ tone: 'success', message: t('common.saved') })
      if (!order) navigate({ to: '/orders/$orderId', params: { orderId: id } })
    } catch {
      // shown inline from save.error
    }
  }

  async function onConfirm() {
    try {
      const id = await persist()
      await confirm.mutateAsync({ id })
      toast({ tone: 'success', message: t('orders.confirmed') })
      navigate({ to: '/orders/$orderId', params: { orderId: id } })
    } catch {
      // shown inline
    }
  }

  function onCancelOrder() {
    const reason = window.prompt(t('orders.cancelReason'))
    if (reason === null || !order) return
    cancel.mutate({ id: order.id, reason }, { onError: (err) => toast({ tone: 'error', message: errorMessage(err) }) })
  }

  const error = save.error ?? confirm.error

  return (
    <div className="mx-auto max-w-[1400px]">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Link to="/orders" className="rounded-lg p-1.5 text-muted hover:bg-surface-2 hover:text-fg" aria-label={t('common.back')}>
          <ArrowLeft className="size-5" />
        </Link>
        <h1 className="text-xl font-semibold">{order ? order.doc_no : t('orders.newTitle')}</h1>
        {order && <SoStatusPill status={order.status} />}
        <div className="ml-auto flex flex-wrap gap-2">
          {order?.status === 'confirmed' && canManage && (
            <>
              <Button variant="secondary" onClick={() => reopen.mutate({ id: order.id })} loading={reopen.isPending}>
                {t('orders.reopen')}
              </Button>
              <Button variant="ghost" onClick={onCancelOrder}>{t('orders.cancelOrder')}</Button>
            </>
          )}
          {order?.status === 'draft' && canManage && (
            <Button variant="ghost" onClick={onCancelOrder}>{t('orders.cancelOrder')}</Button>
          )}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <PoFilePane
          path={order?.po_file_path ?? null}
          file={file}
          editable={editable}
          error={fileError}
          onFile={acceptFile}
        />

        <div className="flex flex-col gap-4">
          {!editable && order && (
            <p className="flex items-center gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
              <Lock className="size-4" aria-hidden />
              {t('orders.readOnly')}
            </p>
          )}

          <section className="grid gap-4 rounded-[var(--radius-card)] border border-border bg-surface p-5 sm:grid-cols-2">
            <Field label={t('orders.customer')} className="sm:col-span-2">
              {(id) => (
                <Select id={id} value={header.customer_id} onChange={(e) => pickCustomer(e.target.value)} disabled={!editable} required>
                  <option value="" disabled>{t('orders.selectCustomer')}</option>
                  {(customers.data ?? []).map((c) => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
                </Select>
              )}
            </Field>
            <Field label={t('orders.poNo')}>
              {(id) => <Input id={id} value={header.customer_po_no} onChange={(e) => set('customer_po_no', e.target.value)} disabled={!editable} required />}
            </Field>
            <Field label={t('orders.poDate')}>
              {(id) => <Input id={id} type="date" value={header.po_date} onChange={(e) => set('po_date', e.target.value)} disabled={!editable} required />}
            </Field>
            <Field label={t('orders.dueDate')}>
              {(id) => <Input id={id} type="date" value={header.due_date ?? ''} onChange={(e) => set('due_date', e.target.value || null)} disabled={!editable} />}
            </Field>
            <Field label={t('orders.note')}>
              {(id) => <Input id={id} value={header.note ?? ''} onChange={(e) => set('note', e.target.value)} disabled={!editable} />}
            </Field>
            <Field label={t('orders.deliveryAddress')} className="sm:col-span-2">
              {(id) => (
                <Textarea id={id} rows={2} value={header.delivery_info.address ?? ''} disabled={!editable}
                  onChange={(e) => set('delivery_info', { ...header.delivery_info, address: e.target.value })} />
              )}
            </Field>
          </section>

          <section className="rounded-[var(--radius-card)] border border-border bg-surface">
            <header className="flex items-center justify-between border-b border-border px-5 py-3">
              <h2 className="font-semibold">{t('orders.items')}</h2>
              <span className="tabular text-sm text-muted">{t('common.total')} <b className="text-fg">{formatMoney(total)}</b></span>
            </header>
            <ol className="flex flex-col">
              {lines.map((l, i) => (
                <li key={l.key} className={cn('grid gap-2 px-5 py-4 sm:grid-cols-12', i && 'border-t border-border')}>
                  <div className="tabular flex items-start pt-2 text-sm font-semibold text-muted sm:col-span-1">{i + 1}</div>
                  <Input
                    aria-label={t('orders.description')}
                    placeholder={t('orders.description')}
                    className="sm:col-span-11"
                    value={l.description}
                    disabled={!editable}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                  />
                  <div className="grid grid-cols-2 gap-2 sm:col-span-11 sm:col-start-2 sm:grid-cols-4">
                    {(['size', 'paper', 'colors', 'finishing'] as const).map((k) => (
                      <Input key={k} aria-label={t(`orders.${k}`)} placeholder={t(`orders.${k}`)} className="h-8 text-[13px]"
                        value={l.spec[k] ?? ''} disabled={!editable} onChange={(e) => setSpec(l.key, k, e.target.value)} />
                    ))}
                  </div>
                  <div className="grid grid-cols-2 gap-2 sm:col-span-11 sm:col-start-2 sm:grid-cols-[1fr_0.7fr_1fr_1.2fr_auto] sm:items-end">
                    <MiniField label={t('orders.qty')}>
                      <Input type="number" inputMode="decimal" min={0} step="any" className="tabular h-8 text-right"
                        value={l.qty || ''} disabled={!editable} onChange={(e) => setLine(l.key, { qty: Number(e.target.value || 0) })} />
                    </MiniField>
                    <MiniField label={t('orders.uom')}>
                      <Input className="h-8" value={l.uom} disabled={!editable} onChange={(e) => setLine(l.key, { uom: e.target.value })} />
                    </MiniField>
                    <MiniField label={t('orders.unitPrice')}>
                      <Input type="number" inputMode="decimal" min={0} step="any" className="tabular h-8 text-right"
                        value={l.unit_price || ''} disabled={!editable} onChange={(e) => setLine(l.key, { unit_price: Number(e.target.value || 0) })} />
                    </MiniField>
                    <MiniField label={t('orders.lineDue')}>
                      <Input type="date" className="h-8" value={l.due_date ?? ''} disabled={!editable} onChange={(e) => setLine(l.key, { due_date: e.target.value || null })} />
                    </MiniField>
                    <div className="flex h-8 items-center justify-end gap-2">
                      <span className="tabular text-sm font-medium">{formatMoney(l.qty * l.unit_price)}</span>
                      {editable && lines.length > 1 && (
                        <button type="button" aria-label={t('common.delete')} className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-status-risk"
                          onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}>
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ol>
            {editable && (
              <div className="border-t border-border px-5 py-3">
                <Button variant="ghost" size="sm" onClick={() => setLines((ls) => [...ls, blankLine()])}>
                  <Plus className="size-4" aria-hidden />
                  {t('orders.addLine')}
                </Button>
              </div>
            )}
          </section>

          {error && <ErrorNote>{errorMessage(error)}</ErrorNote>}

          {editable && (
            <div className="sticky bottom-0 -mx-1 flex justify-end gap-2 border-t border-border bg-bg/90 px-1 py-3 backdrop-blur">
              <Button variant="secondary" onClick={onSaveDraft} loading={save.isPending && !confirm.isPending} disabled={busy || !header.customer_id || !header.customer_po_no.trim()}>
                {t('orders.saveDraft')}
              </Button>
              <Button onClick={onConfirm} loading={confirm.isPending} disabled={busy || !header.customer_id || !header.customer_po_no.trim() || filled.length === 0}>
                {t('orders.confirm')}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function MiniField({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-muted">{label}</span>
      {children}
    </label>
  )
}

type PaneProps = { path: string | null; file: File | null; editable: boolean; error: string | null; onFile: (f: File | undefined) => void }

// Left pane: the customer's PO beside the form, so lines are keyed in while reading it (D-13).
function PoFilePane({ path, file, editable, error, onFile }: PaneProps) {
  const { t } = useTranslation()
  const remote = usePoFileUrl(file ? null : path)
  const input = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const localUrl = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => { if (localUrl) URL.revokeObjectURL(localUrl) }, [localUrl])

  const url = localUrl ?? remote.data ?? null
  const isImage = file ? file.type.startsWith('image/') : /\.(png|jpe?g)$/i.test(path ?? '')

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (editable) onFile(e.dataTransfer.files[0])
  }

  return (
    <section
      className="flex min-h-[420px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface lg:sticky lg:top-6 lg:h-[calc(100vh-7rem)]"
      onDragOver={(e) => { e.preventDefault(); if (editable) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
        <h2 className="text-sm font-semibold">{t('orders.file')}</h2>
        <div className="flex gap-1">
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg">
              <ExternalLink className="size-3.5" aria-hidden />
              {t('orders.openFile')}
            </a>
          )}
          {editable && url && (
            <button type="button" onClick={() => input.current?.click()} className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2 hover:text-fg">
              {t('orders.replaceFile')}
            </button>
          )}
        </div>
      </header>

      <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      {url ? (
        isImage ? (
          <div className="flex-1 overflow-auto bg-surface-2 p-3"><img src={url} alt={t('orders.file')} className="mx-auto max-w-full" /></div>
        ) : (
          <iframe src={url} title={t('orders.file')} className="flex-1 bg-surface-2" />
        )
      ) : (
        <button
          type="button"
          disabled={!editable}
          onClick={() => input.current?.click()}
          className={cn(
            'm-4 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-muted transition-colors',
            editable && 'hover:border-brand hover:text-brand',
            dragging && 'border-brand bg-brand/5 text-brand',
          )}
        >
          <FileUp className="size-8" aria-hidden />
          <span className="font-medium">{editable ? t('orders.dropFile') : t('orders.noFile')}</span>
          {editable && <span className="text-xs">{t('orders.fileHint')}</span>}
        </button>
      )}
      {error && <p className="border-t border-border px-4 py-2 text-xs text-status-risk">{error}</p>}
    </section>
  )
}
