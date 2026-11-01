import i18n from './i18n'

// Dates and numbers follow the app language (th/en), never the browser's own locale.
export const appLocale = () => (i18n.language === 'en' ? 'en-GB' : 'th-TH')

// yyyy-mm-dd on this device's calendar; toISOString() is UTC, a day behind before 07:00 in Bangkok.
export function localDate(offsetDays = 0) {
  const d = new Date(Date.now() + offsetDays * 86_400_000)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
