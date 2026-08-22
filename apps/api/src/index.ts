import { Elysia } from 'elysia';
import { createHash, randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from '@durtone/crypto';
import { buildIdentityProviderConfig, revokeIdentity } from '@durtone/identity-providers';
import { getDiscoveryStats, ingestLogs, listEndpoints, listRequestLogs, replaceOpenApi } from './discovery';
import { getWafConfig, mergePersistedConfig, updateWafConfig } from './config';
import { listHoneytokenCallbacks, recordHoneytokenCallback } from './honeytokens';
import { getCspmSummary } from './cspm';
import { checkCertificate, deleteCertificate, FlyRateLimitError, requestCertificate, type FlyCertificateStatus } from './flyCerts';
import { deleteCloudAccount, deleteDomain, deleteIdentityProvider, deleteInvitation, deleteTenantMembership, ensureUserProfile, findInvitationByToken, generateUniqueTenantSlug, getDomain, getIdentityForRevoke, getPersistedConfig, getPersistedCspmSummary, getPersistedDiscoveryStats, getPersistedIdentityHygiene, getTenant, insertCloudAccount, insertDomain, insertIdentityProvider, insertInvitation, insertMembership, insertTenant, listActiveRoutes, listCloudAccounts, listCorrelations, listDomains, listIdentityProviders, listInvitations, listPendingDomains, listPersistedEndpoints, listPersistedIdentities, listPersistedLogs, listTenantMembers, listUserMemberships, markInvitationAccepted, persistConfig, persistEndpoints, persistLogs, persistScan, recordAuditLog, recordObservedEndpoint, updateCloudAccount, updateDomainStatus, updateIdentityProvider, updateIdentityStatus, updateTenantMembershipRole, updateTenantName, updateTenantSettings, type PersistedScan } from './storage';
import { correlateGuardianChange, correlateWafAttack, type CspmChange, type WafAttack } from './correlation';
import { onEvent, publishEvent } from './eventBus';
import { buildExecutiveReport } from './report';
import { calculateSecurityScore } from './securityScore';
import { getIdentityHygiene, listSecurityIdentities, replaceSecurityIdentities } from './securityState';
import { authenticateRequest, requireFleet, requireTenant } from './auth';
import { allowRequest } from './rateLimit';

const port = Number(process.env.PORT ?? 3000);
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const USER_ROLES = ['owner', 'admin', 'member'] as const;
const CLOUD_PROVIDERS = ['aws', 'azure', 'gcp'] as const;
const IDENTITY_PROVIDER_KINDS = ['keycloak', 'okta', 'aws', 'google'] as const;
const REFRESH_INTERVAL_KEYS = ['stats', 'logs', 'endpoints', 'domains', 'cspm', 'itdr', 'security'] as const;

onEvent('waf.attack', async (event) => {
  if (!event.tenantId) return;
  const identities = (await listPersistedIdentities(event.tenantId)) ?? listSecurityIdentities(event.tenantId);
  const result = correlateWafAttack(event.payload as WafAttack, identities);
  await recordAuditLog({
    tenantId: event.tenantId,
    actorType: 'system',
    actorId: 'correlation-engine',
    action: 'correlation.detected',
    targetType: 'waf-attack',
    metadata: { source: 'durtwall', eventId: event.id, result },
  });
});
onEvent('cspm.drift', async (event) => {
  if (!event.tenantId) return;
  const identities = (await listPersistedIdentities(event.tenantId)) ?? listSecurityIdentities(event.tenantId);
  const result = correlateGuardianChange(event.payload as CspmChange, identities);
  await recordAuditLog({
    tenantId: event.tenantId,
    actorType: 'system',
    actorId: 'correlation-engine',
    action: 'correlation.detected',
    targetType: 'cspm-drift',
    metadata: { source: 'durtguardian', eventId: event.id, result },
  });
});

async function applyCertificateStatus(domainId: string, cert: FlyCertificateStatus) {
  const status = cert.ready ? 'active' : cert.awaitingDns ? 'pending_dns' : 'pending_certificate';
  await updateDomainStatus(domainId, status, JSON.stringify(cert.raw));
}

let pollingDomains = false;
async function pollPendingDomains() {
  if (pollingDomains) return;
  pollingDomains = true;
  try {
    const pending = await listPendingDomains();
    for (const domain of pending ?? []) {
      try {
        const cert = await checkCertificate(domain.hostname);
        await applyCertificateStatus(domain.id, cert);
      } catch (error) {
        if (error instanceof FlyRateLimitError) break;
        await updateDomainStatus(domain.id, domain.status, undefined, error instanceof Error ? error.message : 'certificate check failed');
      }
    }
  } finally {
    pollingDomains = false;
  }
}
setInterval(() => void pollPendingDomains(), 60_000);

const app = new Elysia()
  .onRequest(({ request, set }) => {
    set.headers['Access-Control-Allow-Origin'] = process.env.DASHBOARD_ORIGIN ?? 'http://localhost:3001';
    set.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization';
    set.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    if (request.method === 'OPTIONS') {
      set.status = 204;
      return '';
    }
  })
  .onBeforeHandle(async ({ request, path }) => {
    if (!path.startsWith('/api/v1/')) return;
    // Public: lets someone check an invitation (tenant name/role/expiry) before they even have an account.
    if (request.method === 'GET' && /^\/api\/v1\/invitations\/[^/]+$/.test(path)) return;
    const result = await authenticateRequest(request);
    if (result.ok) return;
    return new Response(JSON.stringify({ error: result.error }), {
      status: result.status,
      headers: { 'Content-Type': 'application/json' },
    });
  })
  .onBeforeHandle(async ({ request, path, set }) => {
    if (!path.startsWith('/api/v1/')) return;
    try {
      const identity = request.headers.get('authorization') ?? request.headers.get('x-forwarded-for') ?? 'anonymous';
      const key = Bun.hash(`${identity}:${path}`).toString();
      if (await allowRequest(key)) return;
      set.status = 429;
      return { error: 'rate limit exceeded' };
    } catch {
      set.status = 503;
      return { error: 'rate limiting unavailable' };
    }
  })
  .get('/health', () => ({ status: 'ok', service: 'durtone-api' }))
  .get('/', () => ({ name: 'DurtOne Control Plane', status: 'running' }))
  .post('/api/v1/ingest/logs', async ({ body, request, set }) => {
    try {
      const fleet = await requireFleet(request);
      if (fleet.ok) {
        // The edge fleet serves many tenants in one process - each entry carries its own tenantId
        // instead of it being derived from a single-tenant bearer token.
        const entries = Array.isArray(body) ? body : (body as { logs?: unknown[] }).logs ?? [];
        const fleetEntries = entries as Array<{ tenantId?: string; method: string; path: string; status: number; blocked?: boolean; reason?: string; remoteIp?: string; remote_ip?: string }>;
        let accepted = 0;
        for (const entry of fleetEntries) {
          if (typeof entry.tenantId !== 'string' || !entry.tenantId) continue;
          const remoteIp = entry.remoteIp ?? entry.remote_ip;
          const blocked = entry.blocked ?? entry.status === 403;
          const reason = entry.reason ?? (entry.status === 403 ? 'waf' : '');
          await persistLogs(entry.tenantId, [{ method: entry.method, path: entry.path, status: entry.status, blocked, reason, remoteIp }]);
          await recordObservedEndpoint(entry.tenantId, entry.method.toUpperCase(), entry.path, entry.status);
          if (blocked && remoteIp) void publishEvent({ type: 'waf.attack', tenantId: entry.tenantId, payload: { remoteIp, blocked: true, path: entry.path, reason } });
          accepted += 1;
        }
        return { accepted };
      }

      const tenant = await requireTenant(request);
      if (!tenant.ok) {
        set.status = tenant.status;
        return { error: tenant.error };
      }
      const count = ingestLogs(body);
      const entries = Array.isArray(body) ? body : (body as { logs?: unknown[] }).logs ?? [];
      const persistedEntries = (entries as Array<{ method: string; path: string; status: number; blocked?: boolean; reason?: string; remoteIp?: string; remote_ip?: string }>).map((entry) => ({
        method: entry.method,
        path: entry.path,
        status: entry.status,
        blocked: entry.blocked ?? entry.status === 403,
        reason: entry.reason ?? (entry.status === 403 ? 'waf' : ''),
        remoteIp: entry.remoteIp ?? entry.remote_ip,
      }));
      await persistLogs(tenant.tenantId, persistedEntries);
      await persistEndpoints(tenant.tenantId, listEndpoints());
      for (const entry of entries as Array<{ remoteIp?: string; remote_ip?: string; blocked?: boolean; path?: string; reason?: string }>) {
        const remoteIp = entry.remoteIp ?? entry.remote_ip;
        if (entry.blocked && remoteIp) void publishEvent({ type: 'waf.attack', tenantId: tenant.tenantId, payload: { remoteIp, blocked: true, path: entry.path, reason: entry.reason } });
      }
      return { accepted: count };
    } catch {
      set.status = 400;
      return { error: 'invalid log payload' };
    }
  })
  .get('/api/v1/edge/routing-table', async ({ request, set }) => {
    const fleet = await requireFleet(request);
    if (!fleet.ok) {
      set.status = fleet.status;
      return { error: fleet.error };
    }
    return { routes: await listActiveRoutes() };
  })
  .post('/api/v1/openapi', ({ body, set }) => {
    try {
      const routes = replaceOpenApi(body);
      return { routes };
    } catch {
      set.status = 400;
      return { error: 'invalid OpenAPI document' };
    }
  })
  .get('/api/v1/endpoints', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return { endpoints: (await listPersistedEndpoints(tenant.tenantId)) ?? listEndpoints() };
  })
  .get('/api/v1/logs', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return { logs: (await listPersistedLogs(tenant.tenantId)) ?? listRequestLogs() };
  })
  .get('/api/v1/stats', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return (await getPersistedDiscoveryStats(tenant.tenantId)) ?? getDiscoveryStats();
  })
  .get('/api/v1/cspm/summary', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return (await getPersistedCspmSummary(tenant.tenantId)) ?? getCspmSummary();
  })
  .post('/api/v1/domains', async ({ body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const hostname = typeof (body as { hostname?: unknown })?.hostname === 'string' ? (body as { hostname: string }).hostname.trim().toLowerCase() : '';
    if (!HOSTNAME_PATTERN.test(hostname)) {
      set.status = 400;
      return { error: 'invalid hostname' };
    }
    let domain;
    try {
      domain = await insertDomain(tenant.tenantId, hostname);
    } catch {
      set.status = 409;
      return { error: 'hostname already registered' };
    }
    if (!domain) {
      set.status = 503;
      return { error: 'domain storage is unavailable' };
    }
    try {
      const cert = await requestCertificate(hostname);
      await applyCertificateStatus(domain.id, cert);
    } catch (error) {
      await updateDomainStatus(domain.id, 'pending_dns', undefined, error instanceof Error ? error.message : 'certificate request failed');
    }
    return (await getDomain(tenant.tenantId, domain.id)) ?? domain;
  })
  .get('/api/v1/domains', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return { domains: (await listDomains(tenant.tenantId)) ?? [] };
  })
  .delete('/api/v1/domains/:id', async ({ params, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const domain = await getDomain(tenant.tenantId, params.id);
    if (!domain) {
      set.status = 404;
      return { error: 'domain not found' };
    }
    try {
      await deleteCertificate(domain.hostname);
    } catch {
      // best-effort: still remove the domain locally even if Fly cleanup fails
    }
    const deleted = await deleteDomain(tenant.tenantId, params.id);
    return { deleted };
  })
  .post('/api/v1/domains/:id/recheck', async ({ params, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const domain = await getDomain(tenant.tenantId, params.id);
    if (!domain) {
      set.status = 404;
      return { error: 'domain not found' };
    }
    try {
      const cert = await checkCertificate(domain.hostname);
      await applyCertificateStatus(domain.id, cert);
    } catch (error) {
      set.status = 502;
      return { error: error instanceof Error ? error.message : 'certificate check failed' };
    }
    return (await getDomain(tenant.tenantId, domain.id)) ?? domain;
  })
  .post('/api/v1/cspm/scans', async ({ body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const scan = body as PersistedScan;
    if (!scan.provider || !Array.isArray(scan.findings)) {
      set.status = 400;
      return { error: 'invalid CSPM scan' };
    }
    await persistScan(tenant.tenantId, scan);
    for (const drift of scan.drifts ?? []) void publishEvent({ type: 'cspm.drift', tenantId: tenant.tenantId, payload: drift });
    return { accepted: true };
  })
  .post('/api/v1/itdr/identities', async ({ body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    try {
      const identities = replaceSecurityIdentities(tenant.tenantId, body);
      void publishEvent({ type: 'itdr.snapshot', tenantId: tenant.tenantId, payload: { totalIdentities: identities.length } });
      return { accepted: identities.length };
    } catch {
      set.status = 400;
      return { error: 'invalid identity snapshot' };
    }
  })
  .get('/api/v1/itdr/identities', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const persisted = await listPersistedIdentities(tenant.tenantId);
    return { identities: persisted ?? listSecurityIdentities(tenant.tenantId) };
  })
  .post('/api/v1/identities/:id/revoke', async ({ params, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const identity = await getIdentityForRevoke(tenant.tenantId, params.id);
    if (!identity) {
      set.status = 404;
      return { error: 'identity not found' };
    }
    try {
      const decrypted = decryptSecret(identity.credentialRef);
      const config = buildIdentityProviderConfig(identity, decrypted);
      const result = await revokeIdentity(config, { id: identity.externalId, name: identity.name });
      await updateIdentityStatus(identity.id, 'suspended');
      await recordAuditLog({
        tenantId: tenant.tenantId,
        actorType: 'user',
        actorId: tenant.userId,
        action: 'identity.revoke',
        targetType: 'identity',
        targetId: identity.id,
        metadata: { provider: result.provider, actionTaken: result.action, identityName: identity.name },
      });
      return { revoked: true, provider: result.provider, action: result.action };
    } catch (error) {
      set.status = 502;
      return { error: error instanceof Error ? error.message : 'revoke failed' };
    }
  })
  .get('/api/v1/security/score', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return calculateSecurityScore({
      waf: (await getPersistedDiscoveryStats(tenant.tenantId)) ?? getDiscoveryStats(),
      cspm: (await getPersistedCspmSummary(tenant.tenantId)) ?? getCspmSummary(),
      itdr: (await getPersistedIdentityHygiene(tenant.tenantId)) ?? getIdentityHygiene(tenant.tenantId),
    });
  })
  .get('/api/v1/security/correlations', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return { correlations: (await listCorrelations(tenant.tenantId)) ?? [] };
  })
  .get('/api/v1/security/report.pdf', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const pdf = await buildExecutiveReport(calculateSecurityScore({
      waf: (await getPersistedDiscoveryStats(tenant.tenantId)) ?? getDiscoveryStats(),
      cspm: (await getPersistedCspmSummary(tenant.tenantId)) ?? getCspmSummary(),
      itdr: (await getPersistedIdentityHygiene(tenant.tenantId)) ?? getIdentityHygiene(tenant.tenantId),
    }));
    set.headers['Content-Type'] = 'application/pdf';
    set.headers['Content-Disposition'] = 'attachment; filename="durtone-security-report.pdf"';
    return new Response(pdf);
  })
  .get('/api/v1/config', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const persisted = await getPersistedConfig(tenant.tenantId);
    if (!persisted) return getWafConfig();
    return mergePersistedConfig({
      upstream: persisted.upstream,
      mode: persisted.mode as 'block' | 'monitor',
      alertWebhookUrl: persisted.alertWebhookUrl ?? '',
      ...(persisted.settings ?? {}),
    });
  })
  .put('/api/v1/config', async ({ body, request, set }) => {
    try {
      const tenant = await requireTenant(request);
      if (!tenant.ok) {
        set.status = tenant.status;
        return { error: tenant.error };
      }
      const response = updateWafConfig(body);
      await persistConfig(tenant.tenantId, {
        upstream: response.upstream,
        mode: response.mode,
        alertWebhookUrl: response.alertWebhookUrl,
      });
      return response;
    } catch {
      set.status = 400;
      return { error: 'invalid WAF configuration' };
    }
  })
  .get('/api/v1/tenants', async ({ request, set }) => {
    const result = await authenticateRequest(request);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error };
    }
    const userId = result.context?.userId;
    if (!userId || userId === 'fleet') {
      const fallbackId = process.env.DURTONE_TENANT_ID ?? '00000000-0000-0000-0000-000000000001';
      const fallbackTenant = await getTenant(fallbackId);
      return { memberships: fallbackTenant ? [{ tenantId: fallbackTenant.id, name: fallbackTenant.name, slug: fallbackTenant.slug, role: 'owner' }] : [] };
    }
    return { memberships: (await listUserMemberships(userId)) ?? [] };
  })
  .post('/api/v1/tenants', async ({ body, request, set }) => {
    const result = await authenticateRequest(request);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error };
    }
    const userId = result.context?.userId;
    const email = result.context?.email;
    if (!userId || userId === 'fleet' || !email) {
      set.status = 503;
      return { error: 'tenant creation requires Supabase authentication' };
    }
    const name = typeof (body as { name?: unknown })?.name === 'string' ? (body as { name: string }).name.trim() : '';
    if (!name || name.length > 160) {
      set.status = 400;
      return { error: 'tenant name is required' };
    }
    const slug = await generateUniqueTenantSlug(name);
    const tenant = await insertTenant(name, slug);
    if (!tenant) {
      set.status = 503;
      return { error: 'tenant storage is unavailable' };
    }
    await ensureUserProfile(userId, email);
    await insertMembership(userId, tenant.id, 'owner');
    await recordAuditLog({ tenantId: tenant.id, actorType: 'user', actorId: userId, action: 'tenant.created' });
    return tenant;
  })
  .get('/api/v1/invitations/:token', async ({ params, set }) => {
    const tokenHash = createHash('sha256').update(params.token).digest('hex');
    const invitation = await findInvitationByToken(tokenHash);
    if (!invitation) {
      set.status = 404;
      return { error: 'invitation not found' };
    }
    return {
      tenantName: invitation.tenantName,
      email: invitation.email,
      role: invitation.role,
      expired: new Date(invitation.expiresAt).getTime() < Date.now(),
      accepted: Boolean(invitation.acceptedAt),
    };
  })
  .post('/api/v1/invitations/:token/accept', async ({ params, request, set }) => {
    const result = await authenticateRequest(request);
    if (!result.ok) {
      set.status = result.status;
      return { error: result.error };
    }
    const userId = result.context?.userId;
    const email = result.context?.email;
    if (!userId || userId === 'fleet' || !email) {
      set.status = 503;
      return { error: 'accepting an invitation requires Supabase authentication' };
    }
    const tokenHash = createHash('sha256').update(params.token).digest('hex');
    const invitation = await findInvitationByToken(tokenHash);
    if (!invitation) {
      set.status = 404;
      return { error: 'invitation not found' };
    }
    if (invitation.acceptedAt) {
      set.status = 410;
      return { error: 'invitation already accepted' };
    }
    if (new Date(invitation.expiresAt).getTime() < Date.now()) {
      set.status = 410;
      return { error: 'invitation expired' };
    }
    if (email.toLowerCase() !== invitation.email.toLowerCase()) {
      set.status = 403;
      return { error: 'this invitation was sent to a different e-mail address' };
    }
    await ensureUserProfile(userId, email);
    await insertMembership(userId, invitation.tenantId, invitation.role);
    await markInvitationAccepted(invitation.id);
    await recordAuditLog({ tenantId: invitation.tenantId, actorType: 'user', actorId: userId, action: 'invitation.accepted', targetType: 'invitation', targetId: invitation.id });
    return { tenantId: invitation.tenantId, role: invitation.role };
  })
  .get('/api/v1/tenant', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const record = await getTenant(tenant.tenantId);
    if (!record) {
      set.status = 404;
      return { error: 'tenant not found' };
    }
    return record;
  })
  .put('/api/v1/tenant', async ({ body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const name = typeof (body as { name?: unknown })?.name === 'string' ? (body as { name: string }).name.trim() : '';
    if (!name || name.length > 160) {
      set.status = 400;
      return { error: 'tenant name is required' };
    }
    let record = await updateTenantName(tenant.tenantId, name);
    if (!record) {
      set.status = 503;
      return { error: 'tenant storage is unavailable' };
    }
    const refreshIntervalsInput = (body as { refreshIntervals?: unknown }).refreshIntervals;
    if (refreshIntervalsInput && typeof refreshIntervalsInput === 'object') {
      const sanitized: Record<string, number> = {};
      for (const key of REFRESH_INTERVAL_KEYS) {
        const value = (refreshIntervalsInput as Record<string, unknown>)[key];
        if (typeof value === 'number' && Number.isFinite(value)) {
          sanitized[key] = Math.min(300_000, Math.max(5_000, Math.round(value)));
        }
      }
      const updated = await updateTenantSettings(tenant.tenantId, { ...record.settings, refreshIntervals: sanitized });
      if (updated) record = updated;
    }
    return record;
  })
  .get('/api/v1/tenant/users', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return { users: (await listTenantMembers(tenant.tenantId)) ?? [] };
  })
  .put('/api/v1/tenant/users/:id', async ({ params, body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const role = typeof (body as { role?: unknown })?.role === 'string' ? (body as { role: string }).role : '';
    if (!USER_ROLES.includes(role as typeof USER_ROLES[number])) {
      set.status = 400;
      return { error: 'invalid role' };
    }
    const result = await updateTenantMembershipRole(tenant.tenantId, params.id, role);
    if (result === 'not_found') {
      set.status = 404;
      return { error: 'member not found' };
    }
    if (result === 'last_owner') {
      set.status = 400;
      return { error: 'a tenant must keep at least one owner' };
    }
    return { updated: true };
  })
  .delete('/api/v1/tenant/users/:id', async ({ params, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const result = await deleteTenantMembership(tenant.tenantId, params.id);
    if (result === 'not_found') {
      set.status = 404;
      return { error: 'member not found' };
    }
    if (result === 'last_owner') {
      set.status = 400;
      return { error: 'a tenant must keep at least one owner' };
    }
    return { deleted: true };
  })
  .get('/api/v1/tenant/invitations', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return { invitations: (await listInvitations(tenant.tenantId)) ?? [] };
  })
  .post('/api/v1/tenant/invitations', async ({ body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const email = typeof (body as { email?: unknown })?.email === 'string' ? (body as { email: string }).email.trim().toLowerCase() : '';
    const role = typeof (body as { role?: unknown })?.role === 'string' ? (body as { role: string }).role : 'member';
    if (!EMAIL_PATTERN.test(email)) {
      set.status = 400;
      return { error: 'invalid email' };
    }
    if (!USER_ROLES.includes(role as typeof USER_ROLES[number])) {
      set.status = 400;
      return { error: 'invalid role' };
    }
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const invitedBy = UUID_PATTERN.test(tenant.userId) ? tenant.userId : undefined;
    const invitation = await insertInvitation(tenant.tenantId, email, role, tokenHash, expiresAt, invitedBy);
    if (!invitation) {
      set.status = 503;
      return { error: 'invitation storage is unavailable' };
    }
    // No SMTP configured yet (backlog item): return the raw token once so an admin can share the invite link manually.
    return { ...invitation, token };
  })
  .delete('/api/v1/tenant/invitations/:id', async ({ params, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const deleted = await deleteInvitation(tenant.tenantId, params.id);
    if (!deleted) {
      set.status = 404;
      return { error: 'invitation not found' };
    }
    return { deleted: true };
  })
  .get('/api/v1/cloud-accounts', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return { accounts: (await listCloudAccounts(tenant.tenantId)) ?? [] };
  })
  .post('/api/v1/cloud-accounts', async ({ body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const input = body as { provider?: unknown; accountId?: unknown; displayName?: unknown; regions?: unknown; credential?: unknown };
    const provider = typeof input.provider === 'string' ? input.provider : '';
    const accountId = typeof input.accountId === 'string' ? input.accountId.trim() : '';
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    const regions = Array.isArray(input.regions) ? input.regions.filter((region): region is string => typeof region === 'string') : [];
    if (!CLOUD_PROVIDERS.includes(provider as typeof CLOUD_PROVIDERS[number]) || !accountId || !displayName || typeof input.credential !== 'object' || input.credential === null) {
      set.status = 400;
      return { error: 'invalid cloud account payload' };
    }
    let credentialRef: string;
    try {
      credentialRef = encryptSecret(JSON.stringify(input.credential));
    } catch (error) {
      set.status = 503;
      return { error: error instanceof Error ? error.message : 'credential encryption unavailable' };
    }
    let account;
    try {
      account = await insertCloudAccount(tenant.tenantId, { provider, accountId, displayName, regions, credentialRef });
    } catch {
      set.status = 409;
      return { error: 'cloud account already registered for this provider/account id' };
    }
    if (!account) {
      set.status = 503;
      return { error: 'cloud account storage is unavailable' };
    }
    return account;
  })
  .put('/api/v1/cloud-accounts/:id', async ({ params, body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const input = body as { displayName?: unknown; regions?: unknown; enabled?: unknown; credential?: unknown };
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    const regions = Array.isArray(input.regions) ? input.regions.filter((region): region is string => typeof region === 'string') : [];
    const enabled = typeof input.enabled === 'boolean' ? input.enabled : true;
    if (!displayName) {
      set.status = 400;
      return { error: 'display name is required' };
    }
    let credentialRef: string | undefined;
    if (input.credential !== undefined) {
      if (typeof input.credential !== 'object' || input.credential === null) {
        set.status = 400;
        return { error: 'invalid credential payload' };
      }
      try {
        credentialRef = encryptSecret(JSON.stringify(input.credential));
      } catch (error) {
        set.status = 503;
        return { error: error instanceof Error ? error.message : 'credential encryption unavailable' };
      }
    }
    const account = await updateCloudAccount(tenant.tenantId, params.id, { displayName, regions, enabled, credentialRef });
    if (!account) {
      set.status = 404;
      return { error: 'cloud account not found' };
    }
    return account;
  })
  .delete('/api/v1/cloud-accounts/:id', async ({ params, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const deleted = await deleteCloudAccount(tenant.tenantId, params.id);
    if (!deleted) {
      set.status = 404;
      return { error: 'cloud account not found' };
    }
    return { deleted: true };
  })
  .get('/api/v1/identity-providers', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    return { providers: (await listIdentityProviders(tenant.tenantId)) ?? [] };
  })
  .post('/api/v1/identity-providers', async ({ body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const input = body as { kind?: unknown; displayName?: unknown; baseUrl?: unknown; realmOrTenant?: unknown; region?: unknown; clientId?: unknown; credential?: unknown };
    const kind = typeof input.kind === 'string' ? input.kind : '';
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    if (!IDENTITY_PROVIDER_KINDS.includes(kind as typeof IDENTITY_PROVIDER_KINDS[number]) || !displayName || typeof input.credential !== 'object' || input.credential === null) {
      set.status = 400;
      return { error: 'invalid identity provider payload' };
    }
    let credentialRef: string;
    try {
      credentialRef = encryptSecret(JSON.stringify(input.credential));
    } catch (error) {
      set.status = 503;
      return { error: error instanceof Error ? error.message : 'credential encryption unavailable' };
    }
    const provider = await insertIdentityProvider(tenant.tenantId, {
      kind,
      displayName,
      baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
      realmOrTenant: typeof input.realmOrTenant === 'string' ? input.realmOrTenant : undefined,
      region: typeof input.region === 'string' ? input.region : undefined,
      clientId: typeof input.clientId === 'string' ? input.clientId : undefined,
      credentialRef,
    });
    if (!provider) {
      set.status = 503;
      return { error: 'identity provider storage is unavailable' };
    }
    return provider;
  })
  .put('/api/v1/identity-providers/:id', async ({ params, body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const input = body as { displayName?: unknown; baseUrl?: unknown; realmOrTenant?: unknown; region?: unknown; clientId?: unknown; enabled?: unknown; credential?: unknown };
    const displayName = typeof input.displayName === 'string' ? input.displayName.trim() : '';
    if (!displayName) {
      set.status = 400;
      return { error: 'display name is required' };
    }
    let credentialRef: string | undefined;
    if (input.credential !== undefined) {
      if (typeof input.credential !== 'object' || input.credential === null) {
        set.status = 400;
        return { error: 'invalid credential payload' };
      }
      try {
        credentialRef = encryptSecret(JSON.stringify(input.credential));
      } catch (error) {
        set.status = 503;
        return { error: error instanceof Error ? error.message : 'credential encryption unavailable' };
      }
    }
    const provider = await updateIdentityProvider(tenant.tenantId, params.id, {
      displayName,
      baseUrl: typeof input.baseUrl === 'string' ? input.baseUrl : undefined,
      realmOrTenant: typeof input.realmOrTenant === 'string' ? input.realmOrTenant : undefined,
      region: typeof input.region === 'string' ? input.region : undefined,
      clientId: typeof input.clientId === 'string' ? input.clientId : undefined,
      enabled: typeof input.enabled === 'boolean' ? input.enabled : true,
      credentialRef,
    });
    if (!provider) {
      set.status = 404;
      return { error: 'identity provider not found' };
    }
    return provider;
  })
  .delete('/api/v1/identity-providers/:id', async ({ params, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const deleted = await deleteIdentityProvider(tenant.tenantId, params.id);
    if (!deleted) {
      set.status = 404;
      return { error: 'identity provider not found' };
    }
    return { deleted: true };
  })
  .post('/api/v1/honeytokens/callback', ({ body, set }) => {
    try {
      return { accepted: true, event: recordHoneytokenCallback(body) };
    } catch {
      set.status = 400;
      return { error: 'invalid honeytoken callback' };
    }
  })
  .get('/api/v1/honeytokens/callbacks', () => ({ events: listHoneytokenCallbacks() }))
  .listen(port);

console.log(`DurtOne API listening on http://localhost:${app.server?.port}`);