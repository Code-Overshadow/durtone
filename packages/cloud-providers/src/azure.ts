export type AzureCredential = {
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
};

async function requestJson<T>(url: string, init: RequestInit, label: string): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`${label} failed: ${response.status} ${await response.text()}`);
  return (await response.json()) as T;
}

/** Acquires a management-plane token via client_credentials, then makes the cheapest ARM call
 * that proves the credential can actually read the target subscription. No Azure SDK dependency -
 * same plain-fetch style already used for Keycloak/Okta/Google in @durtone/identity-providers. */
export async function testAzureConnection(credential: AzureCredential, subscriptionId: string): Promise<void> {
  if (!credential.clientId || !credential.clientSecret || !credential.tenantId) {
    throw new Error('Azure credential is missing clientId/clientSecret/tenantId');
  }

  const tokenResponse = await requestJson<{ access_token: string }>(
    `https://login.microsoftonline.com/${credential.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: credential.clientId,
        client_secret: credential.clientSecret,
        scope: 'https://management.azure.com/.default',
      }).toString(),
    },
    'Azure token acquisition',
  );

  const response = await fetch(`https://management.azure.com/subscriptions/${subscriptionId}?api-version=2020-01-01`, {
    headers: { Authorization: `Bearer ${tokenResponse.access_token}` },
  });
  if (!response.ok) throw new Error(`Azure subscription check failed: ${response.status} ${await response.text()}`);
}
