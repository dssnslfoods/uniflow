import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Trash2 } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { ErrorNote, ListSkeleton } from '@/shared/ui/page'
import { useToast } from '@/shared/ui/toast'
import { formatDate } from '../orders/format'
import { useDefaultCalendar, useHolidayMutations, useSaveShifts, type Shift } from './api'

// Monday first, the way Thai shops read their week.
const week = [1, 2, 3, 4, 5, 6, 0]
const hhmm = (time: string) => time.slice(0, 5)
const minutes = (s: Shift) => {
  const [sh, sm] = s.start_time.split(':').map(Number)
  const [eh, em] = s.end_time.split(':').map(Number)
  return Math.max(eh * 60 + em - (sh * 60 + sm), 0)
}

export function CalendarTab() {
  const calendar = useDefaultCalendar()
  if (calendar.isLoading) return <ListSkeleton rows={7} />
  if (calendar.error) return <ErrorNote>{errorMessage(calendar.error)}</ErrorNote>
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <ShiftsEditor key={calendar.dataUpdatedAt} calendarId={calendar.data!.calendar.id} initial={calendar.data!.shifts} />
      <HolidaysEditor holidays={calendar.data!.holidays} />
    </div>
  )
}

function ShiftsEditor({ calendarId, initial }: { calendarId: string; initial: Shift[] }) {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const save = useSaveShifts()
  const canEdit = hasRole('admin', 'manager')
  const [shifts, setShifts] = useState(initial.map((s) => ({ ...s, start_time: hhmm(s.start_time), end_time: hhmm(s.end_time) })))
  const [dirty, setDirty] = useState(false)
  const total = shifts.reduce((sum, s) => sum + minutes(s), 0)

  const update = (i: number, patch: Partial<Shift>) => {
    setShifts((all) => all.map((s, j) => (j === i ? { ...s, ...patch } : s)))
    setDirty(true)
  }

  function submit() {
    const invalid = shifts.some((s) => s.end_time <= s.start_time)
    if (invalid) return toast({ tone: 'error', message: t('errors.settings.invalid') })
    save.mutate(
      { calendarId, shifts },
      {
        onSuccess: () => {
          setDirty(false)
          toast({ tone: 'success', message: t('common.saved') })
        },
        onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
      },
    )
  }

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 className="font-semibold">{t('settings.shifts')}</h2>
        <span className="tabular text-xs text-muted">{t('settings.minutesPerWeek', { h: Math.round((total / 60) * 10) / 10 })}</span>
      </div>
      <p className="mb-4 text-xs text-muted">{t('settings.shiftsHint')}</p>
      <ol className="flex flex-col gap-2">
        {week.map((d) => {
          const rows = shifts.map((s, i) => ({ s, i })).filter((x) => x.s.weekday === d)
          return (
            <li key={d} className="flex flex-wrap items-center gap-2 border-b border-border pb-2 last:border-0">
              <span className="w-24 text-sm font-medium">{t(`weekday.${d}`)}</span>
              <div className="flex flex-1 flex-wrap items-center gap-2">
                {rows.length === 0 && <span className="text-sm text-muted">{t('settings.noShift')}</span>}
                {rows.map(({ s, i }) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-lg bg-surface-2 px-1.5 py-1">
                    <input type="time" aria-label="start" className="tabular rounded bg-transparent px-1 text-sm" value={s.start_time}
                      disabled={!canEdit} onChange={(e) => update(i, { start_time: e.target.value })} />
                    –
                    <input type="time" aria-label="end" className="tabular rounded bg-transparent px-1 text-sm" value={s.end_time}
                      disabled={!canEdit} onChange={(e) => update(i, { end_time: e.target.value })} />
                    {canEdit && (
                      <button type="button" aria-label={t('common.delete')} className="rounded p-0.5 text-muted hover:text-status-risk pointer-coarse:p-2"
                        onClick={() => { setShifts((all) => all.filter((_, j) => j !== i)); setDirty(true) }}>
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </span>
                ))}
                {canEdit && (
                  <button type="button" className="rounded-md p-1 text-muted hover:bg-surface-2 hover:text-fg pointer-coarse:p-3" aria-label={t('settings.addShift')}
                    onClick={() => { setShifts((all) => [...all, { weekday: d, start_time: '08:00', end_time: '17:00' }]); setDirty(true) }}>
                    <Plus className="size-4" />
                  </button>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {canEdit && (
        <div className="mt-4 flex justify-end">
          <Button onClick={submit} loading={save.isPending} disabled={!dirty}>{t('common.save')}</Button>
        </div>
      )}
    </section>
  )
}

function HolidaysEditor({ holidays }: { holidays: { id: string; day: string; name: string }[] }) {
  const { t } = useTranslation()
  const { hasRole } = useAuth()
  const toast = useToast()
  const { add, remove } = useHolidayMutations()
  const canEdit = hasRole('admin', 'manager')
  const [day, setDay] = useState('')
  const [name, setName] = useState('')
  const onError = (e: unknown) => toast({ tone: 'error', message: errorMessage(e) })

  return (
    <section className="rounded-[var(--radius-card)] border border-border bg-surface p-5">
      <h2 className="mb-3 font-semibold">{t('settings.holidays')}</h2>
      {canEdit && (
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            add.mutate({ day, name: name.trim() }, { onSuccess: () => { setDay(''); setName('') }, onError })
          }}
        >
          <Input type="date" aria-label={t('settings.holidays')} className="w-40" value={day} onChange={(e) => setDay(e.target.value)} required />
          <Input aria-label={t('settings.holidayName')} placeholder={t('settings.holidayName')} className="min-w-32 flex-1" value={name}
            onChange={(e) => setName(e.target.value)} required />
          <Button type="submit" variant="secondary" loading={add.isPending}><Plus className="size-4" aria-hidden />{t('common.add')}</Button>
        </form>
      )}
      {holidays.length === 0 ? (
        <p className="text-sm text-muted">{t('settings.noHolidays')}</p>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {holidays.map((h) => (
            <li key={h.id} className="flex items-center gap-3 py-2 text-sm">
              <span className="tabular w-24 text-muted">{formatDate(h.day)}</span>
              <span className="flex-1">{h.name}</span>
              {canEdit && (
                <button type="button" aria-label={t('common.delete')} className="rounded p-1 text-muted hover:text-status-risk pointer-coarse:p-3"
                  onClick={() => remove.mutate(h.id, { onError })}>
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
