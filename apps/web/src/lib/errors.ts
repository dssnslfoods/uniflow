import i18n from '@/shared/i18n'

type PgError = { code?: string; message?: string; details?: string | null }

// app.fail() puts an i18n key in `detail`; Postgres permission errors come back as 42501.
export function errorMessage(err: unknown): string {
  const e = (err ?? {}) as PgError
  if (e.details && i18n.exists(`errors.${e.details}`)) return i18n.t(`errors.${e.details}`)
  // Supabase Auth errors carry a stable code and an English-only message.
  if (e.code && i18n.exists(`errors.auth.${e.code}`)) return i18n.t(`errors.auth.${e.code}`)
  if (e.code === '42501') return i18n.t('errors.auth.forbidden')
  if (e.code === '23505') return i18n.t('errors.duplicate')
  return e.message || i18n.t('errors.unknown')
}
