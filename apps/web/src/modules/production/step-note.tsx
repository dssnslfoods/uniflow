import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MessageSquarePlus, Pencil } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { useToast } from '@/shared/ui/toast'
import { useSetStepNote } from './api'

type Props = {
  stepId: string
  note: string | null
  canEdit: boolean
  /** Bigger targets for the shop-floor sheet. */
  big?: boolean
  onSaved?: (note: string | null) => void
  className?: string
}

// A step's free-text note. Saved on its own (api.set_step_note): no re-approval, any role from Staff up.
export function StepNote({ stepId, note, canEdit, big, onSaved, className }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSetStepNote()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note ?? '')

  if (!editing) {
    if (!note && !canEdit) return null
    return (
      <div className={cn('flex items-start gap-2', className)}>
        {note && <p className={cn('min-w-0 flex-1 whitespace-pre-wrap rounded-lg bg-surface-2 px-3 py-2', big ? 'text-base' : 'text-xs')}>{note}</p>}
        {canEdit && (
          <button type="button" onClick={() => { setDraft(note ?? ''); setEditing(true) }}
            className={cn('inline-flex shrink-0 items-center gap-1 rounded-full text-muted hover:bg-surface-2 hover:text-brand', big ? 'px-3 py-2 text-sm' : 'px-2 py-1 text-xs')}>
            {note ? <Pencil className="size-3.5" aria-hidden /> : <MessageSquarePlus className="size-3.5" aria-hidden />}
            {note ? t('stepNote.edit') : t('stepNote.add')}
          </button>
        )}
      </div>
    )
  }

  function submit() {
    const value = draft.trim() || null
    save.mutate(
      { p_step: stepId, p_note: value },
      {
        onSuccess: () => {
          onSaved?.(value)
          setEditing(false)
          toast({ tone: 'success', message: t('stepNote.saved') })
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <div className={cn('flex w-full flex-col gap-2', className)}>
      <textarea
        aria-label={t('stepNote.label')}
        placeholder={t('stepNote.placeholder')}
        value={draft}
        maxLength={2000}
        rows={big ? 4 : 2}
        autoFocus
        onChange={(e) => setDraft(e.target.value)}
        className={cn('w-full rounded-lg border border-border bg-surface px-3 py-2 focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40', big ? 'text-base' : 'text-sm')}
      />
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size={big ? 'lg' : 'sm'} onClick={() => setEditing(false)} disabled={save.isPending}>{t('common.cancel')}</Button>
        <Button size={big ? 'lg' : 'sm'} loading={save.isPending} onClick={submit}>{t('common.save')}</Button>
      </div>
    </div>
  )
}
