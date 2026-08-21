import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildProwlerCommand, compareWithBaseline, computeBaselineHash, summarizeFindings, type ScanSnapshot } from './cspm';

const CONFIG_PATH = process.env.DURTGUARDIAN_CONFIG ?? join(process.cwd(), 'durtguardian.json');
const DEFAULT_INTERVAL_MS = Number(process.env.DURTGUARDIAN_INTERVAL_MS ?? 5 * 60 * 1000);

type GuardianConfig = {
  provider: string;
  accountId: string;
  intervalMs?: number;
  baselinePath?: string;
  outputPath?: string;
  controlPlaneUrl?: string;
  controlPlaneToken?: string;
};

function readConfig(path: string): GuardianConfig {
  if (!existsSync(path)) {
    return {
      provider: process.env.DURTGUARDIAN_PROVIDER ?? 'aws',
      accountId: process.env.DURTGUARDIAN_ACCOUNT_ID ?? 'default',
      intervalMs: DEFAULT_INTERVAL_MS,
      baselinePath: process.env.DURTGUARDIAN_BASELINE_PATH ?? join(process.cwd(), 'baseline.json'),
      outputPath: process.env.DURTGUARDIAN_OUTPUT_PATH ?? join(process.cwd(), 'latest-scan.json'),
      controlPlaneUrl: process.env.DURTGUARDIAN_CONTROL_PLANE_URL,
      controlPlaneToken: process.env.DURTGUARDIAN_CONTROL_PLANE_TOKEN,
    };
  }

  const raw = readFileSync(path, 'utf8');
  return JSON.parse(raw) as GuardianConfig;
}

async function publishScan(config: GuardianConfig, snapshot: ScanSnapshot, drifts: Array<{ kind: 'changed' | 'new' | 'missing'; resource: string; before?: string; after?: string }>) {
  if (!config.controlPlaneUrl) return;
  const response = await fetch(`${config.controlPlaneUrl.replace(/\/$/, '')}/api/v1/cspm/scans`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.controlPlaneToken ? { Authorization: `Bearer ${config.controlPlaneToken}` } : {}) },
    body: JSON.stringify({ ...snapshot, baselineHash: computeBaselineHash(snapshot), drifts }),
  });
  if (!response.ok) throw new Error(`Control Plane scan upload failed: ${response.status} ${await response.text()}`);
}

function parseProwlerJson(raw: string): ScanSnapshot {
  const parsed = JSON.parse(raw);
  const findings = Array.isArray(parsed) ? parsed : Array.isArray(parsed.findings) ? parsed.findings : [];

  return {
    provider: process.env.DURTGUARDIAN_PROVIDER ?? 'aws',
    accountId: process.env.DURTGUARDIAN_ACCOUNT_ID ?? 'default',
    timestamp: new Date().toISOString(),
    findings,
  };
}

async function runProwlerScan(provider: string, accountId: string): Promise<ScanSnapshot> {
  const command = buildProwlerCommand({ provider, accountId, mode: 'baseline' });
  const child = Bun.spawn({
    cmd: command,
    stdout: 'pipe',
    stderr: 'pipe',
  });

  const stdout = await new Response(child.stdout).text();
  const stderr = await new Response(child.stderr).text();
  const exitCode = await child.exited;

  if (exitCode !== 0) {
    throw new Error(stderr || `prowler exited with code ${exitCode}`);
  }

  try {
    return parseProwlerJson(stdout);
  } catch (error) {
    throw new Error(`unable to parse Prowler output: ${String(error)}`);
  }
}

async function runCycle() {
  const config = readConfig(CONFIG_PATH);
  const snapshot = await runProwlerScan(config.provider, config.accountId);
  const summary = summarizeFindings(snapshot.findings);
  let drifts: Array<{ kind: 'changed' | 'new' | 'missing'; resource: string; before?: string; after?: string }> = [];

  if (config.baselinePath && existsSync(config.baselinePath)) {
    const previous = JSON.parse(readFileSync(config.baselinePath, 'utf8')) as ScanSnapshot;
    drifts = compareWithBaseline(previous, snapshot);
    console.log(JSON.stringify({
      status: 'drift-check',
      provider: snapshot.provider,
      accountId: snapshot.accountId,
      summary,
      driftCount: drifts.length,
      drifts,
    }));
  }

  await publishScan(config, snapshot, drifts);

  writeFileSync(config.outputPath ?? join(process.cwd(), 'latest-scan.json'), JSON.stringify(snapshot, null, 2));
  writeFileSync(config.baselinePath ?? join(process.cwd(), 'baseline.json'), JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({
    status: 'scan-complete',
    provider: snapshot.provider,
    accountId: snapshot.accountId,
    baselineHash: computeBaselineHash(snapshot),
    summary,
  }));
}

if (import.meta.main) {
  const config = readConfig(CONFIG_PATH);
  console.log(`DurtGuardian active for ${config.provider}/${config.accountId}`);
  void runCycle();

  setInterval(() => {
    void runCycle();
  }, config.intervalMs ?? DEFAULT_INTERVAL_MS);
}
