import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { supabase } from '@/lib/supabase'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { AuthLayout } from './auth-layout'

const RESEND_SECONDS = 60

// Forgot password: send a recovery email whose link signs the person in and opens "set a new password".
// There is no code to type; the page only tells them where to look and lets them resend.
export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const [step, setStep] = useState<'email' | 'sent'>('email')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return
    const id = window.setTimeout(() => setWait((w) => w - 1), 1000)
    return () => window.clearTimeout(id)
  }, [wait])

  async function send(e?: FormEvent) {
    e?.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin })
    setBusy(false)
    if (error) return setError(errorMessage(error))
    setStep('sent')
    setWait(RESEND_SECONDS)
  }

  if (step === 'email') {
    return (
      <AuthLayout title={t('auth.forgotTitle')} subtitle={t('auth.forgotHint')}>
        <form onSubmit={send} className="flex flex-col gap-4">
          <Field label={t('auth.email')}>
            {(id) => <Input id={id} type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          {error && <p className="rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{error}</p>}
          <Button type="submit" size="lg" loading={busy}>{t('auth.sendResetLink')}</Button>
          <Link to="/login" className="text-center text-sm text-brand hover:underline">{t('auth.backToSignIn')}</Link>
        </form>
      </AuthLayout>
    )
  }

  const steps = [t('auth.resetStep1'), t('auth.resetStep2'), t('auth.resetStep3')]
  return (
    <AuthLayout title={t('auth.checkEmailTitle')}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="grid size-14 place-items-center rounded-full bg-brand/15 text-brand">
            <MailCheck className="size-7" aria-hidden />
          </div>
          <p className="text-sm text-muted">
            {t('auth.resetSentTo')}
            <br />
            <span className="break-all font-semibold text-fg">{email.trim()}</span>
          </p>
        </div>

        <ol className="flex flex-col gap-2.5 rounded-lg bg-surface-2 px-4 py-3.5 text-sm">
          {steps.map((s, i) => (
            <li key={i} className="flex items-start gap-3">
              <span className="grid size-5 shrink-0 place-items-center rounded-full bg-brand text-[11px] font-semibold text-brand-fg">{i + 1}</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>

        <p className="text-xs leading-relaxed text-muted">{t('auth.resetNotes')}</p>

        {error && <p className="rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{error}</p>}

        <div className="flex items-center justify-between text-sm">
          <button type="button" className="text-brand hover:underline disabled:text-muted disabled:no-underline" disabled={wait > 0 || busy} onClick={() => send()}>
            {wait > 0 ? t('auth.resendIn', { s: wait }) : t('auth.resendLink')}
          </button>
          <button type="button" className="text-muted hover:text-fg" onClick={() => { setStep('email'); setError(null) }}>
            {t('auth.changeEmail')}
          </button>
        </div>
        <Link to="/login" className="text-center text-sm text-brand hover:underline">{t('auth.backToSignIn')}</Link>
      </div>
    </AuthLayout>
  )
}
