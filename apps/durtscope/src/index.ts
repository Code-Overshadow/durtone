import { buildIdentityRisk, summarizeIdentities, type IdentityRecord } from './itdr';
import { listKeycloakUsers, type KeycloakClientConfig } from './keycloak';
import { collectProviderIdentities, type IdentityProviderConfig } from './providers';

const sampleIdentities: IdentityRecord[] = [
  { id: 'keycloak-user-1', type: 'human', provider: 'keycloak', name: 'alice', status: 'active', permissions: ['read:users'], lastSeen: '2026-07-28T00:00:00.000Z' },
  { id: 'keycloak-svc-1', type: 'service-account', provider: 'keycloak', name: 'payments-worker', status: 'active', permissions: ['read:users', 'write:users', 'manage:clients'], lastSeen: '2024-01-01T00:00:00.000Z' },
  { id: 'aws-bot-1', type: 'bot', provider: 'aws', name: 'deploy-bot', status: 'suspended', permissions: ['deploy', 'write:all'], lastSeen: '2026-07-17T00:00:00.000Z' },
];

export function collectIdentitySnapshot() {
  const summary = summarizeIdentities(sampleIdentities);
  return {
    collectedAt: new Date().toISOString(),
    summary,
    identities: sampleIdentities.map((identity) => ({
      ...identity,
      riskScore: buildIdentityRisk(identity),
    })),
  };
}

export async function collectKeycloakSnapshot(config: KeycloakClientConfig) {
  const users = await listKeycloakUsers(config);

  return {
    collectedAt: new Date().toISOString(),
    provider: 'keycloak',
    tokenType: 'Bearer',
    users: users.length,
    summary: summarizeIdentities(
      users.map((user) => ({
        id: user.id,
        type: 'human',
        provider: 'keycloak',
        name: user.username,
        status: user.enabled === false ? 'inactive' : 'active',
        permissions: [...(user.realmRoles ?? []), ...(user.clientRoles ? Object.values(user.clientRoles).flat() : [])],
        lastSeen: user.lastSeen ?? new Date(0).toISOString(),
      })),
    ),
  };
}

export function readProviderConfig(env: Record<string, string | undefined> = process.env): IdentityProviderConfig | null {
  const provider = env.DURTSCOPE_PROVIDER;
  if (!provider || provider === 'none') return null;
  if (provider === 'keycloak') return { provider, baseUrl: env.DURTSCOPE_BASE_URL ?? '', realm: env.DURTSCOPE_REALM ?? '', clientId: env.DURTSCOPE_CLIENT_ID ?? '', clientSecret: env.DURTSCOPE_CLIENT_SECRET ?? '' };
  if (provider === 'okta') return { provider, baseUrl: env.DURTSCOPE_BASE_URL ?? '', apiToken: env.DURTSCOPE_API_TOKEN ?? '' };
  if (provider === 'aws') return { provider, region: env.AWS_REGION ?? env.DURTSCOPE_REGION ?? 'us-east-1', accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY, sessionToken: env.AWS_SESSION_TOKEN };
  return { provider: 'google', baseUrl: env.DURTSCOPE_BASE_URL, accessToken: env.DURTSCOPE_ACCESS_TOKEN ?? '', customer: env.DURTSCOPE_CUSTOMER ?? 'my_customer' };
}

async function publishSnapshot(identities: IdentityRecord[]) {
  const baseUrl = process.env.DURTSCOPE_CONTROL_PLANE_URL;
  if (!baseUrl) return;
  const token = process.env.DURTSCOPE_CONTROL_PLANE_TOKEN;
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/itdr/identities`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ identities: identities.map((identity) => ({ ...identity, riskScore: buildIdentityRisk(identity) })) }),
  });
  if (!response.ok) throw new Error(`Control Plane identity upload failed: ${response.status} ${await response.text()}`);
}

if (import.meta.main) {
  const providerConfig = readProviderConfig();
  if (!providerConfig) {
    console.log(JSON.stringify(collectIdentitySnapshot(), null, 2));
  } else {
    collectProviderIdentities(providerConfig).then(async (identities) => { await publishSnapshot(identities); console.log(JSON.stringify({ collectedAt: new Date().toISOString(), summary: summarizeIdentities(identities), identities: identities.map((identity) => ({ ...identity, riskScore: buildIdentityRisk(identity) })) }, null, 2)); }).catch((error) => { console.error(error); process.exitCode = 1; });
  }
}
