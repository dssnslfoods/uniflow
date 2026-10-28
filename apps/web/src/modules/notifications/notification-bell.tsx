import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from '@tanstack/react-router'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell } from 'lucide-react'
import { db, rpc } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useTenantKey } from '@/shared/data'

type Notification = { id: number; kind: string; params: Record<string, string | number | null>; link: string | null; read_at: string | null; created_at: string }

function useNotifications() {
  const key = useTenantKey('notifications')
  return useQuery({
    queryKey: key,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data, error } = await db()
        .from('notifications')
        .select('id, kind, params, link, read_at, created_at')
        .order('created_at', { ascending: false })
        .limit(30)
      if (error) throw error
      return data as Notification[]
    },
  })
}

function useMarkRead() {
  const qc = useQueryClient()
  const key = useTenantKey('notifications')
  return useMutation({
    mutationFn: async (ids: number[] | null) => {
      const { error } = await rpc().rpc('mark_notifications_read', { p_ids: ids })
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}

const ago = (iso: string) => {
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`
}

// In-app notifications (M11): unread badge, list, click to open the linked page.
export function NotificationBell() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const list = useNotifications()
  const markRead = useMarkRead()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const unread = (list.data ?? []).filter((n) => !n.read_at).length

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  function openItem(n: Notification) {
    if (!n.read_at) markRead.mutate([n.id])
    setOpen(false)
    if (n.link) navigate({ to: n.link })
  }

  const text = (n: Notification) =>
    t(`notifications.${n.kind}`, {
      ...n.params,
      reason: n.params.reason ?? '',
      reasonText: n.params.reason ? t(`downtime.${n.params.reason}`, { defaultValue: String(n.params.reason) }) : '',
      defaultValue: n.kind,
    })

  return (
    <div ref={ref} className="relative">
      <button
        aria-label={t('notifications.title')}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="relative grid size-9 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-fg"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="tabular absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-status-risk px-1 text-center text-[10px] font-bold leading-4 text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-border bg-surface shadow-xl md:left-auto md:right-auto">
          <header className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h2 className="font-semibold">{t('notifications.title')}</h2>
            {unread > 0 && (
              <button className="text-xs text-brand hover:underline" onClick={() => markRead.mutate(null)}>{t('notifications.markAll')}</button>
            )}
          </header>
          <ul className="max-h-96 overflow-y-auto">
            {(list.data ?? []).length === 0 && <li className="px-4 py-6 text-center text-sm text-muted">{t('notifications.empty')}</li>}
            {(list.data ?? []).map((n) => (
              <li key={n.id}>
                <button
                  onClick={() => openItem(n)}
                  className={cn('flex w-full gap-2 border-b border-border px-4 py-2.5 text-left text-sm last:border-0 hover:bg-surface-2', !n.read_at && 'bg-brand/5')}
                >
                  {!n.read_at && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" aria-hidden />}
                  <span className="min-w-0 flex-1">{text(n)}</span>
                  <span className="shrink-0 text-xs text-muted">{ago(n.created_at)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
