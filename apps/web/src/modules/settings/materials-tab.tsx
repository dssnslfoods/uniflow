import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Boxes, Plus } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { useSaveRow } from '@/shared/data'
import { Button } from '@/shared/ui/button'
import { Drawer } from '@/shared/ui/drawer'
import { Field, Input, Select } from '@/shared/ui/input'
import { EmptyState, ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { useMaterials, type Material } from './api'

const categories: Material['category'][] = ['paper', 'ink', 'plate', 'consumable', 'other']
type MaterialInput = Omit<Material, 'id'> & { id?: string }
const blank: MaterialInput = { code: '', name: '', category: 'paper', uom: 'แผ่น', purchase_uom: 'รีม', conversion_factor: 500, min_stock: 0 }

// Material master (FR-1.6). Stock movements arrive with Inventory in Phase 2 (D-01).
export function MaterialsTab() {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const materials = useMaterials()
  const [editing, setEditing] = useState<Material | 'new' | null>(null)
  const canEdit = hasRole('admin', 'manager')

  if (materials.isLoading) return <ListSkeleton />
  if (materials.error) return <ErrorNote>{errorMessage(materials.error)}</ErrorNote>
  const rows = materials.data ?? []

  return (
    <div className="flex flex-col gap-4">
      {canEdit && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing('new')}><Plus className="size-4" aria-hidden />{t('settings.materialAdd')}</Button>
        </div>
      )}
      {rows.length === 0 ? (
        <EmptyState Icon={Boxes} title={t('settings.materialAdd')} hint={t('settings.tabs.materials')} actionLabel={canEdit ? t('settings.materialAdd') : undefined} onAction={() => setEditing('new')} />
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-surface">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-surface-2 text-xs text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">{t('settings.materialName')}</th>
                <th className="px-4 py-2.5 font-medium">{t('settings.category')}</th>
                <th className="px-4 py-2.5 font-medium">{t('settings.uom')}</th>
                <th className="px-4 py-2.5 text-right font-medium">{t('settings.minStock')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} onClick={() => canEdit && setEditing(m)} className={`border-t border-border ${canEdit ? 'cursor-pointer hover:bg-surface-2/60' : ''}`}>
                  <td className="px-4 py-2.5"><div className="font-medium">{m.name}</div><div className="text-xs text-muted">{m.code}</div></td>
                  <td className="px-4 py-2.5">{t(`settings.categories.${m.category}`)}</td>
                  <td className="px-4 py-2.5">{m.uom}{m.purchase_uom ? ` (1 ${m.purchase_uom} = ${Number(m.conversion_factor).toLocaleString()} ${m.uom})` : ''}</td>
                  <td className="tabular px-4 py-2.5 text-right">{Number(m.min_stock).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editing && <MaterialDrawer material={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

function MaterialDrawer({ material, onClose }: { material: Material | null; onClose: () => void }) {
  const { t } = useTranslation()
  const toast = useToast()
  const save = useSaveRow<MaterialInput>('materials')
  const [form, setForm] = useState<MaterialInput>(material ?? blank)
  const set = <K extends keyof MaterialInput>(k: K, v: MaterialInput[K]) => setForm((f) => ({ ...f, [k]: v }))

  function submit(e: FormEvent) {
    e.preventDefault()
    const { id: _id, ...values } = form as MaterialInput
    save.mutate(
      { ...values, purchase_uom: values.purchase_uom || null, id: material?.id },
      { onSuccess: () => { toast({ tone: 'success', message: t('common.saved') }); onClose() } },
    )
  }

  return (
    <Drawer open title={material ? material.name : t('settings.materialAdd')} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>{t('common.cancel')}</Button><Button type="submit" form="material-form" loading={save.isPending}>{t('common.save')}</Button></>}>
      <form id="material-form" onSubmit={submit} className="grid grid-cols-2 gap-4">
        <Field label={t('customers.code')}>{(id) => <Input id={id} value={form.code} onChange={(e) => set('code', e.target.value)} required autoFocus />}</Field>
        <Field label={t('settings.category')}>
          {(id) => (
            <Select id={id} value={form.category} onChange={(e) => set('category', e.target.value as Material['category'])}>
              {categories.map((c) => <option key={c} value={c}>{t(`settings.categories.${c}`)}</option>)}
            </Select>
          )}
        </Field>
        <Field label={t('settings.materialName')} className="col-span-2">{(id) => <Input id={id} value={form.name} onChange={(e) => set('name', e.target.value)} required />}</Field>
        <Field label={t('settings.uom')}>{(id) => <Input id={id} value={form.uom} onChange={(e) => set('uom', e.target.value)} required />}</Field>
        <Field label={t('settings.purchaseUom')}>{(id) => <Input id={id} value={form.purchase_uom ?? ''} onChange={(e) => set('purchase_uom', e.target.value)} />}</Field>
        <Field label={t('settings.conversion')}>{(id) => <Input id={id} type="number" min={0.0001} step="any" className="tabular" value={form.conversion_factor} onChange={(e) => set('conversion_factor', Number(e.target.value || 1))} />}</Field>
        <Field label={t('settings.minStock')}>{(id) => <Input id={id} type="number" min={0} step="any" className="tabular" value={form.min_stock} onChange={(e) => set('min_stock', Number(e.target.value || 0))} />}</Field>
        {save.error && <div className="col-span-2"><ErrorNote>{errorMessage(save.error)}</ErrorNote></div>}
      </form>
    </Drawer>
  )
}
