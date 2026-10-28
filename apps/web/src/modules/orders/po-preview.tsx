import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { ExternalLink, FileX } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { Drawer } from '@/shared/ui/drawer'
import { ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useCustomers } from '../masters/customers/api'
import { orderTotal, useOrder, usePoFileUrl } from './api'
import { formatDate, formatMoney } from './format'
import { SoStatusPill } from './so-status'

// Read-only PO in a side panel: check the customer's document without leaving the page.
export function PoPreview({ orderId, onClose }: { orderId: string; onClose: () => void }) {
  const { t } = useTranslation()
  const order = useOrder(orderId)
  const file = usePoFileUrl(order.data?.po_file_path)
  const customers = useCustomers()
  const customer = useMemo(
    () => customers.data?.find((c) => c.id === order.data?.customer_id),
    [customers.data, order.data],
  )
  const so = order.data

  return (
    <Drawer
      open
      size="xl"
      onClose={onClose}
      title={
        so ? (
          <span className="flex flex-wrap items-center gap-2">
            {so.doc_no} · PO {so.customer_po_no}
            <SoStatusPill status={so.status} />
          </span>
        ) : (
          t('orders.title')
        )
      }
      footer={
        so && (
          <Link to="/orders/$orderId" params={{ orderId: so.id }} className="inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline">
            <ExternalLink className="size-4" aria-hidden />
            {t('orders.openFull')}
          </Link>
        )
      }
    >
      {order.isLoading ? (
        <ListSkeleton rows={4} />
      ) : order.error ? (
        <ErrorNote>{errorMessage(order.error)}</ErrorNote>
      ) : so ? (
        <div className="grid h-full gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <section className="flex min-h-[360px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface-2">
            {file.data ? (
              /\.(png|jpe?g)$/i.test(so.po_file_path ?? '') ? (
                <div className="flex-1 overflow-auto p-3"><img src={file.data} alt={t('orders.file')} className="mx-auto max-w-full" /></div>
              ) : (
                <iframe src={file.data} title={t('orders.file')} className="min-h-[480px] flex-1" />
              )
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 text-muted">
                <FileX className="size-8" aria-hidden />
                {file.isLoading ? '…' : t('orders.noFile')}
              </div>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <Info label={t('orders.customer')} value={customer?.name ?? '—'} wide />
              <Info label={t('orders.poDate')} value={formatDate(so.po_date)} />
              <Info label={t('orders.dueDate')} value={formatDate(so.due_date)} />
              <Info label={t('orders.deliveryAddress')} value={so.delivery_info.address || '—'} wide />
              {so.note && <Info label={t('orders.note')} value={so.note} wide />}
            </dl>

            <div className="overflow-hidden rounded-[var(--radius-card)] border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-2 text-xs text-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t('orders.lineNo')}</th>
                    <th className="px-3 py-2 font-medium">{t('orders.description')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('orders.qty')}</th>
                    <th className="px-3 py-2 text-right font-medium">{t('orders.amount')}</th>
                  </tr>
                </thead>
                <tbody>
                  {so.items.map((i) => {
                    const spec = [i.spec.size, i.spec.paper, i.spec.colors, i.spec.finishing].filter(Boolean).join(' · ')
                    return (
                      <tr key={i.id ?? i.line_no} className="border-t border-border align-top">
                        <td className="tabular px-3 py-2 text-muted">{i.line_no}</td>
                        <td className="px-3 py-2">
                          <div className="font-medium">{i.description}</div>
                          {spec && <div className="text-xs text-muted">{spec}</div>}
                          {i.due_date && <div className="text-xs text-status-paused">{t('orders.dueDate')} {formatDate(i.due_date)}</div>}
                        </td>
                        <td className="tabular px-3 py-2 text-right">
                          {Number(i.qty).toLocaleString()} {i.uom}
                          <div className="text-xs text-muted">@ {formatMoney(Number(i.unit_price))}</div>
                        </td>
                        <td className="tabular px-3 py-2 text-right">{formatMoney(Number(i.qty) * Number(i.unit_price))}</td>
                      </tr>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-border bg-surface-2/60 font-semibold">
                    <td colSpan={3} className="px-3 py-2 text-right">{t('common.total')}</td>
                    <td className="tabular px-3 py-2 text-right">{formatMoney(orderTotal(so.items))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </Drawer>
  )
}

function Info({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? 'col-span-2' : undefined}>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="whitespace-pre-line">{value}</dd>
    </div>
  )
}
