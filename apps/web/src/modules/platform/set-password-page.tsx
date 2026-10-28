import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate } from '@tanstack/react-router'
import { useAuth } from '@/app/auth'
import { passwordChosen, supabase } from '@/lib/supabase'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { AuthLayout } from './auth-layout'

// Invitation links land here signed in: the new member chooses a password for later sign-ins.
export function SetPasswordPage() {
  const { t } = useTranslation()
  const { session } = useAuth()
  const navigate = useNavigate()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (password !== confirm) return setError(t('auth.passwordMismatch'))
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) return setError(error.message)
    passwordChosen()
    navigate({ to: '/' })
  }

  if (!session) {
    return (
      <AuthLayout title={t('auth.setPasswordTitle')} subtitle={t('auth.linkExpired')}>
        <Link to="/login" className="text-sm text-brand hover:underline">{t('auth.toSignIn')}</Link>
      </AuthLayout>
    )
  }

  return (
    <AuthLayout title={t('auth.setPasswordTitle')} subtitle={t('auth.setPasswordHint', { email: session.user.email })}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('auth.newPassword')}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={6} required autoFocus value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <Field label={t('auth.confirmPassword')}>
          {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={6} required value={confirm} onChange={(e) => setConfirm(e.target.value)} />}
        </Field>
        {error && <p className="rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{error}</p>}
        <Button type="submit" size="lg" loading={busy}>{t('auth.savePassword')}</Button>
      </form>
    </AuthLayout>
  )
}
