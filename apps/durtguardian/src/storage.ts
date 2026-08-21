import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | undefined;

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the DurtGuardian worker');
  sql ??= postgres(process.env.DATABASE_URL, { max: 5, connect_timeout: 10 });
  return sql;
}

function jsonLiteral(value: unknown) {
  return JSON.stringify(value).replaceAll("'", "''");
}

export type DueCloudAccount = {
  id: string;
  tenantId: string;
  provider: string;
  accountId: string;
  displayName: string;
  credentialRef: string;
  regions: string[];
};

export async function listDueCloudAccounts(staleMs: number): Promise<DueCloudAccount[]> {
  const client = database();
  const cutoff = new Date(Date.now() - staleMs);
  return client<DueCloudAccount[]>`
    select id, tenant_id as "tenantId", provider, account_id as "accountId", display_name as "displayName", credential_ref as "credentialRef", regions
    from cloud_accounts
    where enabled = true and (last_scan_at is null or last_scan_at < ${cutoff})
    order by last_scan_at asc nulls first
  `;
}

export async function touchCloudAccountScan(id: string) {
  const client = database();
  await client`update cloud_accounts set last_scan_at = now(), updated_at = now() where id = ${id}`;
}

export type LatestScan = {
  findings: unknown;
  createdAt: string;
};

export async function getLatestScan(tenantId: string, provider: string, accountId: string): Promise<LatestScan | undefined> {
  const client = database();
  const [row] = await client<LatestScan[]>`
    select findings, created_at as "createdAt"
    from scans
    where tenant_id = ${tenantId} and provider = ${provider} and account_id = ${accountId}
    order by created_at desc
    limit 1
  `;
  return row;
}

export type PersistedScan = {
  provider: string;
  accountId: string;
  findings: unknown[];
  baselineHash?: string;
  drifts?: Array<{ kind: 'changed' | 'new' | 'missing'; resource: string; before?: string; after?: string }>;
};

export async function persistScan(tenantId: string, scan: PersistedScan) {
  const client = database();
  const [row] = await client.unsafe<{ id: string }[]>(
    `insert into scans (tenant_id, provider, account_id, status, findings, baseline_hash) values ($1, $2, $3, 'complete', '${jsonLiteral(scan.findings)}'::jsonb, $4) returning id`,
    [tenantId, scan.provider, scan.accountId, scan.baselineHash ?? null],
  );
  if (!row) return;
  for (const drift of scan.drifts ?? []) {
    await client.unsafe(
      `insert into drifts (tenant_id, scan_id, resource, before, after) values ($1, $2, $3, '${jsonLiteral(drift.before ? { status: drift.before } : {})}'::jsonb, '${jsonLiteral(drift.after ? { status: drift.after } : {})}'::jsonb)`,
      [tenantId, row.id, drift.resource],
    );
  }
}

export async function closeStorage() {
  if (sql) await sql.end({ timeout: 1 });
  sql = undefined;
}
