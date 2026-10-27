import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { db } from '@/lib/supabase'
import { useList, useTenantKey } from '@/shared/data'

export type Template = { id: string; name: string; description: string | null; is_active: boolean }

export type TemplateStep = {
  id?: string
  seq: number
  process_id: string
  default_machine_id: string | null
  note: string | null
}

export const useTemplates = () =>
  useList<Template>('workflow_templates', 'id, name, description, is_active', { order: ['name'], activeOnly: false })

export function useTemplateSteps(templateId: string | null) {
  const key = useTenantKey('workflow_template_steps', templateId)
  return useQuery({
    queryKey: key,
    enabled: !!templateId,
    queryFn: async () => {
      const { data, error } = await db()
        .from('workflow_template_steps')
        .select('id, seq, process_id, default_machine_id, note')
        .eq('template_id', templateId!)
        .order('seq')
      if (error) throw error
      return data as TemplateStep[]
    },
  })
}

type SaveInput = { id?: string; name: string; description: string | null; steps: TemplateStep[] }

// Steps are replaced wholesale: templates are small and have no history of their own.
export function useSaveTemplate() {
  const templatesKey = useTenantKey('workflow_templates')
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, name, description, steps }: SaveInput) => {
      const { data, error } = await (id
        ? db().from('workflow_templates').update({ name, description }).eq('id', id).select('id').single()
        : db().from('workflow_templates').insert({ name, description }).select('id').single())
      if (error) throw error
      const templateId = (data as { id: string }).id

      const { error: delError } = await db().from('workflow_template_steps').delete().eq('template_id', templateId)
      if (delError) throw delError
      if (steps.length) {
        const { error: insError } = await db()
          .from('workflow_template_steps')
          .insert(steps.map(({ seq, process_id, default_machine_id, note }) => ({ template_id: templateId, seq, process_id, default_machine_id, note })))
        if (insError) throw insError
      }
      return templateId
    },
    onSettled: (templateId) => {
      qc.invalidateQueries({ queryKey: templatesKey })
      qc.invalidateQueries({ queryKey: ['workflow_template_steps'], predicate: (q) => q.queryKey.includes(templateId) })
    },
  })
}

export function useSetTemplateActive() {
  const key = useTenantKey('workflow_templates')
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, is_active }: { id: string; is_active: boolean }) => {
      const { error } = await db().from('workflow_templates').update({ is_active }).eq('id', id)
      if (error) throw error
    },
    onSettled: () => qc.invalidateQueries({ queryKey: key }),
  })
}
