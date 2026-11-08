// Add a person to a print shop: by email invitation, or (with `password`) by creating a
// ready-to-use account with a password the admin hands over — for staff who don't use email.
// Without tenantId: the caller's current shop (caller must be its admin).
// With tenantId: any shop (caller must be a platform admin).
// The caller's own JWT is used for every permission check (api.add_member / api.admin_add_member
// enforce roles and plan limits); the service role is used only to create the auth account
// and send the invitation email.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const roles = new Set(['admin', 'executive', 'manager', 'supervisor', 'staff'])

function reply(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return reply(405, { code: 'method_not_allowed' })

  const authorization = req.headers.get('Authorization') ?? ''
  const url = Deno.env.get('SUPABASE_URL')!
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let body: { email?: string; roles?: string[]; redirectTo?: string; tenantId?: string; password?: string; fullName?: string }
  try {
    body = await req.json()
  } catch {
    return reply(400, { code: 'invalid_body' })
  }
  const email = (body.email ?? '').trim().toLowerCase()
  const wanted = (body.roles ?? []).filter((r) => roles.has(r))
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return reply(400, { code: 'member.invalid_email' })
  if (wanted.length === 0) return reply(400, { code: 'member.roles_required' })
  const password = body.password ?? ''
  const withPassword = password.length > 0
  if (withPassword && password.length < 6) return reply(400, { code: 'auth.weak_password' })
  const fullName = (body.fullName ?? '').trim()

  // Check permission before any email goes out.
  if (body.tenantId) {
    const { error: consoleError } = await asCaller.schema('api').rpc('admin_list_members', { p_tenant: body.tenantId })
    if (consoleError) return reply(403, { code: consoleError.details ?? 'auth.forbidden', message: consoleError.message })
  } else {
    const { data: tenants, error: tenantsError } = await asCaller.schema('api').rpc('my_tenants')
    if (tenantsError) return reply(401, { code: 'auth.required' })
    const current = (tenants as { roles: string[]; is_current: boolean }[]).find((t) => t.is_current)
    if (!current?.roles.includes('admin')) return reply(403, { code: 'auth.forbidden' })
  }

  // A full plan must fail here: once the invitation is sent it cannot be taken back.
  const { error: seatError } = await asCaller.schema('api').rpc('assert_can_invite', { p_email: email, p_tenant: body.tenantId ?? null })
  if (seatError) return reply(400, { code: seatError.details ?? 'member.add_failed', message: seatError.message })

  // New address: create the account (with the given password, or by sending an invitation).
  // Existing account: just add it — its own password is never changed here.
  const { error: createError } = withPassword
    ? await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: fullName ? { full_name: fullName } : undefined,
      })
    : await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: body.redirectTo,
        data: fullName ? { full_name: fullName } : undefined,
      })
  const alreadyExists = !!createError && /already|registered|exists/i.test(createError.message)
  if (createError && !alreadyExists) {
    const code = (createError as { code?: string }).code
    if (code === 'weak_password') return reply(400, { code: 'auth.weak_password', message: createError.message })
    return reply(400, { code: withPassword ? 'member.create_failed' : 'member.invite_failed', message: createError.message })
  }

  const { data: membershipId, error: addError } = body.tenantId
    ? await asCaller.schema('api').rpc('admin_add_member', { p_tenant: body.tenantId, p_email: email, p_roles: wanted })
    : await asCaller.schema('api').rpc('add_member', { p_email: email, p_roles: wanted })
  if (addError) return reply(400, { code: addError.details ?? 'member.add_failed', message: addError.message })

  return reply(200, {
    membership_id: membershipId,
    invited: !withPassword && !alreadyExists,
    created: withPassword && !alreadyExists,
    existing: alreadyExists,
  })
})
