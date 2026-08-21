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
  const token = await getKeycloakToken(config);
  const endpoint = `${config.baseUrl.replace(/\/$/, '')}/admin/realms/${config.realm}/users`;

  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Keycloak user listing failed: ${response.status} ${text}`);
  }

  return (await response.json()) as Array<{
    id: string;
    username: string;
    enabled?: boolean;
    lastSeen?: string;
    realmRoles?: string[];
    clientRoles?: Record<string, string[]>;
  }>;
}
