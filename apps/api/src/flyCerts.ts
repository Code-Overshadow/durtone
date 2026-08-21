function flyApiBase() {
  return process.env.FLY_API_BASE_URL ?? 'https://api.machines.dev/v1';
}

export class FlyRateLimitError extends Error {
  retryAfterSeconds?: number;
  constructor(retryAfterSeconds?: number) {
    super('Fly certificates API rate limited');
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export type FlyCertificateStatus = {
  hostname: string;
  /** Best-effort read of Fly's response - field names aren't 100% confirmed against a live account, see comment below. */
  ready: boolean;
  awaitingDns: boolean;
  raw: unknown;
};

function flyConfigured() {
  return Boolean(process.env.FLY_API_TOKEN && process.env.FLY_APP_NAME);
}

async function flyRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!flyConfigured()) throw new Error('FLY_API_TOKEN/FLY_APP_NAME is not configured');
  const response = await fetch(`${flyApiBase()}/apps/${process.env.FLY_APP_NAME}/certificates${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.FLY_API_TOKEN}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (response.status === 429) {
    const retryAfter = response.headers.get('retry-after');
    throw new FlyRateLimitError(retryAfter ? Number(retryAfter) : undefined);
  }
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Fly certificates API failed: ${response.status} ${text}`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

/**
 * Fly's exact REST response shape for certificates wasn't confirmed against a live account while
 * building this (no Fly credentials available in this environment) - the community/GraphQL examples
 * researched use field names like `configured`/`acmeDnsConfigured`/`issued`, but the REST payload may
 * differ. This reads several plausible field names defensively and never claims `ready: true` unless
 * a clear positive signal is present; the raw response is always kept in `raw` (persisted verbatim into
 * domains.certificate_status) so this can be corrected from real data on first live test.
 */
function normalizeCertificateResponse(hostname: string, raw: unknown): FlyCertificateStatus {
  const data = (raw ?? {}) as Record<string, unknown>;
  const certificate = (data.certificate ?? data) as Record<string, unknown>;
  const statusText = String(certificate.clientStatus ?? certificate.status ?? '').toLowerCase();

  const ready = Boolean(certificate.issued) || statusText.includes('ready') || statusText.includes('active');
  const configured = Boolean(certificate.configured) || Boolean(certificate.acmeDnsConfigured) || Boolean(certificate.acmeAlpnConfigured);
  const awaitingDns = !configured && !ready;

  return { hostname, ready, awaitingDns, raw };
}

export async function requestCertificate(hostname: string): Promise<FlyCertificateStatus> {
  const raw = await flyRequest<unknown>('/acme', { method: 'POST', body: JSON.stringify({ hostname }) });
  return normalizeCertificateResponse(hostname, raw);
}

export async function checkCertificate(hostname: string): Promise<FlyCertificateStatus> {
  const raw = await flyRequest<unknown>(`/${encodeURIComponent(hostname)}/check`, { method: 'POST' });
  return normalizeCertificateResponse(hostname, raw);
}

export async function deleteCertificate(hostname: string): Promise<void> {
  await flyRequest<void>(`/${encodeURIComponent(hostname)}`, { method: 'DELETE' });
}
