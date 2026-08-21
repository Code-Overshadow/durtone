export type KeycloakTokenResponse = {
  access_token: string;
  expires_in: number;
  token_type: string;
};

export type KeycloakClientConfig = {
  baseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
};

export type KeycloakSession = {
  id: string;
  userId: string;
  ipAddress?: string;
  start?: number;
  lastAccess?: number;
};

async function keycloakRequest<T>(config: KeycloakClientConfig, path: string, init: RequestInit, label: string): Promise<T> {
  const token = await getKeycloakToken(config);
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}${path}`, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' },
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${label} failed: ${response.status} ${text}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export async function getKeycloakToken(config: KeycloakClientConfig): Promise<KeycloakTokenResponse> {
  const tokenUrl = `${config.baseUrl.replace(/\/$/, '')}/realms/${config.realm}/protocol/openid-connect/token`;
  const searchParams = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: searchParams.toString(),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Keycloak token acquisition failed: ${response.status} ${text}`);
  }

  return (await response.json()) as KeycloakTokenResponse;
}

export async function listKeycloakUsers(config: KeycloakClientConfig) {
  return keycloakRequest<Array<{
    id: string;
    username: string;
    enabled?: boolean;
    lastSeen?: string;
    realmRoles?: string[];
    clientRoles?: Record<string, string[]>;
  }>>(config, `/admin/realms/${config.realm}/users`, { method: 'GET' }, 'Keycloak user listing');
}

export async function listKeycloakClients(config: KeycloakClientConfig) {
  return keycloakRequest<Array<{ id: string; clientId: string; enabled?: boolean }>>(
    config,
    `/admin/realms/${config.realm}/clients`,
    { method: 'GET' },
    'Keycloak client listing',
  );
}

export async function listKeycloakUserSessions(config: KeycloakClientConfig, userId: string) {
  return keycloakRequest<KeycloakSession[]>(
    config,
    `/admin/realms/${config.realm}/users/${userId}/sessions`,
    { method: 'GET' },
    'Keycloak session listing',
  );
}

export async function disableKeycloakUser(config: KeycloakClientConfig, userId: string) {
  await keycloakRequest<void>(
    config,
    `/admin/realms/${config.realm}/users/${userId}`,
    { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: false }) },
    'Keycloak user disable',
  );
}

export async function logoutKeycloakUser(config: KeycloakClientConfig, userId: string) {
  await keycloakRequest<void>(
    config,
    `/admin/realms/${config.realm}/users/${userId}/logout`,
    { method: 'POST' },
    'Keycloak user logout',
  );
}
