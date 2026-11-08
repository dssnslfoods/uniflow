import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ImagePlus, Trash2, X } from 'lucide-react'
import { useAuth } from '@/app/auth'
import { errorMessage } from '@/lib/errors'
import { shrinkImage } from '@/lib/image'
import { db, rpc, supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { useTenantKey } from '@/shared/data'
import { Button } from '@/shared/ui/button'
import { useToast } from '@/shared/ui/toast'

const BUCKET = 'job-images'

type JobImage = { id: string; file_path: string; width: number | null; height: number | null; created_by: string | null; created_at: string; url: string | null }

function useJobImages(jobId: string) {
  const key = useTenantKey('job-images', jobId)
  return useQuery({
    queryKey: key,
    staleTime: 30 * 60_000,   // signed URLs last an hour
    queryFn: async () => {
      const { data, error } = await db()
        .from('job_images')
        .select('id, file_path, width, height, created_by, created_at')
        .eq('job_id', jobId)
        .order('created_at')
      if (error) throw error
      const rows = data as Omit<JobImage, 'url'>[]
      if (rows.length === 0) return [] as JobImage[]
      const signed = await supabase.storage.from(BUCKET).createSignedUrls(rows.map((r) => r.file_path), 60 * 60)
      if (signed.error) throw signed.error
      const urls = new Map(signed.data.map((s) => [s.path, s.signedUrl]))
      return rows.map((r) => ({ ...r, url: urls.get(r.file_path) ?? null }))
    },
  })
}

function useAddImages(jobId: string) {
  const { claims } = useAuth()
  const qc = useQueryClient()
  const key = useTenantKey('job-images', jobId)
  const jobKey = useTenantKey('job')
  return useMutation({
    mutationFn: async (files: File[]) => {
      for (const file of files) {
        const { blob, width, height } = await shrinkImage(file)
        const path = `${claims?.tenant_id}/${jobId}/${crypto.randomUUID()}.jpg`
        const up = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg' })
        if (up.error) throw up.error
        const { error } = await rpc().rpc('add_job_image', { p_job: jobId, p_file_path: path, p_width: width, p_height: height, p_size_bytes: blob.size })
        if (error) {
          await supabase.storage.from(BUCKET).remove([path])
          throw error
        }
      }
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: jobKey })]),
  })
}

function useRemoveImage(jobId: string) {
  const qc = useQueryClient()
  const key = useTenantKey('job-images', jobId)
  const jobKey = useTenantKey('job')
  return useMutation({
    mutationFn: async (imageId: string) => {
      const { data, error } = await rpc().rpc('remove_job_image', { p_image: imageId })
      if (error) throw error
      // The row is gone; the file is cleanup only, so a failure here is not the user's problem.
      await supabase.storage.from(BUCKET).remove([data as string])
    },
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: key }), qc.invalidateQueries({ queryKey: jobKey })]),
  })
}

type Props = {
  jobId: string
  /** The job is still open (not completed / cancelled). */
  open: boolean
  /** Bigger targets for the shop-floor sheet. */
  big?: boolean
  className?: string
}

// Reference photos for a job, visible on every step of the flow.
export function JobImages({ jobId, open, big, className }: Props) {
  const { t } = useTranslation()
  const toast = useToast()
  const { hasRole, session } = useAuth()
  const images = useJobImages(jobId)
  const add = useAddImages(jobId)
  const input = useRef<HTMLInputElement>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const canAdd = open && hasRole('admin', 'manager', 'supervisor', 'staff')
  const isSupervisor = hasRole('admin', 'manager', 'supervisor')
  const list = images.data ?? []

  function onPick(files: FileList | null) {
    const picked = Array.from(files ?? []).filter((f) => f.type.startsWith('image/'))
    if (input.current) input.current.value = ''
    if (picked.length === 0) return
    add.mutate(picked, {
      onSuccess: () => toast({ tone: 'success', message: t('jobImages.added', { n: picked.length }) }),
      onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
    })
  }

  if (!canAdd && list.length === 0) return null
  const thumb = big ? 'size-24' : 'size-16'

  return (
    <div className={className}>
      <div className="flex flex-wrap gap-2">
        {list.map((img, i) => (
          <button key={img.id} type="button" onClick={() => setViewing(i)} aria-label={t('jobImages.open', { n: i + 1 })}
            className={cn('overflow-hidden rounded-lg border border-border bg-surface-2', thumb)}>
            {img.url && <img src={img.url} alt="" loading="lazy" className="size-full object-cover" />}
          </button>
        ))}
        {canAdd && (
          <button type="button" onClick={() => input.current?.click()} disabled={add.isPending}
            className={cn('grid place-items-center rounded-lg border border-dashed border-border text-muted hover:border-brand hover:text-brand disabled:opacity-50', thumb)}>
            <span className="flex flex-col items-center gap-1 text-xs">
              <ImagePlus className={big ? 'size-6' : 'size-5'} aria-hidden />
              {add.isPending ? t('jobImages.uploading') : t('jobImages.add')}
            </span>
          </button>
        )}
      </div>
      {images.error && <p className="mt-1 text-xs text-status-risk">{errorMessage(images.error)}</p>}
      <input ref={input} type="file" accept="image/*" multiple hidden onChange={(e) => onPick(e.target.files)} />
      {viewing != null && list[viewing] && (
        <Lightbox images={list} index={viewing} jobId={jobId} onIndex={setViewing} onClose={() => setViewing(null)}
          canRemove={(img) => open && (isSupervisor || (!!session && img.created_by === session.user.id))} />
      )}
    </div>
  )
}

function Lightbox({ images, index, jobId, onIndex, onClose, canRemove }: {
  images: JobImage[]; index: number; jobId: string; onIndex: (i: number) => void; onClose: () => void; canRemove: (img: JobImage) => boolean
}) {
  const { t } = useTranslation()
  const toast = useToast()
  const remove = useRemoveImage(jobId)
  const img = images[index]
  const prev = index > 0 ? () => onIndex(index - 1) : undefined
  const next = index < images.length - 1 ? () => onIndex(index + 1) : undefined

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()   // close only the photo, not the drawer or sheet behind it
        onClose()
      } else if (e.key === 'ArrowLeft') prev?.()
      else if (e.key === 'ArrowRight') next?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose, prev, next])

  function onRemove() {
    if (!window.confirm(t('jobImages.confirmRemove'))) return
    remove.mutate(img.id, {
      onSuccess: () => {
        toast({ tone: 'success', message: t('jobImages.removed') })
        if (images.length <= 1) onClose()
        else onIndex(Math.min(index, images.length - 2))
      },
      onError: (e) => toast({ tone: 'error', message: errorMessage(e) }),
    })
  }

  const nav = 'absolute top-1/2 -translate-y-1/2 rounded-full bg-black/50 p-3 text-white hover:bg-black/70'
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={t('jobImages.title')} className="fixed inset-0 z-50 flex flex-col bg-black/90" onClick={onClose}>
      <header className="flex items-center gap-3 p-3 text-white" onClick={(e) => e.stopPropagation()}>
        <span className="tabular text-sm">{index + 1} / {images.length}</span>
        <span className="ml-auto" />
        {canRemove(img) && (
          <Button variant="danger" size="sm" loading={remove.isPending} onClick={onRemove}>
            <Trash2 className="size-4" aria-hidden />{t('common.delete')}
          </Button>
        )}
        <button onClick={onClose} className="rounded-full p-2 hover:bg-white/10" aria-label="close"><X className="size-6" /></button>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center p-3">
        {img.url && <img src={img.url} alt="" className="max-h-full max-w-full object-contain" onClick={(e) => e.stopPropagation()} />}
        {prev && <button className={cn(nav, 'left-3')} aria-label="previous" onClick={(e) => { e.stopPropagation(); prev() }}><ChevronLeft className="size-6" /></button>}
        {next && <button className={cn(nav, 'right-3')} aria-label="next" onClick={(e) => { e.stopPropagation(); next() }}><ChevronRight className="size-6" /></button>}
      </div>
    </div>,
    document.body,
  )
}
