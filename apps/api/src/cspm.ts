export type CspmDrift = {
  kind: 'changed' | 'new' | 'missing';
  resource: string;
  before?: string;
  after?: string;
};

export type CspmSummary = {
  provider: string;
  accountId: string;
  postureScore: number;
  totalChecks: number;
  passChecks: number;
  failChecks: number;
  criticalFindings: number;
  driftCount: number;
  lastScanAt: string;
  drifts: CspmDrift[];
};

/** No cloud account has been scanned yet for this tenant - nothing known to have failed, same
 * "healthy until proven otherwise" default the waf/itdr pillars use in calculateSecurityScore. */
export function getCspmSummary(): CspmSummary {
  return {
    provider: '',
    accountId: '',
    postureScore: 100,
    totalChecks: 0,
    passChecks: 0,
    failChecks: 0,
    criticalFindings: 0,
    driftCount: 0,
    lastScanAt: '',
    drifts: [],
  };
}
