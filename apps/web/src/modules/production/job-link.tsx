import { useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { JobModal } from './job-page'

type Props = { jobId: string; title: string; className?: string; children: ReactNode }

// Clickable job reference that opens the job card as a popup instead of leaving the current page.
export function JobLink({ jobId, title, className, children }: Props) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={cn('text-left', className)}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); setOpen(true) }}>
        {children}
      </button>
      {open && <JobModal jobId={jobId} title={title} onClose={() => setOpen(false)} />}
    </>
  )
}
