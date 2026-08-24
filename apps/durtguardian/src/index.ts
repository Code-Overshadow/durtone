import { decryptSecret } from '@durtone/crypto';
import { buildProwlerCommand, cleanupCredentialEnv, compareWithBaseline, computeBaselineHash, credentialEnv, summarizeFindings, type ScanSnapshot } from './cspm';
import { getLatestScan, listDueCloudAccounts, persistScan, touchCloudAccountScan, updateCloudAccountHealth, upsertWorkerHeartbeat, type DueCloudAccount } from './storage';

const DEFAULT_INTERVAL_MS = Number(process.env.DURTGUARDIAN_INTERVAL_MS ?? 5 * 60 * 1000);
// How long a cloud account can go unscanned before it's picked up again. Defaults to the tick
// interval itself - one deliberately simple cadence instead of separate 5min/1h schedules.
const STALE_MS = Number(process.env.DURTGUARDIAN_STALE_MS ?? DEFAULT_INTERVAL_MS);

function parseProwlerJson(raw: string, provider: string, accountId: string): ScanSnapshot {
  const parsed = JSON.parse(raw);
  const findings = Array.isArray(parsed) ? parsed : Array.isArray(parsed.findings) ? parsed.findings : [];
  return { provider, accountId, timestamp: new Date().toISOString(), findings };
}

async function runProwlerScan(provider: string, accountId: string, decryptedCredential: string): Promise<ScanSnapshot> {
  const command = buildProwlerCommand({ provider, accountId, mode: 'baseline' });
  const credentialEnvVars = credentialEnv(provider, decryptedCredential);
  try {
    const child = Bun.spawn({
      cmd: command,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...credentialEnvVars },
    });

    const stdout = await new Response(child.stdout).text();
    const stderr = await new Response(child.stderr).text();
    const exitCode = await child.exited;

    if (exitCode !== 0) {
      throw new Error(stderr || `prowler exited with code ${exitCode}`);
    }

    try {
      return parseProwlerJson(stdout, provider, accountId);
    } catch (error) {
      throw new Error(`unable to parse Prowler output: ${String(error)}`);
    }
  } finally {
    cleanupCredentialEnv(credentialEnvVars);
  }
}

async function scanCloudAccount(account: DueCloudAccount) {
  const credential = decryptSecret(account.credentialRef);
  const snapshot = await runProwlerScan(account.provider, account.accountId, credential);
  const summary = summarizeFindings(snapshot.findings);

  const previous = await getLatestScan(account.tenantId, account.provider, account.accountId);
  const previousFindings = Array.isArray(previous?.findings) ? previous.findings : [];
  const drifts = previous ? compareWithBaseline({ ...snapshot, findings: previousFindings }, snapshot) : [];

  await persistScan(account.tenantId, {
    provider: snapshot.provider,
    accountId: snapshot.accountId,
    findings: snapshot.findings,
    baselineHash: computeBaselineHash(snapshot),
    drifts,
  });
  await touchCloudAccountScan(account.id);
  await updateCloudAccountHealth(account.id, { status: 'healthy' });

  console.log(JSON.stringify({
    status: 'scan-complete',
    tenantId: account.tenantId,
    provider: account.provider,
    accountId: account.accountId,
    displayName: account.displayName,
    summary,
    driftCount: drifts.length,
  }));
}

export async function runCycle() {
  const due = await listDueCloudAccounts(STALE_MS);
  let failed = 0;
  for (const account of due) {
    try {
      await scanCloudAccount(account);
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      console.error(JSON.stringify({
        status: 'scan-failed',
        tenantId: account.tenantId,
        provider: account.provider,
        accountId: account.accountId,
        error: message,
      }));
      await updateCloudAccountHealth(account.id, { status: 'error', lastError: message }).catch(() => {});
    }
  }

  await upsertWorkerHeartbeat('durtguardian', {
    status: failed > 0 && failed === due.length && due.length > 0 ? 'unhealthy' : 'healthy',
    detail: { accountsScanned: due.length, accountsFailed: failed },
  }).catch((error) => {
    console.error(JSON.stringify({ status: 'heartbeat-failed', error: error instanceof Error ? error.message : String(error) }));
  });
}

if (import.meta.main) {
  console.log(`DurtGuardian worker started - centralized CSPM, checking every ${DEFAULT_INTERVAL_MS}ms`);
  void runCycle();
  setInterval(() => {
    void runCycle();
  }, DEFAULT_INTERVAL_MS);
}
