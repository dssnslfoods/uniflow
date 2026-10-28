import { useMutation, useQuery } from '@tanstack/react-query'
import { db, supabase } from '@/lib/supabase'
import { useAuth } from '@/app/auth'
import { useTenantKey } from '@/shared/data'
import { usePlanCommand } from '../production/api'

const PROOF_BUCKET = 'proof-files'

export type ProofStatus = 'pending' | 'approved' | 'rejected' | 'superseded'

export type Proof = {
  id: string
  job_id: string
  version: number
  file_path: string | null
  file_name: string | null
  note: string | null
  status: ProofStatus
  submitted_at: string
  decided_at: string | null
  customer_name: string | null
  customer_comment: string | null
}

const columns = 'id, job_id, version, file_path, file_name, note, status, submitted_at, decided_at, customer_name, customer_comment'

export function useJobProofs(jobId: string) {
  const key = useTenantKey('proofs', 'job', jobId)
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db().from('proofs').select(columns).eq('job_id', jobId).order('version', { ascending: false })
      if (error) throw error
      return data as Proof[]
    },
  })
}

export type QueueProof = Proof & {
  job: { id: string; job_no: string; title: string; status: string; due_date: string | null; order: { doc_no: string; customer: { name: string } | null } }
}

// Proofs waiting for the customer, plus the latest rejections that still need a new version.
export function useProofQueue() {
  const key = useTenantKey('proofs', 'queue')
  return useQuery({
    queryKey: key,
    queryFn: async () => {
      const { data, error } = await db()
        .from('proofs')
        .select(`${columns}, job:jobs!inner(id, job_no, title, status, due_date, order:sales_orders(doc_no, customer:customers(name)))`)
        .in('status', ['pending', 'rejected'])
        .not('job.status', 'in', '(completed,cancelled)')
        .order('submitted_at', { ascending: false })
      if (error) throw error
      // A rejection is still open only while it is the job's latest version.
      const rows = data as unknown as QueueProof[]
      const latest = new Map<string, number>()
      rows.forEach((r) => latest.set(r.job_id, Math.max(latest.get(r.job_id) ?? 0, r.version)))
      return rows.filter((r) => r.status === 'pending' || latest.get(r.job_id) === r.version)
    },
  })
}

export function useProofUrl(path: string | null) {
  return useQuery({
    queryKey: ['proof-url', path],
    enabled: !!path,
    staleTime: 50 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.storage.from(PROOF_BUCKET).createSignedUrl(path!, 60 * 60)
      if (error) throw error
      return data.signedUrl
    },
  })
}

// Upload the file into the shop's folder, then register the version.
export function useSubmitProof() {
  const { claims } = useAuth()
  const register = usePlanCommand<{ p_job: string; p_file_path: string; p_file_name: string | null; p_note: string | null }, string>('submit_proof')
  return useMutation({
    mutationFn: async ({ jobId, file, note }: { jobId: string; file: File; note: string | null }) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
      // Storage keys must be ASCII; the original name is kept on the row.
      const path = `${claims?.tenant_id}/${jobId}/proof-${Date.now()}.${ext}`
      const { error } = await supabase.storage.from(PROOF_BUCKET).upload(path, file, { contentType: file.type })
      if (error) throw error
      return register.mutateAsync({ p_job: jobId, p_file_path: path, p_file_name: file.name, p_note: note })
    },
  })
}

export const useDecideProof = () =>
  usePlanCommand<{ p_proof: string; p_approved: boolean; p_customer_name: string | null; p_comment: string | null }, null>('decide_proof')

