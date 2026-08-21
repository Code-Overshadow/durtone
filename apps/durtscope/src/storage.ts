import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | undefined;

function database() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for the DurtScope worker');
  sql ??= postgres(process.env.DATABASE_URL, { max: 5, connect_timeout: 10 });
  return sql;
}

function jsonLiteral(value: unknown) {
  return JSON.stringify(value).replaceAll("'", "''");
}

export type DueIdentityProvider = {
  id: string;
  tenantId: string;
  kind: string;
  displayName: string;
  baseUrl: string | null;
  realmOrTenant: string | null;
  region: string | null;
  clientId: string | null;
  credentialRef: string;
};

export async function listDueIdentityProviders(staleMs: number): Promise<DueIdentityProvider[]> {
  const client = database();
  const cutoff = new Date(Date.now() - staleMs);
  return client<DueIdentityProvider[]>`
    select id, tenant_id as "tenantId", kind, display_name as "displayName", base_url as "baseUrl",
      realm_or_tenant as "realmOrTenant", region, client_id as "clientId", credential_ref as "credentialRef"
    from identity_providers
    where enabled = true and (last_sync_at is null or last_sync_at < ${cutoff})
    order by last_sync_at asc nulls first
  `;
}

export async function touchIdentityProviderSync(id: string) {
  const client = database();
  await client`update identity_providers set last_sync_at = now(), updated_at = now() where id = ${id}`;
}

export type IdentityUpsert = {
  externalId: string;
  name: string;
  kind: string;
  status: string;
  permissions: string[];
  ipAddresses: string[];
  riskScore: number;
  lastSeenAt: string;
};

export async function upsertIdentities(tenantId: string, providerId: string, identities: IdentityUpsert[]) {
  const client = database();
  for (const identity of identities) {
    await client.unsafe(
      `insert into identities (tenant_id, provider_id, external_id, name, kind, status, permissions, ip_addresses, risk_score, last_seen_at)
       values ($1, $2, $3, $4, $5, $6, '${jsonLiteral(identity.permissions)}'::jsonb, '${jsonLiteral(identity.ipAddresses)}'::jsonb, $7, $8)
       on conflict (provider_id, external_id) do update set
         name = excluded.name, kind = excluded.kind, status = excluded.status,
         permissions = excluded.permissions, ip_addresses = excluded.ip_addresses,
         risk_score = excluded.risk_score, last_seen_at = excluded.last_seen_at, updated_at = now()`,
      [tenantId, providerId, identity.externalId, identity.name, identity.kind, identity.status, identity.riskScore, identity.lastSeenAt],
    );
  }
}

export async function closeStorage() {
  if (sql) await sql.end({ timeout: 1 });
  sql = undefined;
}
