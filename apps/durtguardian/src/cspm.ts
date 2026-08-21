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
  const command = ['prowler', provider, '--account-id', accountId, '--output-formats', 'json'];

  if (options.mode === 'baseline') {
    command.push('--quiet');
  }

  return command;
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
