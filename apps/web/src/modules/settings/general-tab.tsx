import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/shared/ui/button'
import { Field, Input, Select } from '@/shared/ui/input'
import { ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useTenant, useUpdateSettings, type TenantSettings } from './api'

const zones = ['Asia/Bangkok', 'Asia/Ho_Chi_Minh', 'Asia/Jakarta', 'Asia/Kuala_Lumpur', 'Asia/Singapore', 'Asia/Yangon', 'Asia/Vientiane', 'Asia/Phnom_Penh']

export function GeneralTab() {
  const tenant = useTenant()
  if (tenant.isLoading) return <ListSkeleton rows={4} />
  if (tenant.error) return <ErrorNote>{errorMessage(tenant.error)}</ErrorNote>
  return <GeneralForm key={tenant.data!.id} name={tenant.data!.name} plan={tenant.data!.plan_id} settings={tenant.data!.settings} />
}

function GeneralForm({ name: initialName, plan, settings }: { name: string; plan: string; settings: TenantSettings }) {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const save = useUpdateSettings()
  const canEdit = hasRole('admin')
  const [name, setName] = useState(initialName)
  const [form, setForm] = useState<TenantSettings>({
    timezone: settings.timezone ?? 'Asia/Bangkok',
    allow_self_approval: !!settings.allow_self_approval,
    overhead_pct: Number(settings.overhead_pct ?? 0),
    doc_numbering: {
      year: settings.doc_numbering?.year ?? 'ad',
      reset: settings.doc_numbering?.reset ?? 'yearly',
      digits: Number(settings.doc_numbering?.digits ?? 4),
    },
  })
  const dn = form.doc_numbering
  const year = new Date().getFullYear() + (dn.year === 'be' ? 543 : 0)
  const example = `SO-${year}${dn.reset === 'monthly' ? String(new Date().getMonth() + 1).padStart(2, '0') : ''}-${'1'.padStart(dn.digits, '0')}`

  function submit(e: FormEvent) {
    e.preventDefault()
    save.mutate(
      { name, patch: form },
      { onSuccess: () => toast({ tone: 'success', message: t('common.saved') }), onError: (err) => toast({ tone: 'error', message: errorMessage(err) }) },
    )
  }

  return (
    <form onSubmit={submit} className="flex max-w-2xl flex-col gap-5 rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <p className="text-sm text-muted">{t('settings.plan', { plan })}</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label={t('settings.shopName')}>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} required />}
        </Field>
        <Field label={t('settings.timezone')}>
          {(id) => (
            <Select id={id} value={form.timezone} disabled={!canEdit} onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}>
              {[...new Set([form.timezone, ...zones])].map((z) => <option key={z} value={z}>{z}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('settings.overhead')}>
          {(id) => (
            <Input id={id} type="number" min={0} max={500} step="any" className="tabular" disabled={!canEdit}
              value={form.overhead_pct} onChange={(e) => setForm((f) => ({ ...f, overhead_pct: Number(e.target.value || 0) }))} />
          )}
        </Field>
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-[13px] font-medium">{t('settings.docNumbering')}</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select aria-label={t('settings.docNumbering')} value={dn.year} disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, doc_numbering: { ...dn, year: e.target.value as 'ad' | 'be' } }))}>
            <option value="ad">{t('settings.yearAd')}</option>
            <option value="be">{t('settings.yearBe')}</option>
          </Select>
          <Select aria-label={t('settings.docNumbering')} value={dn.reset} disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, doc_numbering: { ...dn, reset: e.target.value as 'yearly' | 'monthly' } }))}>
            <option value="yearly">{t('settings.resetYearly')}</option>
            <option value="monthly">{t('settings.resetMonthly')}</option>
          </Select>
          <Select aria-label={t('settings.digits')} value={dn.digits} disabled={!canEdit}
            onChange={(e) => setForm((f) => ({ ...f, doc_numbering: { ...dn, digits: Number(e.target.value) } }))}>
            {[3, 4, 5, 6].map((d) => <option key={d} value={d}>{t('settings.digits')} {d}</option>)}
          </Select>
        </div>
        <p className="tabular text-xs text-muted">{t('settings.example', { ex: example })}</p>
      </fieldset>

      <label className="flex items-start gap-3 rounded-lg border border-border p-3">
        <input type="checkbox" className="mt-1 accent-[var(--brand)]" checked={form.allow_self_approval} disabled={!canEdit}
          onChange={(e) => setForm((f) => ({ ...f, allow_self_approval: e.target.checked }))} />
        <span>
          <span className="block font-medium">{t('settings.selfApproval')}</span>
          <span className="text-xs text-muted">{t('settings.selfApprovalHint')}</span>
        </span>
      </label>

      {save.error && <ErrorNote>{errorMessage(save.error)}</ErrorNote>}
      {canEdit && (
        <div className="flex justify-end">
          <Button type="submit" loading={save.isPending}>{t('common.save')}</Button>
        </div>
      )}
    </form>
  )
}
