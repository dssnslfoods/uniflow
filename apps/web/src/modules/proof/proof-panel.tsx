import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ExternalLink, FileUp, X } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input, Textarea } from '@/shared/ui/input'
import { useToast } from '@/shared/ui/toast'
import { appLocale } from '@/shared/locale'
import { useModules } from '../settings/api'
import { useDecideProof, useJobProofs, useProofUrl, useSubmitProof, type Proof, type ProofStatus } from './api'

export const proofTone: Record<ProofStatus, string> = {
  pending: 'bg-status-paused/10 text-status-paused',
  approved: 'bg-status-done/10 text-status-done',
  rejected: 'bg-status-risk/10 text-status-risk',
  superseded: 'bg-surface-2 text-muted',
}

export const fmtWhen = (iso: string) =>
  new Intl.DateTimeFormat(appLocale(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

// Artwork proofs on the job page (FR-6): versions, upload, the customer's decision.
export function ProofPanel({ jobId, active }: { jobId: string; active: boolean }) {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const modules = useModules()
  const proofs = useJobProofs(jobId)
  const canSubmit = hasRole('admin', 'manager', 'supervisor', 'staff') && active
  const canDecide = hasRole('admin', 'manager', 'supervisor')

  if (!modules.has('proof') || proofs.isLoading) return null
  const list = proofs.data ?? []

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-semibold">{t('proof.title')}</h2>
        {list[0] && <span className={cn('rounded-full px-2 py-0.5 text-xs font-medium', proofTone[list[0].status])}>{t(`proof.status.${list[0].status}`)}</span>}
      </div>
      {list.length === 0 && <p className="mb-3 text-sm text-muted">{t('proof.none')}</p>}
      <ol className="flex flex-col gap-2">
        {list.map((p) => <ProofRow key={p.id} proof={p} canDecide={canDecide} />)}
      </ol>
      {canSubmit && <UploadForm jobId={jobId} next={(list[0]?.version ?? 0) + 1} />}
    </section>
  )
}

function ProofRow({ proof, canDecide }: { proof: Proof; canDecide: boolean }) {
  const { t } = useTranslation()
  const url = useProofUrl(proof.file_path)
  return (
    <li className={cn('rounded-lg border border-border px-3 py-2.5 text-sm', proof.status === 'superseded' && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">v{proof.version}</span>
        <span className={cn('rounded-full px-2 py-0.5 text-xs', proofTone[proof.status])}>{t(`proof.status.${proof.status}`)}</span>
        {url.data && (
          <a href={url.data} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1 text-brand hover:underline">
            <span className="truncate">{proof.file_name ?? t('proof.open')}</span>
            <ExternalLink className="size-3 shrink-0" aria-hidden />
          </a>
        )}
        <span className="ml-auto text-xs text-muted">{fmtWhen(proof.submitted_at)}</span>
      </div>
      {proof.note && <p className="mt-1 text-xs text-muted">{proof.note}</p>}
      {proof.decided_at && (
        <p className="mt-1 text-xs">
          <span className="text-muted">{t('proof.decidedBy', { who: proof.customer_name ?? t('proof.customer'), when: fmtWhen(proof.decided_at) })}</span>
          {proof.customer_comment && <> · <span className="font-medium">“{proof.customer_comment}”</span></>}
        </p>
      )}
      {proof.status === 'pending' && canDecide && <DecideForm proof={proof} />}
    </li>
  )
}

export function DecideForm({ proof }: { proof: Proof }) {
  const { t } = useTranslation()
  const toast = useToast()
  const decide = useDecideProof()
  const [who, setWho] = useState('')
  const [comment, setComment] = useState('')

  function run(approved: boolean) {
    decide.mutate(
      { p_proof: proof.id, p_approved: approved, p_customer_name: who || null, p_comment: comment || null },
      {
        onSuccess: () => toast({ tone: 'success', message: approved ? t('proof.approvedOk') : t('proof.rejectedOk') }),
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <div className="mt-2 flex flex-col gap-2 rounded-lg bg-surface-2 p-2.5">
      <p className="text-xs text-muted">{t('proof.recordHint')}</p>
      <Input className="h-8 text-sm" placeholder={t('proof.customerName')} aria-label={t('proof.customerName')} value={who} onChange={(e) => setWho(e.target.value)} />
      <Textarea rows={2} className="text-sm" placeholder={t('proof.comment')} aria-label={t('proof.comment')} value={comment} onChange={(e) => setComment(e.target.value)} />
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="secondary" onClick={() => run(false)} disabled={!comment.trim()} loading={decide.isPending && decide.variables?.p_approved === false}>
          <X className="size-3.5" aria-hidden />{t('proof.reject')}
        </Button>
        <Button size="sm" onClick={() => run(true)} loading={decide.isPending && decide.variables?.p_approved === true}>
          <Check className="size-3.5" aria-hidden />{t('proof.approve')}
        </Button>
      </div>
    </div>
  )
}

function UploadForm({ jobId, next }: { jobId: string; next: number }) {
  const { t } = useTranslation()
  const toast = useToast()
  const submit = useSubmitProof()
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState('')

  function send() {
    if (!file) return
    submit.mutate(
      { jobId, file, note: note || null },
      {
        onSuccess: () => {
          toast({ tone: 'success', message: t('proof.submitted', { v: next }) })
          setFile(null)
          setNote('')
          if (input.current) input.current.value = ''
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border pt-3">
      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2 text-sm text-muted hover:border-brand/60 hover:text-fg">
        <FileUp className="size-4" aria-hidden />
        <span className="truncate">{file ? file.name : t('proof.pick', { v: next })}</span>
        <input ref={input} type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="sr-only"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      </label>
      {file && (
        <>
          <Input className="h-8 text-sm" placeholder={t('proof.note')} aria-label={t('proof.note')} value={note} onChange={(e) => setNote(e.target.value)} />
          <Button size="sm" className="self-end" onClick={send} loading={submit.isPending}>{t('proof.send', { v: next })}</Button>
        </>
      )}
    </div>
  )
}
