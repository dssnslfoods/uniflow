import { useList } from '@/shared/data'

export type Contact = { name?: string; phone?: string; email?: string }
export type Address = { label?: string; address: string; is_default?: boolean }

export type Customer = {
  id: string
  code: string
  name: string
  tax_id: string | null
  credit_term_days: number
  contacts: Contact[]
  addresses: Address[]
  note: string | null
}

export type CustomerInput = Omit<Customer, 'id'> & { id?: string }

export const useCustomers = () =>
  useList<Customer>('customers', 'id, code, name, tax_id, credit_term_days, contacts, addresses, note', { order: ['name'] })

export const defaultAddress = (c: Pick<Customer, 'addresses'>) =>
  c.addresses.find((a) => a.is_default)?.address ?? c.addresses[0]?.address ?? ''
