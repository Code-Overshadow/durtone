import { createClient } from '@supabase/supabase-js';
import { listUserMemberships } from './storage';

export type AuthContext = {
  userId: string;
  email?: string;
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

  const fleetToken = process.env.EDGE_FLEET_TOKEN;
  if (token && fleetToken && token === fleetToken) {
    return { ok: true, context: { userId: 'fleet' } };
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

  return { ok: true, context: { userId: data.user.id, email: data.user.email } };
}

/**
 * Resolves which tenant a request acts as. A user can belong to N tenants (`user_tenants`); the
 * `X-Tenant-ID` header is only a *selector* of which membership to use this request - it is never
 * trusted on its own, always cross-checked against `listUserMemberships(userId)` server-side.
 */
export async function requireTenant(request: Request): Promise<{ ok: true; tenantId: string; userId: string } | { ok: false; status: 400 | 401 | 403 | 409 | 503; error: string }> {
  const result = await authenticateRequest(request);
  if (!result.ok) return result;

  const userId = result.context?.userId;
  if (!userId || userId === 'fleet') {
    const tenantId = localAuthAllowed() ? process.env.DURTONE_TENANT_ID ?? localTenantId : undefined;
    if (!tenantId) return { ok: false, status: 403, error: 'A tenant is required for this operation' };
    return { ok: true, tenantId, userId: userId ?? 'local-dev' };
  }

  const memberships = await listUserMemberships(userId);
  if (!memberships || memberships.length === 0) {
    return { ok: false, status: 409, error: 'no_tenant_membership' };
  }

  const headerTenantId = request.headers.get('x-tenant-id');
  if (headerTenantId) {
    const membership = memberships.find((entry) => entry.tenantId === headerTenantId);
    if (!membership) return { ok: false, status: 403, error: 'not a member of the requested tenant' };
    return { ok: true, tenantId: membership.tenantId, userId };
  }

  if (memberships.length === 1) return { ok: true, tenantId: memberships[0]!.tenantId, userId };
  return { ok: false, status: 400, error: 'X-Tenant-ID header is required when a user belongs to multiple tenants' };
}

/** For endpoints only the edge proxy fleet may call (e.g. the routing table) - never tenant-scoped. */
export async function requireFleet(request: Request): Promise<{ ok: true } | { ok: false; status: 401 | 503; error: string }> {
  const result = await authenticateRequest(request);
  if (!result.ok) return result;
  if (result.context?.userId !== 'fleet') return { ok: false, status: 401, error: 'A valid fleet token is required' };
  return { ok: true };
}
