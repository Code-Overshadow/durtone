import { createClient } from '@supabase/supabase-js';
import { authenticateAgentToken } from './storage';

export type AuthContext = {
  userId: string;
  tenantId?: string;
};

function authConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
}

function localAuthAllowed() {
  return process.env.NODE_ENV !== 'production' && process.env.DURTONE_AUTH_REQUIRED !== 'true';
}

const localTenantId = '00000000-0000-0000-0000-000000000001';

export async function authenticateRequest(request: Request): Promise<{ ok: true; context?: AuthContext } | { ok: false; status: 401 | 503; error: string }> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (token?.startsWith('durtone_agent_')) {
    const agent = await authenticateAgentToken(token);
    if (!agent) return { ok: false, status: 401, error: 'Invalid or revoked agent token' };
    return { ok: true, context: { userId: `agent:${agent.id}`, tenantId: agent.tenantId } };
  }

  if (!authConfigured()) {
    if (localAuthAllowed()) return { ok: true };
    return { ok: false, status: 503, error: 'Supabase authentication is not configured' };
  }

  if (!token) return { ok: false, status: 401, error: 'Bearer token is required' };

  const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) return { ok: false, status: 401, error: 'Invalid or expired access token' };

  const metadata = data.user.app_metadata as { tenant_id?: unknown } | null;
  const tenantId = typeof metadata?.tenant_id === 'string' ? metadata.tenant_id : undefined;
  return { ok: true, context: { userId: data.user.id, tenantId } };
}

export async function requireTenant(request: Request): Promise<{ ok: true; tenantId: string } | { ok: false; status: 401 | 403 | 503; error: string }> {
  const result = await authenticateRequest(request);
  if (!result.ok) return result;
  const tenantId = result.context?.tenantId ?? (localAuthAllowed() ? process.env.DURTONE_TENANT_ID ?? localTenantId : undefined);
  if (!tenantId) return { ok: false, status: 403, error: 'A tenant is required for this operation' };
  return { ok: true, tenantId };
}
