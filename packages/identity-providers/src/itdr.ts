export type IdentityKind = 'human' | 'service-account' | 'bot';

export type IdentityRecord = {
  id: string;
  type: IdentityKind;
  provider: 'keycloak' | 'okta' | 'aws' | 'google';
  name: string;
  status: 'active' | 'suspended' | 'inactive';
  permissions: string[];
  ipAddresses: string[];
  lastSeen: string;
};

export type KeycloakUserLike = {
  id: string;
  username: string;
  enabled?: boolean;
  lastSeen?: string;
  roles?: string[];
  clientRoles?: string[];
  ipAddresses?: string[];
};

export function normalizeKeycloakUsers(users: KeycloakUserLike[]): IdentityRecord[] {
  return users.map((user) => {
    const permissions = [...(user.roles ?? []), ...(user.clientRoles ?? [])];

    return {
      id: user.id,
      type: permissions.some((permission) => /admin|manage|realm|client/i.test(permission)) ? 'service-account' : 'human',
      provider: 'keycloak',
      name: user.username,
      status: user.enabled === false ? 'inactive' : 'active',
      permissions,
      ipAddresses: user.ipAddresses ?? [],
      lastSeen: user.lastSeen ?? new Date(0).toISOString(),
    };
  });
}

export function findStaleIdentities(identities: IdentityRecord[], staleAfterDays = 30) {
  const thresholdMs = staleAfterDays * 24 * 60 * 60 * 1000;

  return identities.filter((identity) => {
    const lastSeenMs = Date.parse(identity.lastSeen);
    if (Number.isNaN(lastSeenMs)) return false;
    return Date.now() - lastSeenMs > thresholdMs;
  });
}

export function buildIdentityRisk(identity: IdentityRecord) {
  const lastSeenAt = new Date(identity.lastSeen).getTime();
  const now = Date.now();
  const ageDays = Math.max(0, (now - lastSeenAt) / 86_400_000);
  const riskyPermissions = identity.permissions.filter((permission) => /admin|manage|write:|read:all|write:all/i.test(permission)).length;
  const healthPenalty = identity.status !== 'active' ? 15 : 0;
  const stalePenalty = ageDays > 30 ? Math.min(35, Math.round(ageDays / 10)) : 0;
  const privilegePenalty = riskyPermissions * 18;
  const typePenalty = identity.type === 'service-account' ? 15 : identity.type === 'bot' ? 10 : 0;

  return Math.min(100, 25 + healthPenalty + stalePenalty + privilegePenalty + typePenalty);
}

export function summarizeIdentities(identities: IdentityRecord[]) {
  const byProvider: Record<string, number> = {};
  const byRisk: Record<'low' | 'medium' | 'high', number> = { low: 0, medium: 0, high: 0 };

  for (const identity of identities) {
    byProvider[identity.provider] = (byProvider[identity.provider] ?? 0) + 1;
    const score = buildIdentityRisk(identity);
    if (score >= 70) byRisk.high += 1;
    else if (score >= 40) byRisk.medium += 1;
    else byRisk.low += 1;
  }

  return {
    total: identities.length,
    byProvider,
    byRisk,
  };
}
