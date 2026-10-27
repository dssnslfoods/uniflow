export type Role = 'admin' | 'executive' | 'manager' | 'supervisor' | 'staff'

export type Claims = { sub: string; tenant_id: string | null; roles: Role[]; platform_admin: boolean }

// Claims added by public.custom_access_token_hook. Decoded only for UI decisions;
// the database enforces everything again through RLS.
export function decodeClaims(accessToken: string | undefined): Claims | null {
  if (!accessToken) return null
  try {
    const payload = accessToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const bytes = Uint8Array.from(atob(payload), (c) => c.charCodeAt(0))
    const json = JSON.parse(new TextDecoder().decode(bytes))
    return { sub: json.sub, tenant_id: json.tenant_id ?? null, roles: json.roles ?? [], platform_admin: json.platform_admin === true }
  } catch {
    return null
  }
}
