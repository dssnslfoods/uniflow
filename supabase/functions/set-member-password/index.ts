// A shop admin sets a new password for one of their members (for staff without email, or who are
// locked out). The caller's own JWT runs api.assert_can_set_password, which checks the caller is
// an admin of the member's shop and that the account belongs to no other shop; only then is the
// service role used to change the password.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { code: 'method_not_allowed' })

  const url = Deno.env.get('SUPABASE_URL')!
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
    auth: { persistSession: false },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: { membershipId?: string; password?: string }
  try {
    body = await req.json()
  } catch {
    return reply(400, { code: 'invalid_body' })
  }
  const password = body.password ?? ''
  if (!body.membershipId) return reply(400, { code: 'member.not_found' })
  if (password.length < 6) return reply(400, { code: 'auth.weak_password' })

  const { data: userId, error: checkError } = await asCaller.schema('api').rpc('assert_can_set_password', { p_membership: body.membershipId })
  if (checkError || !userId) return reply(403, { code: checkError?.details ?? 'auth.forbidden', message: checkError?.message })

  const { error } = await admin.auth.admin.updateUserById(userId as string, { password })
  if (error) {
    const code = (error as { code?: string }).code
    return reply(400, { code: code === 'weak_password' ? 'auth.weak_password' : 'member.password_failed', message: error.message })
  }
  return reply(200, { ok: true })
})
