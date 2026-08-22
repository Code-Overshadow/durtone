import postgres from 'postgres';
import { createHash } from 'node:crypto';

let sql: ReturnType<typeof postgres> | undefined;

function jsonLiteral(value: unknown) {
  return JSON.stringify(value).replaceAll("'", "''");
}

function database() {
  if (!process.env.DATABASE_URL) return undefined;
  sql ??= postgres(process.env.DATABASE_URL, { max: 5, connect_timeout: 10 });
  return sql;
}

export type PersistedConfig = {
  upstream: string;
  mode: string;
  alertWebhookUrl?: string;
  settings?: Record<string, unknown>;
};

export type PersistedEndpoint = {
  method: string;
  path: string;
  count: number;
  statusCodes: Record<string, number>;
  documented: boolean;
  shadow: boolean;
};

export type PersistedRequestLog = {
  id: string;
  method: string;
  path: string;
  status: number;
  remoteIp: string | null;
  blocked: boolean;
  reason: string | null;
  timestamp: string;
};

export type PersistedScan = {
  provider: string;
  accountId: string;
  timestamp: string;
  findings: unknown[];
  baselineHash?: string;
  drifts?: Array<{ kind: 'changed' | 'new' | 'missing'; resource: string; before?: string; after?: string }>;
};

export async function getPersistedConfig(tenantId: string): Promise<PersistedConfig | undefined> {
  const client = database();
  if (!client) return undefined;

  const rows = await client<PersistedConfig[]>`
    select upstream, mode, alert_webhook_url as "alertWebhookUrl", settings
    from configs
    where tenant_id = ${tenantId}
    order by updated_at desc
    limit 1
  `;
  return rows[0];
}

export async function persistLogs(tenantId: string, logs: Array<{ method: string; path: string; status: number; blocked: boolean; reason: string; remoteIp?: string }>) {
  const client = database();
  if (!client || !tenantId || logs.length === 0) return false;

  const rows = logs.map((log) => ({
    tenant_id: tenantId,
    method: log.method,
    path: log.path,
    status: log.status,
    remote_ip: log.remoteIp ?? null,
    blocked: log.blocked,
    reason: log.reason,
  }));

  await client`insert into logs ${client(rows)};`;
  return true;
}

export async function persistConfig(tenantId: string, config: PersistedConfig) {
  const client = database();
  if (!client || !tenantId) return false;

  await client.unsafe(
    `insert into configs (tenant_id, upstream, mode, alert_webhook_url, settings) values ($1, $2, $3, $4, '${jsonLiteral(config.settings ?? {})}'::jsonb)`,
    [tenantId, config.upstream, config.mode, config.alertWebhookUrl ?? null],
  );
  return true;
}

export async function closeStorage() {
  if (sql) await sql.end({ timeout: 1 });
  sql = undefined;
}

export async function persistEndpoints(tenantId: string, endpoints: PersistedEndpoint[]) {
  const client = database();
  if (!client || !tenantId) return false;

  for (const endpoint of endpoints) {
    const existing = await client<{ id: string }[]>`
      select id from endpoints where tenant_id = ${tenantId} and method = ${endpoint.method} and path = ${endpoint.path} limit 1
    `;
    if (existing[0]) {
      await client.unsafe(
        `update endpoints set count = $1, status_codes = '${jsonLiteral(endpoint.statusCodes)}'::jsonb, documented = $2, shadow = $3, updated_at = now() where id = $4`,
        [endpoint.count, endpoint.documented, endpoint.shadow, existing[0].id],
      );
    } else {
      await client.unsafe(
        `insert into endpoints (tenant_id, method, path, count, status_codes, documented, shadow) values ($1, $2, $3, $4, '${jsonLiteral(endpoint.statusCodes)}'::jsonb, $5, $6)`,
        [tenantId, endpoint.method, endpoint.path, endpoint.count, endpoint.documented, endpoint.shadow],
      );
    }
  }
  return true;
}

export async function listPersistedEndpoints(tenantId: string): Promise<PersistedEndpoint[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedEndpoint[]>`
    select method, path, count, status_codes as "statusCodes", documented, shadow
    from endpoints where tenant_id = ${tenantId}
    order by path asc, method asc
  `;
}

export async function listPersistedLogs(tenantId: string): Promise<PersistedRequestLog[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedRequestLog[]>`
    select id, method, path, status, remote_ip as "remoteIp", blocked, reason, created_at as "timestamp"
    from logs where tenant_id = ${tenantId}
    order by created_at desc limit 1000
  `;
}

export async function getPersistedDiscoveryStats(tenantId: string) {
  const client = database();
  if (!client) return undefined;
  const [requestStats] = await client<{ totalRequests: number; blockedRequests: number }[]>`
    select count(*)::int as "totalRequests", count(*) filter (where blocked)::int as "blockedRequests"
    from logs where tenant_id = ${tenantId}
  `;
  const [endpointStats] = await client<{ discoveredEndpoints: number; shadowApis: number }[]>`
    select count(*)::int as "discoveredEndpoints", count(*) filter (where shadow)::int as "shadowApis"
    from endpoints where tenant_id = ${tenantId}
  `;
  return {
    totalRequests: requestStats?.totalRequests ?? 0,
    blockedRequests: requestStats?.blockedRequests ?? 0,
    discoveredEndpoints: endpointStats?.discoveredEndpoints ?? 0,
    shadowApis: endpointStats?.shadowApis ?? 0,
  };
}

export async function persistScan(tenantId: string, scan: PersistedScan) {
  const client = database();
  if (!client || !tenantId) return false;
  const [row] = await client.unsafe<{ id: string }[]>(
    `insert into scans (tenant_id, provider, account_id, status, findings, baseline_hash) values ($1, $2, $3, 'complete', '${jsonLiteral(scan.findings)}'::jsonb, $4) returning id`,
    [tenantId, scan.provider, scan.accountId, scan.baselineHash ?? null],
  );
  if (!row) return false;
  for (const drift of scan.drifts ?? []) {
    await client.unsafe(
      `insert into drifts (tenant_id, scan_id, resource, before, after) values ($1, $2, $3, '${jsonLiteral(drift.before ? { status: drift.before } : {})}'::jsonb, '${jsonLiteral(drift.after ? { status: drift.after } : {})}'::jsonb)`,
      [tenantId, row.id, drift.resource],
    );
  }
  return true;
}

export async function getPersistedCspmSummary(tenantId: string) {
  const client = database();
  if (!client) return undefined;
  const [scan] = await client<{ provider: string; accountId: string; findings: unknown; createdAt: string }[]>`
    select provider, account_id as "accountId", findings, created_at as "createdAt"
    from scans where tenant_id = ${tenantId}
    order by created_at desc limit 1
  `;
  if (!scan) return undefined;
  const findings = Array.isArray(scan.findings) ? scan.findings as Array<{ status?: string; severity?: string; resource?: string }> : [];
  const passChecks = findings.filter((finding) => String(finding.status ?? '').toUpperCase() === 'PASS').length;
  const failChecks = findings.filter((finding) => String(finding.status ?? '').toUpperCase() === 'FAIL').length;
  const criticalFindings = findings.filter((finding) => String(finding.severity ?? '').toUpperCase() === 'CRITICAL').length;
  const drifts = await client<{ kind: 'changed' | 'new' | 'missing'; resource: string; before?: string; after?: string }[]>`
    select case when before->>'status' is null then 'new' when after->>'status' is null then 'missing' else 'changed' end as kind,
      resource, before->>'status' as before, after->>'status' as after
    from drifts where tenant_id = ${tenantId} order by created_at desc limit 100
  `;
  return {
    provider: scan.provider,
    accountId: scan.accountId,
    postureScore: findings.length ? Math.round((passChecks / findings.length) * 100) : 0,
    totalChecks: findings.length,
    passChecks,
    failChecks,
    criticalFindings,
    driftCount: drifts.length,
    lastScanAt: scan.createdAt,
    drifts,
  };
}

export type PersistedIdentity = {
  id: string;
  providerId: string;
  providerKind: string;
  externalId: string;
  name: string;
  kind: string;
  status: 'active' | 'suspended' | 'inactive';
  permissions: string[];
  ipAddresses: string[];
  riskScore: number;
  lastSeenAt: string | null;
};

export async function listPersistedIdentities(tenantId: string): Promise<PersistedIdentity[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedIdentity[]>`
    select i.id, i.provider_id as "providerId", ip.kind as "providerKind", i.external_id as "externalId",
      i.name, i.kind, i.status, i.permissions, i.ip_addresses as "ipAddresses", i.risk_score as "riskScore",
      i.last_seen_at as "lastSeenAt"
    from identities i
    join identity_providers ip on ip.id = i.provider_id
    where i.tenant_id = ${tenantId}
    order by i.risk_score desc, i.name asc
  `;
}

export async function getPersistedIdentityHygiene(tenantId: string) {
  const client = database();
  if (!client) return undefined;
  const [row] = await client<{ totalIdentities: number; highRiskIdentities: number; staleIdentities: number }[]>`
    select count(*)::int as "totalIdentities",
      count(*) filter (where risk_score >= 70)::int as "highRiskIdentities",
      count(*) filter (where last_seen_at is not null and last_seen_at < now() - interval '30 days')::int as "staleIdentities"
    from identities where tenant_id = ${tenantId}
  `;
  return {
    totalIdentities: row?.totalIdentities ?? 0,
    highRiskIdentities: row?.highRiskIdentities ?? 0,
    staleIdentities: row?.staleIdentities ?? 0,
  };
}

export type IdentityForRevoke = {
  id: string;
  externalId: string;
  name: string;
  kind: string;
  baseUrl: string | null;
  realmOrTenant: string | null;
  region: string | null;
  clientId: string | null;
  credentialRef: string;
};

export async function getIdentityForRevoke(tenantId: string, identityId: string): Promise<IdentityForRevoke | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = await client<IdentityForRevoke[]>`
    select i.id, i.external_id as "externalId", i.name,
      ip.kind, ip.base_url as "baseUrl", ip.realm_or_tenant as "realmOrTenant",
      ip.region, ip.client_id as "clientId", ip.credential_ref as "credentialRef"
    from identities i
    join identity_providers ip on ip.id = i.provider_id
    where i.tenant_id = ${tenantId} and i.id = ${identityId}
    limit 1
  `;
  return row;
}

export async function updateIdentityStatus(id: string, status: string) {
  const client = database();
  if (!client) return false;
  await client`update identities set status = ${status}, updated_at = now() where id = ${id}`;
  return true;
}

export type AuditLogInput = {
  tenantId: string;
  actorType: 'user' | 'agent' | 'system';
  actorId: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
};

export async function recordAuditLog(input: AuditLogInput) {
  const client = database();
  if (!client) return undefined;
  const [last] = await client<{ hash: string }[]>`
    select hash from audit_logs where tenant_id = ${input.tenantId} order by created_at desc limit 1
  `;
  const previousHash = last?.hash ?? null;
  const metadata = input.metadata ?? {};
  const hash = createHash('sha256').update(JSON.stringify({
    tenantId: input.tenantId,
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    metadata,
    previousHash,
  })).digest('hex');

  await client.unsafe(
    `insert into audit_logs (tenant_id, actor_type, actor_id, action, target_type, target_id, metadata, previous_hash, hash)
     values ($1, $2, $3, $4, $5, $6, '${jsonLiteral(metadata)}'::jsonb, $7, $8)`,
    [input.tenantId, input.actorType, input.actorId, input.action, input.targetType ?? null, input.targetId ?? null, previousHash, hash],
  );
  return { hash, previousHash };
}

export type PersistedCorrelation = {
  id: string;
  source: string;
  result: Record<string, unknown>;
  createdAt: string;
};

export async function listCorrelations(tenantId: string, limit = 100): Promise<PersistedCorrelation[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedCorrelation[]>`
    select id, metadata->>'source' as "source", metadata->'result' as "result", created_at as "createdAt"
    from audit_logs
    where tenant_id = ${tenantId} and action = 'correlation.detected'
    order by created_at desc
    limit ${limit}
  `;
}

export type PersistedDomain = {
  id: string;
  tenantId: string;
  hostname: string;
  status: string;
  certificateStatus: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

export async function insertDomain(tenantId: string, hostname: string): Promise<PersistedDomain | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = await client<PersistedDomain[]>`
    insert into domains (tenant_id, hostname)
    values (${tenantId}, ${hostname})
    returning id, tenant_id as "tenantId", hostname, status, certificate_status as "certificateStatus",
      error_message as "errorMessage", created_at as "createdAt", updated_at as "updatedAt"
  `;
  return row;
}

export async function listDomains(tenantId: string): Promise<PersistedDomain[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedDomain[]>`
    select id, tenant_id as "tenantId", hostname, status, certificate_status as "certificateStatus",
      error_message as "errorMessage", created_at as "createdAt", updated_at as "updatedAt"
    from domains where tenant_id = ${tenantId} order by created_at asc
  `;
}

export async function getDomain(tenantId: string, id: string): Promise<PersistedDomain | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = await client<PersistedDomain[]>`
    select id, tenant_id as "tenantId", hostname, status, certificate_status as "certificateStatus",
      error_message as "errorMessage", created_at as "createdAt", updated_at as "updatedAt"
    from domains where tenant_id = ${tenantId} and id = ${id}
    limit 1
  `;
  return row;
}

export async function deleteDomain(tenantId: string, id: string): Promise<boolean> {
  const client = database();
  if (!client) return false;
  const result = await client`delete from domains where tenant_id = ${tenantId} and id = ${id}`;
  return result.count > 0;
}

export async function updateDomainStatus(id: string, status: string, certificateStatus?: string, errorMessage?: string | null) {
  const client = database();
  if (!client) return false;
  await client`
    update domains set status = ${status}, certificate_status = ${certificateStatus ?? null},
      error_message = ${errorMessage ?? null}, updated_at = now()
    where id = ${id}
  `;
  return true;
}

export async function listPendingDomains(): Promise<PersistedDomain[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedDomain[]>`
    select id, tenant_id as "tenantId", hostname, status, certificate_status as "certificateStatus",
      error_message as "errorMessage", created_at as "createdAt", updated_at as "updatedAt"
    from domains where status in ('pending_dns', 'pending_certificate')
    order by updated_at asc
  `;
}

export type EdgeRouteEndpointHint = {
  method: string;
  path: string;
  documented: boolean;
};

export type EdgeRoute = {
  hostname: string;
  tenantId: string;
  upstream: string;
  mode: string;
  alertWebhookUrl: string | null;
  settings: Record<string, unknown>;
  knownEndpoints: EdgeRouteEndpointHint[];
};

const MAX_KNOWN_ENDPOINTS_PER_TENANT = 200;

/**
 * Active domain -> tenant config mapping the durtwall edge fleet polls to know how to route each
 * Host. Also attaches each tenant's DurtShield-discovered endpoints (`knownEndpoints`), capped per
 * tenant and ordered by observation count - the synthetic honeypot (apps/durtwall/honeypot.go)
 * uses these to shape decoy responses after the tenant's real API instead of a generic fake.
 */
export async function listActiveRoutes(): Promise<EdgeRoute[]> {
  const client = database();
  if (!client) return [];
  const routes = await client<Omit<EdgeRoute, 'knownEndpoints'>[]>`
    select d.hostname, d.tenant_id as "tenantId", c.upstream, c.mode,
      c.alert_webhook_url as "alertWebhookUrl", c.settings
    from domains d
    join lateral (
      select upstream, mode, alert_webhook_url, settings
      from configs
      where tenant_id = d.tenant_id
      order by updated_at desc
      limit 1
    ) c on true
    where d.status = 'active'
  `;
  if (routes.length === 0) return [];

  const tenantIds = [...new Set(routes.map((route) => route.tenantId))];
  const endpointRows = await client<Array<EdgeRouteEndpointHint & { tenantId: string }>>`
    select tenant_id as "tenantId", method, path, documented
    from endpoints
    where tenant_id = any(${tenantIds})
    order by count desc
  `;
  const endpointsByTenant = new Map<string, EdgeRouteEndpointHint[]>();
  for (const row of endpointRows) {
    const list = endpointsByTenant.get(row.tenantId) ?? [];
    if (list.length < MAX_KNOWN_ENDPOINTS_PER_TENANT) {
      list.push({ method: row.method, path: row.path, documented: row.documented });
      endpointsByTenant.set(row.tenantId, list);
    }
  }

  return routes.map((route) => ({ ...route, knownEndpoints: endpointsByTenant.get(route.tenantId) ?? [] }));
}

/**
 * Tenant-scoped upsert used by the fleet log-ingestion path (apps/durtwall serves many tenants at
 * once, so the global in-memory aggregation in discovery.ts - which predates multi-tenancy and is
 * left as-is for the single-tenant/no-DB fallback path - can't be used here without leaking counts
 * across tenants). Shadow/documented classification isn't tenant-scoped anywhere yet (the OpenAPI
 * comparison in discovery.ts is also global), so this always records `documented: false, shadow: false`
 * rather than guess - a false "shadow API" alert is worse than a missed one. Tracked as backlog.
 */
export type PersistedTenant = {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
};

export async function getTenant(tenantId: string): Promise<PersistedTenant | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = await client<PersistedTenant[]>`
    select id, name, slug, created_at as "createdAt" from tenants where id = ${tenantId} limit 1
  `;
  return row;
}

export async function updateTenantName(tenantId: string, name: string): Promise<PersistedTenant | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = await client<PersistedTenant[]>`
    update tenants set name = ${name}, updated_at = now() where id = ${tenantId}
    returning id, name, slug, created_at as "createdAt"
  `;
  return row;
}

export type PersistedUser = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
};

export async function listTenantUsers(tenantId: string): Promise<PersistedUser[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedUser[]>`
    select id, email, role, created_at as "createdAt" from users where tenant_id = ${tenantId} order by created_at asc
  `;
}

export async function updateTenantUserRole(tenantId: string, userId: string, role: string): Promise<boolean> {
  const client = database();
  if (!client) return false;
  const result = await client`update users set role = ${role}, updated_at = now() where tenant_id = ${tenantId} and id = ${userId}`;
  return result.count > 0;
}

export async function deleteTenantUser(tenantId: string, userId: string): Promise<boolean> {
  const client = database();
  if (!client) return false;
  const result = await client`delete from users where tenant_id = ${tenantId} and id = ${userId}`;
  return result.count > 0;
}

export type PersistedInvitation = {
  id: string;
  email: string;
  role: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
};

export async function insertInvitation(tenantId: string, email: string, role: string, tokenHash: string, expiresAt: Date, invitedBy?: string): Promise<PersistedInvitation | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = await client<PersistedInvitation[]>`
    insert into tenant_invitations (tenant_id, email, role, token_hash, invited_by, expires_at)
    values (${tenantId}, ${email}, ${role}, ${tokenHash}, ${invitedBy ?? null}, ${expiresAt})
    returning id, email, role, created_at as "createdAt", expires_at as "expiresAt", accepted_at as "acceptedAt"
  `;
  return row;
}

export async function listInvitations(tenantId: string): Promise<PersistedInvitation[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedInvitation[]>`
    select id, email, role, created_at as "createdAt", expires_at as "expiresAt", accepted_at as "acceptedAt"
    from tenant_invitations where tenant_id = ${tenantId} order by created_at desc
  `;
}

export async function deleteInvitation(tenantId: string, id: string): Promise<boolean> {
  const client = database();
  if (!client) return false;
  const result = await client`delete from tenant_invitations where tenant_id = ${tenantId} and id = ${id}`;
  return result.count > 0;
}

export type PersistedCloudAccount = {
  id: string;
  provider: string;
  accountId: string;
  displayName: string;
  regions: string[];
  enabled: boolean;
  lastScanAt: string | null;
  createdAt: string;
};

const CLOUD_ACCOUNT_COLUMNS = `id, provider, account_id as "accountId", display_name as "displayName", regions, enabled,
      last_scan_at as "lastScanAt", created_at as "createdAt"`;

export async function listCloudAccounts(tenantId: string): Promise<PersistedCloudAccount[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client.unsafe<PersistedCloudAccount[]>(
    `select ${CLOUD_ACCOUNT_COLUMNS} from cloud_accounts where tenant_id = $1 order by created_at asc`,
    [tenantId],
  );
}

export async function insertCloudAccount(tenantId: string, input: { provider: string; accountId: string; displayName: string; regions: string[]; credentialRef: string }): Promise<PersistedCloudAccount | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = await client.unsafe<PersistedCloudAccount[]>(
    `insert into cloud_accounts (tenant_id, provider, account_id, display_name, credential_ref, regions)
     values ($1, $2, $3, $4, $5, '${jsonLiteral(input.regions)}'::jsonb)
     returning ${CLOUD_ACCOUNT_COLUMNS}`,
    [tenantId, input.provider, input.accountId, input.displayName, input.credentialRef],
  );
  return row;
}

export async function updateCloudAccount(tenantId: string, id: string, input: { displayName: string; regions: string[]; enabled: boolean; credentialRef?: string }): Promise<PersistedCloudAccount | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = input.credentialRef
    ? await client.unsafe<PersistedCloudAccount[]>(
        `update cloud_accounts set display_name = $1, regions = '${jsonLiteral(input.regions)}'::jsonb, enabled = $2, credential_ref = $3, updated_at = now()
         where tenant_id = $4 and id = $5
         returning ${CLOUD_ACCOUNT_COLUMNS}`,
        [input.displayName, input.enabled, input.credentialRef, tenantId, id],
      )
    : await client.unsafe<PersistedCloudAccount[]>(
        `update cloud_accounts set display_name = $1, regions = '${jsonLiteral(input.regions)}'::jsonb, enabled = $2, updated_at = now()
         where tenant_id = $3 and id = $4
         returning ${CLOUD_ACCOUNT_COLUMNS}`,
        [input.displayName, input.enabled, tenantId, id],
      );
  return row;
}

export async function deleteCloudAccount(tenantId: string, id: string): Promise<boolean> {
  const client = database();
  if (!client) return false;
  const result = await client`delete from cloud_accounts where tenant_id = ${tenantId} and id = ${id}`;
  return result.count > 0;
}

export type PersistedIdentityProvider = {
  id: string;
  kind: string;
  displayName: string;
  baseUrl: string | null;
  realmOrTenant: string | null;
  region: string | null;
  clientId: string | null;
  enabled: boolean;
  lastSyncAt: string | null;
  createdAt: string;
};

export async function listIdentityProviders(tenantId: string): Promise<PersistedIdentityProvider[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<PersistedIdentityProvider[]>`
    select id, kind, display_name as "displayName", base_url as "baseUrl", realm_or_tenant as "realmOrTenant",
      region, client_id as "clientId", enabled, last_sync_at as "lastSyncAt", created_at as "createdAt"
    from identity_providers where tenant_id = ${tenantId} order by created_at asc
  `;
}

export async function insertIdentityProvider(tenantId: string, input: { kind: string; displayName: string; baseUrl?: string; realmOrTenant?: string; region?: string; clientId?: string; credentialRef: string }): Promise<PersistedIdentityProvider | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = await client<PersistedIdentityProvider[]>`
    insert into identity_providers (tenant_id, kind, display_name, base_url, realm_or_tenant, region, client_id, credential_ref)
    values (${tenantId}, ${input.kind}, ${input.displayName}, ${input.baseUrl ?? null}, ${input.realmOrTenant ?? null}, ${input.region ?? null}, ${input.clientId ?? null}, ${input.credentialRef})
    returning id, kind, display_name as "displayName", base_url as "baseUrl", realm_or_tenant as "realmOrTenant",
      region, client_id as "clientId", enabled, last_sync_at as "lastSyncAt", created_at as "createdAt"
  `;
  return row;
}

export async function updateIdentityProvider(tenantId: string, id: string, input: { displayName: string; baseUrl?: string; realmOrTenant?: string; region?: string; clientId?: string; enabled: boolean; credentialRef?: string }): Promise<PersistedIdentityProvider | undefined> {
  const client = database();
  if (!client) return undefined;
  const [row] = input.credentialRef
    ? await client<PersistedIdentityProvider[]>`
        update identity_providers set display_name = ${input.displayName}, base_url = ${input.baseUrl ?? null},
          realm_or_tenant = ${input.realmOrTenant ?? null}, region = ${input.region ?? null}, client_id = ${input.clientId ?? null},
          enabled = ${input.enabled}, credential_ref = ${input.credentialRef}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${id}
        returning id, kind, display_name as "displayName", base_url as "baseUrl", realm_or_tenant as "realmOrTenant",
          region, client_id as "clientId", enabled, last_sync_at as "lastSyncAt", created_at as "createdAt"
      `
    : await client<PersistedIdentityProvider[]>`
        update identity_providers set display_name = ${input.displayName}, base_url = ${input.baseUrl ?? null},
          realm_or_tenant = ${input.realmOrTenant ?? null}, region = ${input.region ?? null}, client_id = ${input.clientId ?? null},
          enabled = ${input.enabled}, updated_at = now()
        where tenant_id = ${tenantId} and id = ${id}
        returning id, kind, display_name as "displayName", base_url as "baseUrl", realm_or_tenant as "realmOrTenant",
          region, client_id as "clientId", enabled, last_sync_at as "lastSyncAt", created_at as "createdAt"
      `;
  return row;
}

export async function deleteIdentityProvider(tenantId: string, id: string): Promise<boolean> {
  const client = database();
  if (!client) return false;
  const result = await client`delete from identity_providers where tenant_id = ${tenantId} and id = ${id}`;
  return result.count > 0;
}

export async function recordObservedEndpoint(tenantId: string, method: string, path: string, statusCode: number) {
  const client = database();
  if (!client || !tenantId) return false;
  const [existing] = await client<{ id: string; statusCodes: Record<string, number> }[]>`
    select id, status_codes as "statusCodes" from endpoints where tenant_id = ${tenantId} and method = ${method} and path = ${path} limit 1
  `;
  if (existing) {
    const statusCodes = { ...existing.statusCodes, [String(statusCode)]: (existing.statusCodes[String(statusCode)] ?? 0) + 1 };
    await client.unsafe(
      `update endpoints set count = count + 1, status_codes = '${jsonLiteral(statusCodes)}'::jsonb, updated_at = now() where id = $1`,
      [existing.id],
    );
  } else {
    await client.unsafe(
      `insert into endpoints (tenant_id, method, path, count, status_codes, documented, shadow) values ($1, $2, $3, 1, '${jsonLiteral({ [String(statusCode)]: 1 })}'::jsonb, false, false)`,
      [tenantId, method, path],
    );
  }
  return true;
}