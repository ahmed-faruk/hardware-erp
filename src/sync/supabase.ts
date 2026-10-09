import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/** Only what sync needs from the Supabase client; tests can pass a real client or a stub. */
export type RpcClient = Pick<SupabaseClient, 'rpc'>;

export function createSupabase(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, { auth: { persistSession: true, autoRefreshToken: true } });
}

/** App-wide client from the public env values (never a service_role key). */
export function createAppSupabase(): SupabaseClient {
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error('Supabase env values are missing');
  return createSupabase(url, key);
}
