import { Elysia } from 'elysia';
import { getDiscoveryStats, ingestLogs, listEndpoints, listRequestLogs, replaceOpenApi } from './discovery';
import { getWafConfig, mergePersistedConfig, updateWafConfig } from './config';
import { listHoneytokenCallbacks, recordHoneytokenCallback } from './honeytokens';
import { getCspmSummary } from './cspm';
import { createAgentEnrollment, getPersistedConfig, getPersistedCspmSummary, getPersistedDiscoveryStats, listPersistedEndpoints, listPersistedLogs, persistConfig, persistEndpoints, persistLogs, persistScan, revokeAgentEnrollment, type PersistedScan } from './storage';
import { correlateGuardianChange, correlateWafAttack, type CspmChange, type WafAttack } from './correlation';
import { onEvent, publishEvent } from './eventBus';
import { buildExecutiveReport } from './report';
import { calculateSecurityScore } from './securityScore';
import { getIdentityHygiene, listSecurityIdentities, replaceSecurityIdentities } from './securityState';
import { authenticateRequest, requireTenant } from './auth';
import { allowRequest } from './rateLimit';

const port = Number(process.env.PORT ?? 3000);
const correlations: Array<Record<string, unknown>> = [];

onEvent('waf.attack', (event) => {
  correlations.push({ eventId: event.id, source: 'durtwall', result: correlateWafAttack(event.payload as WafAttack, listSecurityIdentities()) });
});
onEvent('cspm.drift', (event) => {
  correlations.push({ eventId: event.id, source: 'durtguardian', result: correlateGuardianChange(event.payload as CspmChange, listSecurityIdentities()) });
});

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
        if (entry.blocked && remoteIp) void publishEvent({ type: 'waf.attack', payload: { remoteIp, blocked: true, path: entry.path, reason: entry.reason } });
      }
      return { accepted: count };
    } catch {
      set.status = 400;
      return { error: 'invalid log payload' };
    }
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
  .post('/api/v1/agents/enrollment', async ({ body, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const name = typeof (body as { name?: unknown })?.name === 'string' ? (body as { name: string }).name.trim() : '';
    if (!name || name.length > 120) {
      set.status = 400;
      return { error: 'agent name is required' };
    }
    const enrollment = await createAgentEnrollment(tenant.tenantId, name);
    if (!enrollment) {
      set.status = 503;
      return { error: 'agent enrollment storage is unavailable' };
    }
    return enrollment;
  })
  .delete('/api/v1/agents/enrollment/:id', async ({ params, request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const revoked = await revokeAgentEnrollment(tenant.tenantId, params.id);
    if (!revoked) {
      set.status = 404;
      return { error: 'agent enrollment not found' };
    }
    return { revoked: true };
  })
  .get('/api/v1/agents/config', async ({ request, set }) => {
    const tenant = await requireTenant(request);
    if (!tenant.ok) {
      set.status = tenant.status;
      return { error: tenant.error };
    }
    const persisted = await getPersistedConfig(tenant.tenantId);
    return persisted ? { ...persisted, tenantId: tenant.tenantId } : { ...getWafConfig(), tenantId: tenant.tenantId };
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
  .post('/api/v1/itdr/identities', ({ body, set }) => {
    try {
      const identities = replaceSecurityIdentities(body);
      void publishEvent({ type: 'itdr.snapshot', payload: { totalIdentities: identities.length } });
      return { accepted: identities.length };
    } catch {
      set.status = 400;
      return { error: 'invalid identity snapshot' };
    }
  })
  .get('/api/v1/itdr/identities', () => ({ identities: listSecurityIdentities() }))
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
  .get('/api/v1/security/score', () => calculateSecurityScore({ waf: getDiscoveryStats(), cspm: getCspmSummary(), itdr: getIdentityHygiene() }))
  .get('/api/v1/security/correlations', () => ({ correlations: correlations.slice(-100).reverse() }))
  .get('/api/v1/security/report.pdf', async ({ set }) => {
    const pdf = await buildExecutiveReport(calculateSecurityScore({ waf: getDiscoveryStats(), cspm: getCspmSummary(), itdr: getIdentityHygiene() }));
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