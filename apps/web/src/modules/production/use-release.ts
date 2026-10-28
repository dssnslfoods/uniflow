import { useTranslation } from 'react-i18next'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { useToast } from '@/shared/ui/toast'
import { useReleaseJobs } from './api'

// Release with the stock gate (BR-R07): when stock is short a manager may release anyway with a reason.
export function useRelease() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const release = useReleaseJobs()

  function run(ids: string[], reason?: string) {
    release.mutate(
      { p_jobs: ids, p_override_reason: reason ?? null },
      {
        onSuccess: (n) => toast({ tone: 'success', message: t('board.released', { n }) }),
        onError: (e) => {
          const short = (e as { details?: string }).details === 'release.stock_short'
          if (short && !reason && hasRole('manager')) {
            const why = window.prompt(`${t('inventory.overridePrompt')}\n${(e as { message?: string }).message ?? ''}`)
            if (why?.trim()) return run(ids, why.trim())
          }
          toast({ tone: 'error', message: short ? `${errorMessage(e)} · ${(e as { message?: string }).message ?? ''}` : errorMessage(e) })
        },
      },
    )
  }

  return { run, isPending: release.isPending }
}
