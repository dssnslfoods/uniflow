import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/shared/ui/button'
import { Field, Input } from '@/shared/ui/input'
import { AuthLayout } from './auth-layout'
import { AlertTriangle } from 'lucide-react'
import { useCreateTenant, useMyTenants } from './api'

export function OnboardingPage() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const navigate = useNavigate()
  const create = useCreateTenant()
  const tenants = useMyTenants()
  const [name, setName] = useState('')

  // Member of a shop but the token carries no tenant: creating more shops would only add duplicates.
  if (tenants.data && tenants.data.length > 0) {
    return (
      <AuthLayout title={t('onboarding.hookTitle')}>
        <div className="flex flex-col gap-4">
          <p className="flex gap-2 rounded-lg bg-status-paused/10 px-3 py-2.5 text-sm text-status-paused">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('errors.auth.hook_missing')}
          </p>
          <ul className="list-disc pl-5 text-sm text-muted">
            {tenants.data.map((x) => <li key={x.tenant_id}>{x.name}</li>)}
          </ul>
          <button type="button" className="text-sm text-muted hover:underline" onClick={signOut}>
            {t('auth.signOut')}
          </button>
        </div>
      </AuthLayout>
    )
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    create.mutate(name, { onSuccess: () => navigate({ to: '/orders' }) })
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
