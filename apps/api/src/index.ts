import { Elysia } from 'elysia';
import { decryptSecret } from '@durtone/crypto';
import { buildIdentityProviderConfig, revokeIdentity } from '@durtone/identity-providers';
import { getDiscoveryStats, ingestLogs, listEndpoints, listRequestLogs, replaceOpenApi } from './discovery';
import { getWafConfig, mergePersistedConfig, updateWafConfig } from './config';
import { listHoneytokenCallbacks, recordHoneytokenCallback } from './honeytokens';
import { getCspmSummary } from './cspm';
import { checkCertificate, deleteCertificate, FlyRateLimitError, requestCertificate, type FlyCertificateStatus } from './flyCerts';
import { deleteDomain, getDomain, getIdentityForRevoke, getPersistedConfig, getPersistedCspmSummary, getPersistedDiscoveryStats, getPersistedIdentityHygiene, insertDomain, listActiveRoutes, listDomains, listPendingDomains, listPersistedEndpoints, listPersistedIdentities, listPersistedLogs, persistConfig, persistEndpoints, persistLogs, persistScan, recordAuditLog, recordObservedEndpoint, updateDomainStatus, updateIdentityStatus, type PersistedScan } from './storage';
import { correlateGuardianChange, correlateWafAttack, type CspmChange, type WafAttack } from './correlation';
import { onEvent, publishEvent } from './eventBus';
import { buildExecutiveReport } from './report';
import { calculateSecurityScore } from './securityScore';
import { getIdentityHygiene, listSecurityIdentities, replaceSecurityIdentities } from './securityState';
import { authenticateRequest, requireFleet, requireTenant } from './auth';
import { allowRequest } from './rateLimit';

const port = Number(process.env.PORT ?? 3000);
const correlations: Array<Record<string, unknown>> = [];
const HOSTNAME_PATTERN = /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/;

onEvent('waf.attack', (event) => {
  if (!event.tenantId) return;
  correlations.push({ eventId: event.id, source: 'durtwall', result: correlateWafAttack(event.payload as WafAttack, listSecurityIdentities(event.tenantId)) });
});
onEvent('cspm.drift', (event) => {
  if (!event.tenantId) return;
  correlations.push({ eventId: event.id, source: 'durtguardian', result: correlateGuardianChange(event.payload as CspmChange, listSecurityIdentities(event.tenantId)) });
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
  .post('/api/v1/cspm/drifts', ({ body, set }) => {
    try {
      const change = body as CspmChange;
      if (!change.resource || !change.kind) throw new Error('invalid drift');
      void publishEvent({ type: 'cspm.drift', payload: change });
      return { accepted: true };
    } catch {
      set.status = 400;
      return { error: 'invalid CSPM drift' };
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
  .get('/api/v1/security/correlations', () => ({ correlations: correlations.slice(-100).reverse() }))
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
      const rawConfig = getWafConfig(false);
      const { identityClientSecret: _identityClientSecret, identityAccessToken: _identityAccessToken, ...safeSettings } = rawConfig;
      await persistConfig(tenant.tenantId, {
        upstream: rawConfig.upstream,
        mode: rawConfig.mode,
        alertWebhookUrl: rawConfig.alertWebhookUrl,
        settings: safeSettings,
      });
      return response;
    } catch {
      set.status = 400;
      return { error: 'invalid WAF configuration' };
    }
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