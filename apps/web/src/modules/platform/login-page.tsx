import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { AuthLayout } from './auth-layout'

export function LoginPage() {
  const { t } = useTranslation()
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [fullName, setFullName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    setNotice(null)
    if (mode === 'signin') {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) setError(error.message)
    } else {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName }, emailRedirectTo: window.location.origin },
      })
      if (error) setError(error.message)
      else if (!data.session) setNotice(t('auth.checkEmail'))
    }
    setBusy(false)
  }

  return (
    <AuthLayout title={mode === 'signin' ? t('auth.title') : t('auth.signupTitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {mode === 'signup' && (
          <Field label={t('auth.fullName')}>
            {(id) => <Input id={id} value={fullName} onChange={(e) => setFullName(e.target.value)} required autoFocus />}
          </Field>
        )}
        <Field label={t('auth.email')}>
          {(id) => (
            <Input id={id} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus={mode === 'signin'} />
          )}
        </Field>
        <Field label={t('auth.password')}>
          {(id) => (
            <Input
              id={id}
              type="password"
              autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}
        </Field>
        {error && <p className="rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{error}</p>}
        {notice && <p className="rounded-lg bg-status-ready/10 px-3 py-2 text-sm text-status-ready">{notice}</p>}
        <Button type="submit" size="lg" loading={busy}>
          {mode === 'signin' ? t('auth.signIn') : t('auth.signUp')}
        </Button>
        <button
          type="button"
          className="text-sm text-brand hover:underline"
          onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
        >
          {mode === 'signin' ? t('auth.toSignUp') : t('auth.toSignIn')}
        </button>
      </form>
    </AuthLayout>
  )
}
