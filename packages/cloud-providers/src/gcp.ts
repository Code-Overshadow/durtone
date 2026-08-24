import { createSign } from 'node:crypto';

export type GcpServiceAccount = {
  client_email?: string;
  private_key?: string;
};

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

async function signedJwt(serviceAccount: GcpServiceAccount): Promise<string> {
  if (!serviceAccount.client_email || !serviceAccount.private_key) {
    throw new Error('GCP service account JSON is missing client_email/private_key');
  }
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64url(JSON.stringify({
    iss: serviceAccount.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform.read-only',
    aud: 'https://oauth2.googleapis.com/token',
    exp: nowSeconds + 3600,
    iat: nowSeconds,
  }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claimSet}`).sign(serviceAccount.private_key);
  return `${header}.${claimSet}.${base64url(signature)}`;
}

/** Exchanges a self-signed JWT for an access token (JWT-bearer grant), then makes the cheapest
 * real call that proves the credential can read the target project - no google-auth SDK
 * dependency, node:crypto covers the RS256 signing already. */
export async function testGcpConnection(serviceAccountJson: string, projectId: string): Promise<void> {
  let serviceAccount: GcpServiceAccount;
  try {
    serviceAccount = JSON.parse(serviceAccountJson) as GcpServiceAccount;
  } catch {
    throw new Error('GCP service account field is not valid JSON');
  }

  const assertion = await signedJwt(serviceAccount);
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }).toString(),
  });
  if (!tokenResponse.ok) throw new Error(`GCP token exchange failed: ${tokenResponse.status} ${await tokenResponse.text()}`);
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token: string };

  const projectResponse = await fetch(`https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!projectResponse.ok) throw new Error(`GCP project check failed: ${projectResponse.status} ${await projectResponse.text()}`);
}
