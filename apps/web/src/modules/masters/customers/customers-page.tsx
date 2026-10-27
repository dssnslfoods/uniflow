import { useMemo, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive, Mail, Phone, Plus, Search, Users } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { useArchiveRow, useSaveRow } from '@/shared/data'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Textarea } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton, PageHeader } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { defaultAddress, useCustomers, type Customer, type CustomerInput } from './api'

const blank: CustomerInput = {
  code: '',
  name: '',
  tax_id: null,
  credit_term_days: 30,
  contacts: [],
  addresses: [],
  note: null,
}

export function CustomersPage() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const customers = useCustomers()
  const save = useSaveRow<CustomerInput>('customers')
  const archive = useArchiveRow('customers')
  const [editing, setEditing] = useState<Customer | 'new' | null>(null)
  const [query, setQuery] = useState('')
  const canEdit = hasRole('admin', 'manager', 'supervisor')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = customers.data ?? []
    return q ? all.filter((c) => `${c.code} ${c.name} ${c.tax_id ?? ''}`.toLowerCase().includes(q)) : all
  }, [customers.data, query])

  function archiveRow(c: Customer) {
    archive.mutate(
      { id: c.id },
      {
        onSuccess: () =>
          toast({
            tone: 'success',
            message: t('common.archived'),
            action: { label: t('common.undo'), run: () => archive.mutate({ id: c.id, restore: true }) },
          }),
        onError: (err) => toast({ tone: 'error', message: errorMessage(err) }),
      },
    )
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader
        title={t('customers.title')}
        subtitle={t('customers.subtitle')}
        actions={
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('common.search')} className="w-56 pl-9" aria-label={t('common.search')} />
            </div>
            {canEdit && (
              <Button onClick={() => setEditing('new')}>
                <Plus className="size-4" aria-hidden />
                {t('customers.add')}
              </Button>
            )}
          </>
        }
      />

      {customers.isLoading ? (
        <ListSkeleton />
      ) : customers.error ? (
        <ErrorNote>{errorMessage(customers.error)}</ErrorNote>
      ) : rows.length === 0 && !query ? (
        <EmptyState
          Icon={Users}
          title={t('customers.empty')}
          hint={t('customers.emptyHint')}
          actionLabel={canEdit ? t('customers.add') : undefined}
          onAction={() => setEditing('new')}
        />
      ) : (
        <div className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-surface">
          {rows.map((c, i) => {
            const contact = c.contacts[0]
            return (
              <div key={c.id} className={`group flex items-center gap-4 px-4 py-3 hover:bg-surface-2/60 ${i ? 'border-t border-border' : ''}`}>
                <div className="grid size-9 shrink-0 place-items-center rounded-full bg-brand/10 text-sm font-semibold text-brand">
                  {c.name.slice(0, 1)}
                </div>
                <button className="min-w-0 flex-1 text-left disabled:cursor-default" disabled={!canEdit} onClick={() => setEditing(c)}>
                  <div className="truncate font-medium group-hover:text-brand">{c.name}</div>
                  <div className="truncate text-xs text-muted">
                    {c.code}
                    {contact?.name ? ` · ${contact.name}` : ''}
                    {defaultAddress(c) ? ` · ${defaultAddress(c)}` : ''}
                  </div>
                </button>
                <div className="hidden items-center gap-3 text-xs text-muted md:flex">
                  {contact?.phone && (
                    <a href={`tel:${contact.phone}`} className="flex items-center gap-1 hover:text-fg">
                      <Phone className="size-3.5" aria-hidden />
                      {contact.phone}
                    </a>
                  )}
                  {contact?.email && (
                    <a href={`mailto:${contact.email}`} className="flex items-center gap-1 hover:text-fg">
                      <Mail className="size-3.5" aria-hidden />
                      {contact.email}
                    </a>
                  )}
                  <span className="tabular rounded bg-surface-2 px-1.5 py-0.5">{t('customers.creditDays', { n: c.credit_term_days })}</span>
                </div>
                {canEdit && (
                  <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => archiveRow(c)}>
                    <Archive className="size-3.5" aria-hidden />
                    <span className="sr-only sm:not-sr-only">{t('common.archive')}</span>
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}

      {editing && (
        <CustomerForm
          key={editing === 'new' ? 'new' : editing.id}
          initial={editing === 'new' ? blank : editing}
          title={editing === 'new' ? t('customers.add') : editing.name}
          saving={save.isPending}
          error={save.error ? errorMessage(save.error) : null}
          onClose={() => {
            save.reset()
            setEditing(null)
          }}
          onSave={(input) =>
            save.mutate(input, {
              onSuccess: () => {
                setEditing(null)
                toast({ tone: 'success', message: t('common.saved') })
              },
            })
          }
        />
      )}
    </div>
  )
}

type FormProps = {
  initial: CustomerInput
  title: string
  saving: boolean
  error: string | null
  onClose: () => void
  onSave: (input: CustomerInput) => void
}

// The form edits the primary contact and default address; the jsonb arrays leave room for more later.
function CustomerForm({ initial, title, saving, error, onClose, onSave }: FormProps) {
  const { t } = useTranslation()
  const [form, setForm] = useState(initial)
  const [contact, setContact] = useState(initial.contacts[0] ?? {})
  const [address, setAddress] = useState(defaultAddress(initial))
  const set = <K extends keyof CustomerInput>(k: K, v: CustomerInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  function submit(e: FormEvent) {
    e.preventDefault()
    const hasContact = contact.name || contact.phone || contact.email
    onSave({
      ...form,
      tax_id: form.tax_id || null,
      note: form.note || null,
      contacts: hasContact ? [contact, ...initial.contacts.slice(1)] : initial.contacts.slice(1),
      addresses: address.trim()
        ? [{ label: 'default', address: address.trim(), is_default: true }, ...initial.addresses.filter((a) => !a.is_default)]
        : initial.addresses.filter((a) => !a.is_default),
    })
  }

  return (
    <Drawer
      open
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button>
          <Button type="submit" form="customer-form" loading={saving}>{t('common.save')}</Button>
        </>
      }
    >
      <form id="customer-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label={t('customers.code')}>
          {(id) => <Input id={id} value={form.code} onChange={(e) => set('code', e.target.value)} required autoFocus />}
        </Field>
        <Field label={t('customers.creditTerm')}>
          {(id) => <Input id={id} type="number" min={0} step={1} className="tabular" value={form.credit_term_days} onChange={(e) => set('credit_term_days', Number(e.target.value || 0))} />}
        </Field>
        <Field label={t('customers.name')} className="col-span-2">
          {(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} required />}
        </Field>
        <Field label={t('customers.taxId')} className="col-span-2">
          {(id) => <Input id={id} inputMode="numeric" value={form.tax_id ?? ''} onChange={(e) => set('tax_id', e.target.value)} />}
        </Field>
        <Field label={t('customers.contact')} className="col-span-2">
          {(id) => <Input id={id} value={contact.name ?? ''} onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))} />}
        </Field>
        <Field label={t('customers.phone')}>
          {(id) => <Input id={id} type="tel" value={contact.phone ?? ''} onChange={(e) => setContact((c) => ({ ...c, phone: e.target.value }))} />}
        </Field>
        <Field label={t('customers.email')}>
          {(id) => <Input id={id} type="email" value={contact.email ?? ''} onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))} />}
        </Field>
        <Field label={t('customers.address')} className="col-span-2">
          {(id) => <Textarea id={id} rows={3} value={address} onChange={(e) => setAddress(e.target.value)} />}
        </Field>
        <Field label={t('customers.note')} className="col-span-2">
          {(id) => <Textarea id={id} rows={2} value={form.note ?? ''} onChange={(e) => set('note', e.target.value)} />}
        </Field>
        {error && <div className="col-span-2"><ErrorNote>{error}</ErrorNote></div>}
      </form>
    </Drawer>
  )
}
