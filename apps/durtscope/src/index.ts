import { decryptSecret } from '@durtone/crypto';
import { buildIdentityProviderConfig, buildIdentityRisk, collectProviderIdentities } from '@durtone/identity-providers';
import { listDueIdentityProviders, touchIdentityProviderSync, updateIdentityProviderHealth, upsertIdentities, upsertWorkerHeartbeat, type DueIdentityProvider } from './storage';

const DEFAULT_INTERVAL_MS = Number(process.env.DURTSCOPE_INTERVAL_MS ?? 5 * 60 * 1000);
// How long a provider can go unsynced before it's picked up again. Same deliberate
// single-cadence simplification used by the DurtGuardian worker.
const STALE_MS = Number(process.env.DURTSCOPE_STALE_MS ?? DEFAULT_INTERVAL_MS);

async function syncProvider(row: DueIdentityProvider) {
  const decrypted = decryptSecret(row.credentialRef);
  const config = buildIdentityProviderConfig(row, decrypted);
  const identities = await collectProviderIdentities(config);

  await upsertIdentities(row.tenantId, row.id, identities.map((identity) => ({
    externalId: identity.id,
    name: identity.name,
    kind: identity.type,
    status: identity.status,
    permissions: identity.permissions,
    ipAddresses: identity.ipAddresses,
    riskScore: buildIdentityRisk(identity),
    lastSeenAt: identity.lastSeen,
  })));
  await touchIdentityProviderSync(row.id);
  await updateIdentityProviderHealth(row.id, { status: 'healthy' });

  console.log(JSON.stringify({
    status: 'sync-complete',
    tenantId: row.tenantId,
    provider: row.kind,
    displayName: row.displayName,
    identityCount: identities.length,
  }));
}

export async function runCycle() {
  const due = await listDueIdentityProviders(STALE_MS);
  let failed = 0;
  for (const row of due) {
    try {
      await syncProvider(row);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({
        status: 'sync-failed',
        tenantId: row.tenantId,
        provider: row.kind,
        displayName: row.displayName,
        error: message,
      }));
      await updateIdentityProviderHealth(row.id, { status: 'error', lastError: message }).catch(() => {});
    }
  }

  await upsertWorkerHeartbeat('durtscope', {
    status: failed > 0 && failed === due.length && due.length > 0 ? 'unhealthy' : 'healthy',
    detail: { providersSynced: due.length, providersFailed: failed },
  }).catch((error) => {
    console.error(JSON.stringify({ status: 'heartbeat-failed', error: error instanceof Error ? error.message : String(error) }));
  });
}

if (import.meta.main) {
  console.log(`DurtScope worker started - centralized ITDR, checking every ${DEFAULT_INTERVAL_MS}ms`);
  void runCycle();
  setInterval(() => {
    void runCycle();
  }, DEFAULT_INTERVAL_MS);
}
