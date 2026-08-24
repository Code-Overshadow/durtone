import { writeFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ProwlerFinding = {
  id?: string;
  check?: string;
  resource?: string;
  status?: string;
  severity?: string;
  [key: string]: unknown;
};

export type ScanSnapshot = {
  provider: string;
  accountId: string;
  timestamp: string;
  findings: ProwlerFinding[];
};

export function normalizeFinding(finding: ProwlerFinding) {
  return {
    id: String(finding.id ?? finding.check ?? finding.resource ?? 'unknown'),
    resource: String(finding.resource ?? 'unknown-resource'),
    status: String(finding.status ?? 'UNKNOWN'),
    severity: String(finding.severity ?? 'unknown'),
  };
}

export function computeBaselineHash(snapshot: ScanSnapshot) {
  const normalized = [...snapshot.findings]
    .map(normalizeFinding)
    .sort((left, right) => left.id.localeCompare(right.id));

  return Bun.hash(
    JSON.stringify({
      provider: snapshot.provider,
      accountId: snapshot.accountId,
      findings: normalized,
    }),
  ).toString();
}

export function buildProwlerCommand(options: { provider: string; accountId?: string; mode?: string }) {
  const provider = options.provider ?? 'aws';
  const accountId = options.accountId ?? 'default';
  const command = ['prowler', provider];

  if (provider === 'azure') {
    command.push('--azure-subscription-ids', accountId);
  } else if (provider === 'gcp') {
    command.push('--gcp-project-ids', accountId);
  } else {
    command.push('--account-id', accountId);
  }

  command.push('--output-formats', 'json');

  if (options.mode === 'baseline') {
    command.push('--quiet');
  }

  return command;
}

export type CloudCredential = {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  serviceAccountJson?: string;
};

/**
 * Maps the decrypted `cloud_accounts.credential_ref` JSON blob to the env vars
 * each cloud provider's SDK (used internally by Prowler) expects. For gcp, the service account
 * JSON is stored inline (not a filesystem path - that never existed inside the container) and
 * gets written to a fresh temp file here, since Prowler/google-auth only accept
 * GOOGLE_APPLICATION_CREDENTIALS as a file path. Call cleanupCredentialEnv after the scan to
 * remove it.
 */
export function credentialEnv(provider: string, decrypted: string): Record<string, string> {
  let credential: CloudCredential;
  try {
    credential = JSON.parse(decrypted) as CloudCredential;
  } catch {
    return {};
  }

  if (provider === 'azure') {
    return {
      AZURE_CLIENT_ID: credential.clientId ?? '',
      AZURE_CLIENT_SECRET: credential.clientSecret ?? '',
      AZURE_TENANT_ID: credential.tenantId ?? '',
    };
  }
  if (provider === 'gcp') {
    const path = join(tmpdir(), `durtguardian-gcp-${Bun.hash(decrypted)}-${Date.now()}.json`);
    writeFileSync(path, credential.serviceAccountJson ?? '{}', { mode: 0o600 });
    return { GOOGLE_APPLICATION_CREDENTIALS: path };
  }
  return {
    AWS_ACCESS_KEY_ID: credential.accessKeyId ?? '',
    AWS_SECRET_ACCESS_KEY: credential.secretAccessKey ?? '',
    ...(credential.sessionToken ? { AWS_SESSION_TOKEN: credential.sessionToken } : {}),
  };
}

/** Removes the temp GOOGLE_APPLICATION_CREDENTIALS file credentialEnv wrote for a gcp scan, if any. */
export function cleanupCredentialEnv(env: Record<string, string>) {
  if (!env.GOOGLE_APPLICATION_CREDENTIALS) return;
  try {
    unlinkSync(env.GOOGLE_APPLICATION_CREDENTIALS);
  } catch {
    // best-effort cleanup
  }
}

export function summarizeFindings(findings: ProwlerFinding[]) {
  const normalized = findings.map(normalizeFinding);
  return {
    total: normalized.length,
    fail: normalized.filter((item) => item.status.toUpperCase() === 'FAIL').length,
    pass: normalized.filter((item) => item.status.toUpperCase() === 'PASS').length,
    critical: normalized.filter((item) => item.severity.toUpperCase() === 'CRITICAL').length,
  };
}

export function compareWithBaseline(previous: ScanSnapshot, current: ScanSnapshot) {
  const previousMap = new Map(
    previous.findings.map((finding) => [normalizeFinding(finding).id, normalizeFinding(finding)]),
  );
  const currentMap = new Map(
    current.findings.map((finding) => [normalizeFinding(finding).id, normalizeFinding(finding)]),
  );

  const drifts: Array<{ kind: 'changed' | 'new' | 'missing'; resource: string; before?: string; after?: string }> = [];

  for (const [id, currentFinding] of currentMap.entries()) {
    const previousFinding = previousMap.get(id);
    if (!previousFinding) {
      drifts.push({ kind: 'new', resource: currentFinding.resource, after: currentFinding.status });
      continue;
    }

    if (previousFinding.status !== currentFinding.status || previousFinding.severity !== currentFinding.severity) {
      drifts.push({
        kind: 'changed',
        resource: currentFinding.resource,
        before: previousFinding.status,
        after: currentFinding.status,
      });
    }
  }

  for (const [id, previousFinding] of previousMap.entries()) {
    if (!currentMap.has(id)) {
      drifts.push({ kind: 'missing', resource: previousFinding.resource, before: previousFinding.status });
    }
  }

  return drifts;
}
