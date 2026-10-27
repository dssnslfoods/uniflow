import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || !anonKey) {
  throw new Error('Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (see apps/web/.env.example)')
}

export const supabase = createClient(url, anonKey)

// Tables live in schema "app", commands in schema "api" (design §7).
export const db = () => supabase.schema('app')
export const rpc = () => supabase.schema('api')
