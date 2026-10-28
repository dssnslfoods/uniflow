import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { ExternalLink, FileCheck2 } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { formatDate } from '../orders/format'
import { useProofQueue, useProofUrl, type QueueProof } from './api'
import { DecideForm, fmtWhen, proofTone } from './proof-panel'

// Proof queue (FR-6.2): what the customer still has to answer, and what needs a new version.
export function ProofsPage() {
  const { t } = useTranslation()
  const queue = useProofQueue()

  if (queue.isLoading) return <ListSkeleton />
  if (queue.error) return <ErrorNote>{errorMessage(queue.error)}</ErrorNote>
  const rows = queue.data ?? []
  const waiting = rows.filter((r) => r.status === 'pending')
  const redo = rows.filter((r) => r.status === 'rejected')

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title={t('proof.queueTitle')} subtitle={t('proof.queueSubtitle')} />
      {rows.length === 0 ? (
        <EmptyState Icon={FileCheck2} title={t('proof.queueEmpty')} hint={t('proof.queueEmptyHint')} />
      ) : (
        <>
          <Group title={t('proof.waiting', { n: waiting.length })} rows={waiting} />
          <Group title={t('proof.redo', { n: redo.length })} rows={redo} />
        </>
      )}
    </div>
  )
}

function Group({ title, rows }: { title: string; rows: QueueProof[] }) {
  if (!rows.length) return null
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-semibold">{title}</h2>
      <ul className="flex flex-col gap-3">
        {rows.map((p) => <Card key={p.id} proof={p} />)}
      </ul>
    </section>
  )
}

function Card({ proof }: { proof: QueueProof }) {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const url = useProofUrl(proof.file_path)
  const j = proof.job
  return (
    <li className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Link to="/jobs/$jobId" params={{ jobId: j.id }} className="font-medium hover:text-brand">{j.job_no} {j.title}</Link>
        <span className={cn('rounded-full px-2 py-0.5 text-xs', proofTone[proof.status])}>v{proof.version} · {t(`proof.status.${proof.status}`)}</span>
        <span className="ml-auto text-xs text-muted">{t('orders.dueDate')} {formatDate(j.due_date)}</span>
      </div>
      <p className="mt-0.5 text-xs text-muted">{j.order.doc_no} · {j.order.customer?.name} · {fmtWhen(proof.submitted_at)}</p>
      {url.data && (
        <a href={url.data} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-sm text-brand hover:underline">
          {proof.file_name ?? t('proof.open')}<ExternalLink className="size-3" aria-hidden />
        </a>
      )}
      {proof.status === 'rejected' && proof.customer_comment && (
        <p className="mt-1 text-sm"><span className="text-muted">{proof.customer_name ?? t('proof.customer')}:</span> “{proof.customer_comment}”</p>
      )}
      {proof.status === 'pending' && hasRole('admin', 'manager', 'supervisor') && <DecideForm proof={proof} />}
    </li>
  )
}
