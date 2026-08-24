import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decryptSecret } from '@durtone/crypto';
import { buildProwlerCommand, cleanupCredentialEnv, compareWithBaseline, computeBaselineHash, credentialEnv, parseOcsfFindings, summarizeFindings, type ScanSnapshot } from './cspm';
import { getLatestScan, listDueCloudAccounts, persistScan, touchCloudAccountScan, updateCloudAccountHealth, upsertWorkerHeartbeat, type DueCloudAccount } from './storage';

const DEFAULT_INTERVAL_MS = Number(process.env.DURTGUARDIAN_INTERVAL_MS ?? 5 * 60 * 1000);
// How long a cloud account can go unscanned before it's picked up again. Defaults to the tick
// interval itself - one deliberately simple cadence instead of separate 5min/1h schedules.
const STALE_MS = Number(process.env.DURTGUARDIAN_STALE_MS ?? DEFAULT_INTERVAL_MS);
const OUTPUT_FILENAME = 'durtguardian-scan';

async function runProwlerScan(provider: string, accountId: string, decryptedCredential: string): Promise<ScanSnapshot> {
  const outputDir = mkdtempSync(join(tmpdir(), 'durtguardian-'));
  const command = buildProwlerCommand({ provider, accountId, outputDirectory: outputDir, outputFilename: OUTPUT_FILENAME });
  const credentialEnvVars = credentialEnv(provider, decryptedCredential);
  try {
    const child = Bun.spawn({
      cmd: command,
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, ...credentialEnvVars },
    });

    const stderr = await new Response(child.stderr).text();
    const exitCode = await child.exited;

    // Prowler's own exit code 3 means "scan completed, some checks failed" - that's the whole
    // point of a CSPM scan (we WANT to see the failures), not an actual tool error. Only treat
    // other non-zero codes (auth failure, invalid args, crash) as a real scan failure.
    if (exitCode !== 0 && exitCode !== 3) {
      throw new Error(stderr || `prowler exited with code ${exitCode}`);
    }

    // Prowler only writes the output file when there's at least one finding (see
    // OCSF.transform/batch_write_data_to_file - `if not findings: return` and `and self._data`
    // both skip writing anything for a clean/empty scan) - a missing file here means zero
    // findings, not a failure, since we already threw above on a real non-zero/non-3 exit.
    const outputPath = join(outputDir, `${OUTPUT_FILENAME}.ocsf.json`);
    let raw = '[]';
    try {
      raw = readFileSync(outputPath, 'utf8');
    } catch (error) {
      if ((error as { code?: string }).code !== 'ENOENT') throw new Error(`unable to read Prowler output: ${String(error)}`);
    }
    try {
      return { provider, accountId, timestamp: new Date().toISOString(), findings: parseOcsfFindings(raw) };
    } catch (error) {
      throw new Error(`unable to parse Prowler output: ${String(error)}`);
    }
  } finally {
    cleanupCredentialEnv(credentialEnvVars);
    rmSync(outputDir, { recursive: true, force: true });
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
