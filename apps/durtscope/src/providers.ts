import { IAMClient, ListAccessKeysCommand, ListRolesCommand, ListUsersCommand } from '@aws-sdk/client-iam';
import { normalizeKeycloakUsers, type IdentityRecord } from './itdr';
import { listKeycloakUsers, type KeycloakClientConfig } from './keycloak';

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
      lastSeen: new Date(0).toISOString(),
    }));
  }

  return identities;
}

export async function collectProviderIdentities(config: IdentityProviderConfig): Promise<IdentityRecord[]> {
  switch (config.provider) {
    case 'keycloak':
      return normalizeKeycloakUsers((await listKeycloakUsers(config)).map((user) => ({
        id: user.id,
        username: user.username,
        enabled: user.enabled,
        lastSeen: user.lastSeen,
        roles: user.realmRoles,
        clientRoles: user.clientRoles ? Object.values(user.clientRoles).flat() : [],
      })));
    case 'okta':
      return listOktaIdentities(config);
    case 'aws':
      return listAwsIamIdentities(config);
    case 'google':
      return listGoogleWorkspaceIdentities(config);
  }
}
