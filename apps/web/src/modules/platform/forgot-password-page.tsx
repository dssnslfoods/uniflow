import { useEffect, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { MailCheck } from 'lucide-react'
import { errorMessage } from '@/lib/errors'
import { requirePassword, supabase } from '@/lib/supabase'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { AuthLayout } from './auth-layout'

const RESEND_SECONDS = 60

// Forgot password: send a recovery email, then confirm with the code in it (or its link).
// A confirmed code signs the person in and sends them to choose a new password.
export function ForgotPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
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
    setStep('code')
    setWait(RESEND_SECONDS)
  }

  async function verify(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'recovery' })
    setBusy(false)
    if (error) return setError(t('auth.codeInvalid'))
    requirePassword()
    navigate({ to: '/set-password' })
  }

  if (step === 'email') {
    return (
      <AuthLayout title={t('auth.forgotTitle')} subtitle={t('auth.forgotHint')}>
        <form onSubmit={send} className="flex flex-col gap-4">
          <Field label={t('auth.email')}>
            {(id) => <Input id={id} type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          {error && <p className="rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{error}</p>}
          <Button type="submit" size="lg" loading={busy}>{t('auth.sendCode')}</Button>
          <Link to="/login" className="text-center text-sm text-brand hover:underline">{t('auth.backToSignIn')}</Link>
        </form>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.enterCodeTitle')}>
      <div className="mb-5 flex items-start gap-3 rounded-lg bg-status-ready/10 px-3 py-2.5 text-sm text-status-ready">
        <MailCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>{t('auth.codeSent', { email: email.trim() })}</span>
      </div>
      <form onSubmit={verify} className="flex flex-col gap-4">
        <Field label={t('auth.code')} hint={t('auth.codeHint')}>
          {(id) => (
            <Input id={id} inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={10}
              className="tabular text-center text-lg tracking-[0.4em]" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} />
          )}
        </Field>
        {error && <p className="rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{error}</p>}
        <Button type="submit" size="lg" loading={busy} disabled={code.length < 6}>{t('auth.verifyCode')}</Button>
        <div className="flex items-center justify-between text-sm">
          <button type="button" className="text-brand hover:underline disabled:text-muted disabled:no-underline" disabled={wait > 0 || busy} onClick={() => send()}>
            {wait > 0 ? t('auth.resendIn', { s: wait }) : t('auth.resend')}
          </button>
          <button type="button" className="text-muted hover:text-fg" onClick={() => { setStep('email'); setCode(''); setError(null) }}>
            {t('auth.changeEmail')}
          </button>
        </div>
      </form>
    </AuthLayout>
  )
}
