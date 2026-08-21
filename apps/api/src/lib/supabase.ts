import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabaseKey = supabaseServiceRoleKey!;
const supabaseProjectUrl = supabaseUrl!;

export const supabaseAdmin: SupabaseClient = createClient(
  supabaseProjectUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  },
);

export function createSupabaseUserClient(accessToken: string): SupabaseClient {
  const client = createClient(supabaseProjectUrl, process.env.SUPABASE_ANON_KEY ?? supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  });

  return client;
}