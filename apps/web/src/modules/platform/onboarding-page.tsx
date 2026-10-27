import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { AuthLayout } from './auth-layout'
import { useCreateTenant } from './api'

export function OnboardingPage() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const create = useCreateTenant()
  const [name, setName] = useState('')

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate(name, { onSuccess: () => navigate({ to: '/machines' }) })
  }

  return (
    <AuthLayout title={t('onboarding.title')} subtitle={t('onboarding.subtitle')}>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Field label={t('onboarding.shopName')}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required autoFocus />}
        </Field>
        {create.error && (
          <p className="rounded-lg bg-status-risk/10 px-3 py-2 text-sm text-status-risk">{errorMessage(create.error)}</p>
        )}
        <Button type="submit" size="lg" loading={create.isPending}>
          {t('onboarding.create')}
        </Button>
        <button type="button" className="text-sm text-muted hover:underline" onClick={signOut}>
          {t('auth.signOut')}
        </button>
      </form>
    </AuthLayout>
  )
}
