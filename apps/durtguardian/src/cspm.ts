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

/**
 * Prowler 5.x dropped the plain `json` output mode (--output-formats now only accepts
 * csv/json-asff/json-ocsf/html/sarif) and `--quiet` no longer exists - confirmed by reading the
 * installed CLI's own --help, not guessed. json-ocsf is the only structured, cross-provider JSON
 * mode left, and it's always written to a FILE (never stdout) - see parseOcsfFindings below for
 * where that file gets read back.
 */
export function buildProwlerCommand(options: { provider: string; accountId?: string; outputDirectory: string; outputFilename: string }) {
  const provider = options.provider ?? 'aws';
  const accountId = options.accountId ?? 'default';
  const command = ['prowler', provider];

  // Confirmed against the installed CLI's own --help (per-provider flags, not guessed): AWS has
  // no account/id flag at all - the account is whatever the credentials resolve to via STS, no
  // way to target a different one. Azure/GCP flags are singular ("--subscription-id"/
  // "--project-id", both nargs='+') - the plural "--azure-subscription-ids"/"--gcp-project-ids"
  // this used before don't exist in Prowler 5.x and fail as "unrecognized arguments".
  if (provider === 'azure') {
    // Azure has no default auth method - must be picked explicitly. credentialEnv sets
    // AZURE_CLIENT_ID/SECRET/TENANT_ID (service principal via env vars), so --sp-env-auth is the
    // one that matches; without it Prowler exits with AzureNoAuthenticationMethodError.
    command.push('--sp-env-auth', '--subscription-id', accountId);
  } else if (provider === 'gcp') {
    command.push('--project-id', accountId);
  }

  command.push('--output-formats', 'json-ocsf');
  command.push('--output-filename', options.outputFilename);
  command.push('--output-directory', options.outputDirectory);
  command.push('--only-logs');

  return command;
}

/** OCSF (Open Cybersecurity Schema Framework) shape Prowler 5.x's json-ocsf mode writes - only
 * the fields we actually need, straight from prowler/lib/outputs/ocsf/ocsf.py's own transform:
 * `status_code` carries the original PASS/FAIL/MANUAL string (status_id is a generic OCSF review
 * workflow enum, NOT pass/fail), `severity` is already the plain capitalized string. */
type OcsfFinding = {
  status_code?: string;
  severity?: string;
  resources?: Array<{ uid?: string; name?: string }>;
  metadata?: { event_code?: string };
  finding_info?: { uid?: string };
};

export function parseOcsfFindings(raw: string): ProwlerFinding[] {
  const parsed = JSON.parse(raw) as unknown;
  if (!Array.isArray(parsed)) return [];
  return (parsed as OcsfFinding[]).map((item) => ({
    id: item.metadata?.event_code ?? item.finding_info?.uid ?? 'unknown',
    resource: item.resources?.[0]?.uid ?? item.resources?.[0]?.name ?? 'unknown-resource',
    status: item.status_code ?? 'UNKNOWN',
    severity: item.severity ?? 'unknown',
  }));
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
