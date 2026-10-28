import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { FileText, Plus, Search } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { orderTotal, useOrders, type SoStatus } from './api'
import { daysUntil, formatDate, formatMoney } from './format'
import { SoStatusPill } from './so-status'

const filters: (SoStatus | 'all')[] = ['all', 'draft', 'confirmed', 'in_progress', 'delivered', 'cancelled']

export function OrdersPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const navigate = useNavigate()
  const orders = useOrders()
  const [filter, setFilter] = useState<SoStatus | 'all'>('all')
  const [query, setQuery] = useState('')
  const canCreate = hasRole('admin', 'manager', 'supervisor')

  const all = orders.data ?? []
  const counts = useMemo(() => {
    const c = new Map<string, number>([['all', all.length]])
    all.forEach((o) => c.set(o.status, (c.get(o.status) ?? 0) + 1))
    return c
  }, [all])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    return all
      .filter((o) => filter === 'all' || o.status === filter)
      .filter((o) => !q || `${o.doc_no} ${o.customer_po_no} ${o.customer?.name ?? ''}`.toLowerCase().includes(q))
  }, [all, filter, query])

  const newPo = () => navigate({ to: '/orders/new' })

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('orders.title')}
        subtitle={t('orders.subtitle')}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} className="w-56 pl-9" aria-label={t('common.search')} />
            </div>
            {canCreate && (
              <Button onClick={newPo}>
                <Plus className="size-4" aria-hidden />
                {t('orders.add')}
              </Button>
            )}
          </>
        }
      />

      {orders.isLoading ? (
        <ListSkeleton />
      ) : orders.error ? (
        <ErrorNote>{errorMessage(orders.error)}</ErrorNote>
      ) : all.length === 0 ? (
        <EmptyState Icon={FileText} title={t('orders.empty')} hint={t('orders.emptyHint')} actionLabel={canCreate ? t('orders.add') : undefined} onAction={newPo} />
      ) : (
        <>
          <div className="mb-3 flex gap-1 overflow-x-auto" role="tablist">
            {filters.map((f) => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  'flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-muted hover:bg-surface-2',
                  filter === f && 'bg-surface font-medium text-fg shadow-sm ring-1 ring-border',
                )}
              >
                {f === 'all' ? t('common.total') : t(`soStatus.${f}`)}
                <span className="tabular rounded bg-surface-2 px-1.5 text-xs">{counts.get(f) ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
            <table className="w-full min-w-[720px] text-left">
              <thead className="bg-surface-2 text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">{t('orders.docNo')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('orders.customer')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('orders.dueDate')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('orders.items')}</th>
                  <th className="px-4 py-2.5 text-right font-medium">{t('orders.amount')}</th>
                  <th className="px-4 py-2.5 font-medium">{t('orders.status')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((o) => {
                  const days = o.due_date ? daysUntil(o.due_date) : null
                  const open = o.status === 'draft' || o.status === 'confirmed' || o.status === 'in_progress'
                  return (
                    // Whole row opens the PO; the SO link stays for keyboard users and open-in-new-tab.
                    <tr
                      key={o.id}
                      className="group cursor-pointer border-t border-border hover:bg-surface-2/60"
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest('a')) return
                        navigate({ to: '/orders/$orderId', params: { orderId: o.id } })
                      }}
                    >
                      <td className="px-4 py-3">
                        <Link to="/orders/$orderId" params={{ orderId: o.id }} className="font-medium group-hover:text-brand">
                          {o.doc_no}
                        </Link>
                        <div className="text-xs text-muted">PO {o.customer_po_no}</div>
                      </td>
                      <td className="px-4 py-3">{o.customer?.name}</td>
                      <td className="px-4 py-3">
                        <div>{formatDate(o.due_date)}</div>
                        {open && days !== null && (
                          <div className={cn('text-xs', days < 0 ? 'text-status-risk' : days <= 3 ? 'text-status-paused' : 'text-muted')}>
                            {days < 0 ? t('orders.overdue', { n: -days }) : days === 0 ? t('orders.dueToday') : t('orders.inDays', { n: days })}
                          </div>
                        )}
                      </td>
                      <td className="tabular px-4 py-3 text-right">{o.items.length}</td>
                      <td className="tabular px-4 py-3 text-right">{formatMoney(orderTotal(o.items))}</td>
                      <td className="px-4 py-3"><SoStatusPill status={o.status} /></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
