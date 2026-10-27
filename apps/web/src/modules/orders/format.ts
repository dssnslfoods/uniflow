import i18n from '@/shared/i18n'

const locale = () => (i18n.language === 'en' ? 'en-GB' : 'th-TH')

export const formatMoney = (n: number) =>
  new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)

export const formatDate = (iso: string | null) =>
  iso ? new Intl.DateTimeFormat(locale(), { day: 'numeric', month: 'short', year: '2-digit' }).format(new Date(iso)) : '—'

// Whole days from today to a date (negative = overdue).
export const daysUntil = (iso: string) => {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.round((new Date(iso + 'T00:00:00').getTime() - today.getTime()) / 86_400_000)
}
