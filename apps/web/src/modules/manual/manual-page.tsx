import { Fragment, useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from '@tanstack/react-router'
import { ArrowRight, BookOpen, Check, Info, Minus, Printer, Search, TriangleAlert } from 'lucide-react'
import { useAuth } from '@/app/auth'
import type { Role } from '@/lib/claims'
import { cn } from '@/lib/utils'
import { Button } from '@/shared/ui/button'
import { Input } from '@/shared/ui/input'
import { EmptyState, PageHeader } from '@/shared/ui/page'
import { useModules } from '../settings/api'
import { contentEn } from './content.en'
import { contentTh } from './content.th'
import { flowStages, sections, type Block, type SectionMeta, type SectionText } from './sections'

const roles: Role[] = ['admin', 'executive', 'manager', 'supervisor', 'staff']
const groups = ['start', 'daily', 'data', 'reference', 'platform'] as const
const token = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*)/

// Inline labels come from the i18n tables, so the manual always names buttons as the app does.
function Rich({ text }: { text: string }) {
  const { t } = useTranslation()
  return text.split(token).map((part, i) => {
    if (part.startsWith('[[')) {
      return <span key={i} className="rounded border border-border bg-surface-2 px-1.5 py-px text-[0.92em] font-medium">{t(part.slice(2, -2))}</span>
    }
    if (part.startsWith('**')) return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>
    return <Fragment key={i}>{part}</Fragment>
  })
}

function blockText(b: Block): string[] {
  if ('p' in b) return [b.p]
  if ('h' in b) return [b.h]
  if ('tip' in b) return [b.tip]
  if ('warn' in b) return [b.warn]
  if ('steps' in b) return b.steps
  if ('bullets' in b) return b.bullets
  if ('defs' in b) return b.defs.flatMap((d) => [d.term, d.desc])
  if ('matrix' in b) return b.matrix.map((r) => r.label)
  return []
}

function Callout({ tone, children }: { tone: 'tip' | 'warn'; children: ReactNode }) {
  const Icon = tone === 'tip' ? Info : TriangleAlert
  return (
    <p className={cn('flex gap-2.5 rounded-lg px-3.5 py-2.5', tone === 'tip' ? 'bg-brand/10' : 'bg-status-paused/10')}>
      <Icon className={cn('mt-1 size-4 shrink-0', tone === 'tip' ? 'text-brand' : 'text-status-paused')} aria-hidden />
      <span>{children}</span>
    </p>
  )
}

function Flow() {
  const { t } = useTranslation()
  return (
    <ol className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {flowStages.map((s, i) => (
        <li key={s.id} className="break-inside-avoid">
          <a href={`#${s.id}`} className="flex h-full gap-3 rounded-lg border border-border px-3 py-2.5 hover:border-brand/60 hover:bg-surface-2/60">
            <span className="tabular grid size-7 shrink-0 place-items-center rounded-full bg-brand text-sm font-semibold text-brand-fg">{i + 1}</span>
            <span className="min-w-0">
              <span className="block font-medium">{t(`manual.flow.${s.key}`)}</span>
              <span className="block text-xs text-muted">{s.roles.map((r) => t(`role.${r}`)).join(', ')}</span>
            </span>
          </a>
        </li>
      ))}
    </ol>
  )
}

function Matrix({ rows }: { rows: { label: string; roles: Role[] }[] }) {
  const { t } = useTranslation()
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead className="bg-surface-2 text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">{t('manual.action')}</th>
            {roles.map((r) => <th key={r} className="px-2 py-2 text-center font-medium">{t(`role.${r}`)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-t border-border">
              <td className="px-3 py-2">{row.label}</td>
              {roles.map((r) => (
                <td key={r} className="px-2 py-2 text-center">
                  {row.roles.includes(r)
                    ? <Check className="mx-auto size-4 text-status-done" aria-label={t('manual.allowed')} />
                    : <Minus className="mx-auto size-3.5 text-border" aria-label={t('manual.notAllowed')} />}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BlockView({ block }: { block: Block }) {
  if ('p' in block) return <p><Rich text={block.p} /></p>
  if ('h' in block) return <h3 className="pt-2 font-semibold"><Rich text={block.h} /></h3>
  if ('tip' in block) return <Callout tone="tip"><Rich text={block.tip} /></Callout>
  if ('warn' in block) return <Callout tone="warn"><Rich text={block.warn} /></Callout>
  if ('flow' in block) return <Flow />
  if ('matrix' in block) return <Matrix rows={block.matrix} />
  if ('steps' in block) {
    return (
      <ol className="flex flex-col gap-2">
        {block.steps.map((s, i) => (
          <li key={i} className="flex gap-3">
            <span className="tabular mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-surface-2 text-xs font-semibold">{i + 1}</span>
            <span className="min-w-0"><Rich text={s} /></span>
          </li>
        ))}
      </ol>
    )
  }
  if ('bullets' in block) {
    return (
      <ul className="flex list-disc flex-col gap-1.5 pl-5 marker:text-muted">
        {block.bullets.map((s, i) => <li key={i}><Rich text={s} /></li>)}
      </ul>
    )
  }
  return (
    <dl className="divide-y divide-border rounded-lg border border-border">
      {block.defs.map((d) => (
        <div key={d.term} className="grid gap-x-4 gap-y-0.5 px-3 py-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <dt className="font-medium"><Rich text={d.term} /></dt>
          <dd className="text-muted"><Rich text={d.desc} /></dd>
        </div>
      ))}
    </dl>
  )
}

function Section({ meta, text }: { meta: SectionMeta; text: SectionText }) {
  const { t } = useTranslation()
  return (
    <section id={meta.id} className="scroll-mt-6 rounded-[var(--radius-card)] border border-border bg-surface p-5 print:border-0 print:p-0">
      <header className="mb-3">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
          <h2 className="text-lg font-semibold">{text.title}</h2>
          {meta.to && (
            <Link to={meta.to} className="inline-flex items-center gap-1 text-sm text-brand hover:underline print:hidden">
              {t('manual.openPage')}<ArrowRight className="size-3.5" aria-hidden />
            </Link>
          )}
        </div>
        <p className="mt-0.5 text-muted"><Rich text={text.summary} /></p>
        <p className="mt-1 text-xs text-muted">
          {t('manual.who')}: {meta.roles === 'all' ? t('manual.everyone') : meta.roles.map((r) => t(`role.${r}`)).join(', ')}
        </p>
      </header>
      <div className="flex flex-col gap-3 leading-7">
        {text.blocks.map((b, i) => <BlockView key={i} block={b} />)}
      </div>
    </section>
  )
}

export function ManualPage() {
  const { t, i18n } = useTranslation()
  const { claims } = useAuth()
  const modules = useModules()
  const content = i18n.language === 'en' ? contentEn : contentTh
  const [role, setRole] = useState<Role | null>(null)
  const [query, setQuery] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)

  const plain = (text: string) => text.replace(/\[\[([^\]]+)\]\]/g, (_, k: string) => t(k)).replace(/\*\*/g, '')
  const q = query.trim().toLowerCase()
  const visible = (sections as readonly SectionMeta[]).filter((s) => {
    if (s.module && modules.ready && !modules.has(s.module)) return false
    if (s.platformOnly && !claims?.platform_admin) return false
    if (role && s.roles !== 'all' && !s.roles.includes(role)) return false
    if (!q) return true
    const c = content[s.id as keyof typeof content]
    return plain([c.title, c.summary, ...c.blocks.flatMap(blockText)].join(' ')).toLowerCase().includes(q)
  })
  const ids = visible.map((s) => s.id).join()

  // A shared link such as /manual#floor opens at that section once the lazy page has rendered.
  useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1))
    if (id) document.getElementById(id)?.scrollIntoView()
  }, [])

  // The contents list marks the last section whose heading has reached the top of the screen.
  useEffect(() => {
    const onScroll = () => {
      const passed = ids.split(',').filter((id) => (document.getElementById(id)?.getBoundingClientRect().top ?? Infinity) <= 96)
      setActiveId(passed.at(-1) ?? null)
    }
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [ids])

  const toc = groups.map((g) => ({ g, items: visible.filter((s) => s.group === g) })).filter((x) => x.items.length > 0)

  const chip = (on: boolean) =>
    cn('whitespace-nowrap rounded-full border px-3 py-1 text-sm', on ? 'border-brand bg-brand/10 font-medium text-brand' : 'border-border text-muted hover:bg-surface-2')

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader
        title={t('manual.title')}
        subtitle={t('manual.subtitle')}
        actions={
          <>
            <div className="relative print:hidden">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t('manual.search')} className="w-56 pl-9" aria-label={t('manual.search')} />
            </div>
            <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
              <Printer className="size-4" aria-hidden />{t('manual.print')}
            </Button>
          </>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-2 print:hidden" role="group" aria-label={t('manual.forRole')}>
        <span className="text-sm text-muted">{t('manual.forRole')}</span>
        <button className={chip(role === null)} aria-pressed={role === null} onClick={() => setRole(null)}>{t('manual.allRoles')}</button>
        {roles.map((r) => (
          <button key={r} className={chip(role === r)} aria-pressed={role === r} onClick={() => setRole(r)}>
            {t(`role.${r}`)}{claims?.roles.includes(r) && <span className="ml-1 text-xs opacity-70">({t('settings.you')})</span>}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <EmptyState Icon={BookOpen} title={t('manual.noResults')} hint={t('manual.noResultsHint')} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)]">
          <nav aria-label={t('manual.contents')} className="print:hidden lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:self-start lg:overflow-y-auto">
            <details className="rounded-[var(--radius-card)] border border-border bg-surface px-3 py-2 lg:hidden">
              <summary className="cursor-pointer font-medium">{t('manual.contents')}</summary>
              <Toc toc={toc} content={content} activeId={activeId} className="mt-2" />
            </details>
            <Toc toc={toc} content={content} activeId={activeId} className="hidden lg:flex" />
          </nav>
          <div className="flex min-w-0 flex-col gap-4">
            {visible.map((s) => <Section key={s.id} meta={s} text={content[s.id as keyof typeof content]} />)}
          </div>
        </div>
      )}
    </div>
  )
}

type TocProps = {
  toc: { g: (typeof groups)[number]; items: SectionMeta[] }[]
  content: Record<string, SectionText>
  activeId: string | null
  className?: string
}

function Toc({ toc, content, activeId, className }: TocProps) {
  const { t } = useTranslation()
  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {toc.map(({ g, items }) => (
        <div key={g}>
          <p className="px-2.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted">{t(`manual.groups.${g}`)}</p>
          <ul>
            {items.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`} aria-current={activeId === s.id ? 'location' : undefined}
                  className={cn('block rounded-lg px-2.5 py-1 text-sm hover:bg-surface-2', activeId === s.id ? 'bg-surface-2 font-medium' : 'text-muted')}>
                  {content[s.id].title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
