import postgres from 'postgres';
import { createHash, randomBytes } from 'node:crypto';

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

export type AgentEnrollment = {
  id: string;
  name: string;
  token: string;
  tenantId: string;
};

function hashSecret(secret: string) {
  return createHash('sha256').update(secret).digest('hex');
}

export async function createAgentEnrollment(tenantId: string, name: string): Promise<AgentEnrollment | undefined> {
  const client = database();
  if (!client) return undefined;
  const token = `durtone_agent_${randomBytes(32).toString('hex')}`;
  const [key] = await client<{ id: string }[]>`
    insert into api_keys (tenant_id, name, key_hash) values (${tenantId}, ${name}, ${hashSecret(token)}) returning id
  `;
  if (!key) return undefined;
  return { id: key.id, name, token, tenantId };
}

export async function authenticateAgentToken(token: string) {
  const client = database();
  if (!client) return undefined;
  const [key] = await client<{ id: string; tenantId: string }[]>`
    update api_keys set last_used_at = now()
    where key_hash = ${hashSecret(token)} and revoked = false
    returning id, tenant_id as "tenantId"
  `;
  return key;
}

export type AgentEnrollmentSummary = {
  id: string;
  name: string;
  revoked: boolean;
  lastUsedAt: string | null;
  createdAt: string;
};

export async function listAgentEnrollments(tenantId: string): Promise<AgentEnrollmentSummary[] | undefined> {
  const client = database();
  if (!client) return undefined;
  return client<AgentEnrollmentSummary[]>`
    select id, name, revoked, last_used_at as "lastUsedAt", created_at as "createdAt"
    from api_keys
    where tenant_id = ${tenantId}
    order by created_at desc
  `;
}

export async function revokeAgentEnrollment(tenantId: string, id: string) {
  const client = database();
  if (!client) return false;
  const result = await client`
    update api_keys set revoked = true, updated_at = now()
    where id = ${id} and tenant_id = ${tenantId}
  `;
  return result.count > 0;
}

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
    remote_ip: log.remoteIp,
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
  return { ...requestStats, ...endpointStats };
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