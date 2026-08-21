import { DeleteAccessKeyCommand, IAMClient, ListAccessKeysCommand, ListRolesCommand, ListUsersCommand } from '@aws-sdk/client-iam';
import { normalizeKeycloakUsers, type IdentityRecord } from './itdr';
import {
  disableKeycloakUser,
  listKeycloakUserSessions,
  listKeycloakUsers,
  logoutKeycloakUser,
  type KeycloakClientConfig,
} from './keycloak';

export type OktaConfig = {
  baseUrl: string;
  apiToken: string;
};

export type GoogleWorkspaceConfig = {
  baseUrl?: string;
  accessToken: string;
  customer: string;
};

export type AwsIamConfig = {
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
};

export type IdentityProviderConfig =
  | ({ provider: 'keycloak' } & KeycloakClientConfig)
  | ({ provider: 'okta' } & OktaConfig)
  | ({ provider: 'aws' } & AwsIamConfig)
  | ({ provider: 'google' } & GoogleWorkspaceConfig);

function asIdentity(input: Omit<IdentityRecord, 'provider'> & { provider: IdentityRecord['provider'] }): IdentityRecord {
  return input;
}

async function requestJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

export async function listOktaIdentities(config: OktaConfig): Promise<IdentityRecord[]> {
  type OktaUser = {
    id: string;
    status?: string;
    lastLogin?: string;
    profile?: { login?: string; displayName?: string };
  };
  const users = await requestJson<OktaUser[]>(`${config.baseUrl.replace(/\/$/, '')}/api/v1/users`, {
    headers: { Authorization: `SSWS ${config.apiToken}`, Accept: 'application/json' },
  }, 'Okta user listing');

  return users.map((user) => asIdentity({
    id: user.id,
    type: 'human',
    provider: 'okta',
    name: user.profile?.displayName ?? user.profile?.login ?? user.id,
    status: user.status === 'ACTIVE' ? 'active' : user.status === 'SUSPENDED' ? 'suspended' : 'inactive',
    permissions: [],
    ipAddresses: [],
    lastSeen: user.lastLogin ?? new Date(0).toISOString(),
  }));
}

export async function listGoogleWorkspaceIdentities(config: GoogleWorkspaceConfig): Promise<IdentityRecord[]> {
  type GoogleUser = {
    id: string;
    primaryEmail?: string;
    name?: { fullName?: string };
    suspended?: boolean;
    lastLoginTime?: string;
    isAdmin?: boolean;
  };
  const baseUrl = config.baseUrl ?? 'https://admin.googleapis.com/admin/directory/v1';
  const users = await requestJson<{ users?: GoogleUser[] }>(
    `${baseUrl.replace(/\/$/, '')}/users?customer=${encodeURIComponent(config.customer)}&maxResults=500`,
    { headers: { Authorization: `Bearer ${config.accessToken}`, Accept: 'application/json' } },
    'Google Workspace user listing',
  );

  return (users.users ?? []).map((user) => asIdentity({
    id: user.id,
    type: user.isAdmin ? 'service-account' : 'human',
    provider: 'google',
    name: user.name?.fullName ?? user.primaryEmail ?? user.id,
    status: user.suspended ? 'suspended' : 'active',
    permissions: user.isAdmin ? ['admin'] : [],
    ipAddresses: [],
    lastSeen: user.lastLoginTime ?? new Date(0).toISOString(),
  }));
}

export async function listAwsIamIdentities(config: AwsIamConfig): Promise<IdentityRecord[]> {
  const client = new IAMClient({
    region: config.region,
    credentials: config.accessKeyId && config.secretAccessKey ? {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    } : undefined,
  });
  const [users, roles] = await Promise.all([
    client.send(new ListUsersCommand({})),
    client.send(new ListRolesCommand({})),
  ]);
  const identities: IdentityRecord[] = [];

  for (const user of users.Users ?? []) {
    const accessKeys = await client.send(new ListAccessKeysCommand({ UserName: user.UserName }));
    identities.push(asIdentity({
      id: user.UserId ?? user.UserName ?? crypto.randomUUID(),
      type: 'service-account',
      provider: 'aws',
      name: user.UserName ?? user.UserId ?? 'aws-user',
      status: 'active',
      permissions: accessKeys.AccessKeyMetadata?.map((key) => key.Status ?? 'unknown') ?? [],
      ipAddresses: [],
      lastSeen: user.PasswordLastUsed?.toISOString() ?? new Date(0).toISOString(),
    }));
  }

  for (const role of roles.Roles ?? []) {
    identities.push(asIdentity({
      id: role.RoleId ?? role.RoleName ?? crypto.randomUUID(),
      type: 'service-account',
      provider: 'aws',
      name: role.RoleName ?? role.RoleId ?? 'aws-role',
      status: 'active',
      permissions: ['iam-role'],
      ipAddresses: [],
      lastSeen: new Date(0).toISOString(),
    }));
  }

  return identities;
}

async function enrichKeycloakSessionIps(config: KeycloakClientConfig, users: Awaited<ReturnType<typeof listKeycloakUsers>>) {
  return Promise.all(users.map(async (user) => {
    try {
      const sessions = await listKeycloakUserSessions(config, user.id);
      const ipAddresses = [...new Set(sessions.map((session) => session.ipAddress).filter((ip): ip is string => Boolean(ip)))];
      return { user, ipAddresses };
    } catch {
      return { user, ipAddresses: [] as string[] };
    }
  }));
}

export async function collectProviderIdentities(config: IdentityProviderConfig): Promise<IdentityRecord[]> {
  switch (config.provider) {
    case 'keycloak': {
      const users = await listKeycloakUsers(config);
      const enriched = await enrichKeycloakSessionIps(config, users);
      return normalizeKeycloakUsers(enriched.map(({ user, ipAddresses }) => ({
        id: user.id,
        username: user.username,
        enabled: user.enabled,
        lastSeen: user.lastSeen,
        roles: user.realmRoles,
        clientRoles: user.clientRoles ? Object.values(user.clientRoles).flat() : [],
        ipAddresses,
      })));
    }
    case 'okta':
      return listOktaIdentities(config);
    case 'aws':
      return listAwsIamIdentities(config);
    case 'google':
      return listGoogleWorkspaceIdentities(config);
  }
}

async function deactivateOktaUser(config: OktaConfig, userId: string) {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/api/v1/users/${userId}/lifecycle/deactivate`, {
    method: 'POST',
    headers: { Authorization: `SSWS ${config.apiToken}`, Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`Okta user deactivation failed: ${response.status} ${await response.text()}`);
}

async function suspendGoogleWorkspaceUser(config: GoogleWorkspaceConfig, userId: string) {
  const baseUrl = config.baseUrl ?? 'https://admin.googleapis.com/admin/directory/v1';
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/users/${encodeURIComponent(userId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${config.accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ suspended: true }),
  });
  if (!response.ok) throw new Error(`Google Workspace user suspension failed: ${response.status} ${await response.text()}`);
}

async function revokeAwsIamAccessKeys(config: AwsIamConfig, userName: string) {
  const client = new IAMClient({
    region: config.region,
    credentials: config.accessKeyId && config.secretAccessKey ? {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
      ...(config.sessionToken ? { sessionToken: config.sessionToken } : {}),
    } : undefined,
  });
  const accessKeys = await client.send(new ListAccessKeysCommand({ UserName: userName }));
  for (const key of accessKeys.AccessKeyMetadata ?? []) {
    if (!key.AccessKeyId) continue;
    await client.send(new DeleteAccessKeyCommand({ UserName: userName, AccessKeyId: key.AccessKeyId }));
  }
}

export type IdentityProviderRow = {
  kind: string;
  baseUrl: string | null;
  realmOrTenant: string | null;
  region: string | null;
  clientId: string | null;
};

/**
 * Maps an `identity_providers` DB row plus its decrypted `credential_ref` JSON blob
 * to the config shape each provider's client functions expect. Shared by the DurtScope
 * worker (sync) and the Control Plane's revoke route, so both agree on the same
 * credential JSON shape per provider kind.
 */
export function buildIdentityProviderConfig(row: IdentityProviderRow, decryptedCredential: string): IdentityProviderConfig {
  const secret = JSON.parse(decryptedCredential) as Record<string, string>;
  switch (row.kind) {
    case 'keycloak':
      return { provider: 'keycloak', baseUrl: row.baseUrl ?? '', realm: row.realmOrTenant ?? '', clientId: row.clientId ?? '', clientSecret: secret.clientSecret ?? '' };
    case 'okta':
      return { provider: 'okta', baseUrl: row.baseUrl ?? '', apiToken: secret.apiToken ?? '' };
    case 'aws':
      return { provider: 'aws', region: row.region ?? 'us-east-1', accessKeyId: secret.accessKeyId, secretAccessKey: secret.secretAccessKey, sessionToken: secret.sessionToken };
    case 'google':
      return { provider: 'google', baseUrl: row.baseUrl ?? undefined, accessToken: secret.accessToken ?? '', customer: row.realmOrTenant ?? 'my_customer' };
    default:
      throw new Error(`unsupported identity provider kind: ${row.kind}`);
  }
}

export type RevokeResult = { provider: IdentityRecord['provider']; action: string };

/**
 * Performs the actual revocation against the identity provider. `identity` must carry the
 * provider's own id/name (not the DurtOne `identities.id` primary key).
 */
export async function revokeIdentity(config: IdentityProviderConfig, identity: { id: string; name: string }): Promise<RevokeResult> {
  switch (config.provider) {
    case 'keycloak':
      await disableKeycloakUser(config, identity.id);
      await logoutKeycloakUser(config, identity.id);
      return { provider: 'keycloak', action: 'disabled and logged out' };
    case 'okta':
      await deactivateOktaUser(config, identity.id);
      return { provider: 'okta', action: 'deactivated' };
    case 'google':
      await suspendGoogleWorkspaceUser(config, identity.id);
      return { provider: 'google', action: 'suspended' };
    case 'aws':
      await revokeAwsIamAccessKeys(config, identity.name);
      return { provider: 'aws', action: 'access keys deleted' };
  }
}
