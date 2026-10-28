import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Star, Truck } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { useSaveRow } from '@/shared/data'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useProcesses } from '../masters/processes/api'
import { useSaveVendorServices, useVendorServices, useVendors, type Vendor } from './api'

type VendorInput = { id?: string; code: string; name: string; rating: number | null; contacts: { name?: string; phone?: string }[] }

export function VendorsTab() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const vendors = useVendors()
  const services = useVendorServices()
  const processes = useProcesses()
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null)
  const canEdit = hasRole('admin', 'manager', 'supervisor')
  const processName = new Map((processes.data ?? []).map((p) => [p.id, p.name]))

  if (vendors.isLoading) return <ListSkeleton />
  if (vendors.error) return <ErrorNote>{errorMessage(vendors.error)}</ErrorNote>
  const rows = vendors.data ?? []

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />{t('settings.vendorAdd')}</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState Icon={Truck} title={t('settings.vendorAdd')} hint={t('settings.services')} actionLabel={canEdit ? t('settings.vendorAdd') : undefined} onAction={() => setEditing('new')} />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {rows.map((v, i) => {
            const mine = (services.data ?? []).filter((s) => s.vendor_id === v.id)
            return (
              <button key={v.id} type="button" disabled={!canEdit} onClick={() => setEditing(v)}
                className={`flex w-full flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-surface-2/60 disabled:cursor-default ${i ? 'border-t border-border' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{v.name}</div>
                  <div className="text-xs text-muted">{v.code}{v.contacts[0]?.name ? ` · ${v.contacts[0].name}` : ''}{v.contacts[0]?.phone ? ` · ${v.contacts[0].phone}` : ''}</div>
                </div>
                <div className="flex flex-wrap gap-1">
                  {mine.map((s) => (
                    <span key={s.process_id} className="rounded-full bg-status-paused/10 px-2 py-0.5 text-xs text-status-paused">
                      {processName.get(s.process_id)} · {t('settings.days', { n: s.lead_time_days })}
                    </span>
                  ))}
                </div>
                {v.rating != null && (
                  <span className="tabular inline-flex items-center gap-0.5 text-sm"><Star className="size-3.5 text-status-paused" aria-hidden />{v.rating}</span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {editing && <VendorDrawer vendor={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function VendorDrawer({ vendor, onClose }: { vendor: Vendor | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveRow<VendorInput>('vendors')
  const saveServices = useSaveVendorServices()
  const processes = useProcesses()
  const services = useVendorServices()
  const outsource = (processes.data ?? []).filter((p) => p.step_type === 'outsource')
  const [form, setForm] = useState<VendorInput>(
    vendor ? { code: vendor.code, name: vendor.name, rating: vendor.rating, contacts: vendor.contacts } : { code: '', name: '', rating: null, contacts: [] },
  )
  const contact = form.contacts[0] ?? {}
  const [leads, setLeads] = useState<Record<string, number>>(() =>
    Object.fromEntries((services.data ?? []).filter((s) => s.vendor_id === vendor?.id).map((s) => [s.process_id, Number(s.lead_time_days)])),
  )

  async function submit(e: FormEvent) {
    e.preventDefault()
    try {
      const id = await save.mutateAsync({ ...form, id: vendor?.id })
      await saveServices.mutateAsync({
        vendorId: id,
        services: Object.entries(leads).map(([process_id, lead_time_days]) => ({ process_id, lead_time_days })),
      })
      toast({ tone: 'success', message: t('common.saved') })
      onClose()
    } catch (err) {
      toast({ tone: 'error', message: errorMessage(err) })
    }
  }

  return (
    <Drawer open title={vendor ? vendor.name : t('settings.vendorAdd')} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="vendor-form" loading={save.isPending || saveServices.isPending}>{t('common.save')}</Button></>}>
      <form id="vendor-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label={t('settings.vendorCode')}>{(id) => <Input id={id} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} required autoFocus />}</Field>
        <Field label={t('settings.rating')}>{(id) => <Input id={id} type="number" min={0} max={5} step={0.5} value={form.rating ?? ''} onChange={(e) => setForm({ ...form, rating: e.target.value === '' ? null : Number(e.target.value) })} />}</Field>
        <Field label={t('settings.vendorName')} className="col-span-2">{(id) => <Input id={id} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />}</Field>
        <Field label={t('settings.contact')}>{(id) => <Input id={id} value={contact.name ?? ''} onChange={(e) => setForm({ ...form, contacts: [{ ...contact, name: e.target.value }] })} />}</Field>
        <Field label={t('settings.phone')}>{(id) => <Input id={id} type="tel" value={contact.phone ?? ''} onChange={(e) => setForm({ ...form, contacts: [{ ...contact, phone: e.target.value }] })} />}</Field>
        <fieldset className="col-span-2 flex flex-col gap-2">
          <legend className="mb-1 text-[13px] font-medium">{t('settings.services')}</legend>
          {outsource.length === 0 && <p className="text-xs text-muted">{t('settings.noOutsource')}</p>}
          {outsource.map((p) => {
            const on = p.id in leads
            return (
              <label key={p.id} className="flex items-center gap-3 rounded-lg border border-border px-3 py-2">
                <input type="checkbox" className="accent-[var(--brand)]" checked={on}
                  onChange={(e) => setLeads((l) => { const n = { ...l }; if (e.target.checked) n[p.id] = 1; else delete n[p.id]; return n })} />
                <span className="flex-1 text-sm">{p.name}</span>
                {on && (
                  <Input type="number" min={0} step={0.5} aria-label={t('settings.leadTime')} className="tabular h-8 w-24 text-right"
                    value={leads[p.id]} onChange={(e) => setLeads((l) => ({ ...l, [p.id]: Number(e.target.value || 0) }))} />
                )}
              </label>
            )
          })}
        </fieldset>
      </form>
    </Drawer>
  )
}
