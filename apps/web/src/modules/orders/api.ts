import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db, rpc, supabase } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import { useTenantKey } from '@/shared/data'

export type SoStatus = 'draft' | 'confirmed' | 'in_progress' | 'delivered' | 'closed' | 'cancelled'

export type ItemSpec = { size?: string; paper?: string; colors?: string; finishing?: string }

export type OrderItem = {
  id?: string
  line_no: number
  description: string
  spec: ItemSpec
  qty: number
  uom: string
  unit_price: number
  due_date: string | null
  note: string | null
}

export type OrderHeader = {
  customer_id: string
  customer_po_no: string
  po_date: string
  due_date: string | null
  delivery_info: { address?: string }
  note: string | null
}

export type Order = OrderHeader & {
  id: string
  doc_no: string
  status: SoStatus
  po_file_path: string | null
  confirmed_at: string | null
  items: OrderItem[]
}

export type OrderRow = {
  id: string
  doc_no: string
  customer_po_no: string
  po_date: string
  due_date: string | null
  status: SoStatus
  customer: { name: string } | null
  items: { qty: number; unit_price: number }[]
}

const PO_BUCKET = 'po-files'

export function useOrders() {
  const key = useTenantKey('sales_orders')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db()
        .from('sales_orders')
        .select('id, doc_no, customer_po_no, po_date, due_date, status, customer:customers(name), items:sales_order_items(qty, unit_price)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data as unknown as OrderRow[]
    },
  })
}

export function useOrder(id: string | null) {
  const key = useTenantKey('sales_orders', id)
  return useQuery({
    queryKey: key,
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await db()
        .from('sales_orders')
        .select(
          'id, doc_no, status, customer_id, customer_po_no, po_date, due_date, delivery_info, note, po_file_path, confirmed_at, ' +
            'items:sales_order_items(id, line_no, description, spec, qty, uom, unit_price, due_date, note)',
        )
        .eq('id', id!)
        .order('line_no', { referencedTable: 'sales_order_items' })
        .single()
      if (error) throw error
      return data as unknown as Order
    },
  })
}

export function usePoFileUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: ['po-file-url', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(PO_BUCKET).createSignedUrl(path!, 60 * 60)
      if (error) throw error
      return data.signedUrl
    },
  })
}

type SaveInput = { id?: string; header: OrderHeader; items: OrderItem[]; file: File | null }

// Draft save: header → optional PO file → items (replaced; drafts have no downstream links yet).
export function useSaveOrder() {
  const listKey = useTenantKey('sales_orders')
  const qc = useQueryClient()
  const { claims } = useAuth()
  return useMutation({
    mutationFn: async ({ id, header, items, file }: SaveInput) => {
      const { data, error } = await (id
        ? db().from('sales_orders').update(header).eq('id', id).select('id').single()
        : db().from('sales_orders').insert(header).select('id').single())
      if (error) throw error
      const orderId = (data as { id: string }).id

      if (file) {
        const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
        // Storage keys must be ASCII; the tenant folder is enforced by storage RLS.
        const path = `${claims?.tenant_id}/${orderId}/po-${Date.now()}.${ext}`
        const { error: upError } = await supabase.storage.from(PO_BUCKET).upload(path, file, { contentType: file.type })
        if (upError) throw upError
        const { error: pathError } = await db().from('sales_orders').update({ po_file_path: path }).eq('id', orderId)
        if (pathError) throw pathError
      }

      const { error: delError } = await db().from('sales_order_items').delete().eq('sales_order_id', orderId)
      if (delError) throw delError
      if (items.length) {
        const { error: insError } = await db()
          .from('sales_order_items')
          .insert(items.map(({ id: _id, ...item }, i) => ({ ...item, line_no: i + 1, sales_order_id: orderId })))
        if (insError) throw insError
      }
      return orderId
    },
    onSettled: (orderId) => {
      qc.invalidateQueries({ queryKey: listKey })
      if (orderId) qc.invalidateQueries({ queryKey: [...listKey, orderId] })
    },
  })
}

function useOrderCommand(fn: 'confirm_sales_order' | 'reopen_sales_order' | 'cancel_sales_order') {
  const listKey = useTenantKey('sales_orders')
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const args = fn === 'cancel_sales_order' ? { p_order: id, p_reason: reason ?? '' } : { p_order: id }
      const { error } = await rpc().rpc(fn, args)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: listKey }),
  })
}

export const useConfirmOrder = () => useOrderCommand('confirm_sales_order')
export const useReopenOrder = () => useOrderCommand('reopen_sales_order')
export const useCancelOrder = () => useOrderCommand('cancel_sales_order')

export const orderTotal = (items: { qty: number; unit_price: number }[]) =>
  items.reduce((sum, i) => sum + Number(i.qty) * Number(i.unit_price), 0)
