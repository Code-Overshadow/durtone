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

const baselineDrifts: CspmDrift[] = [
  { kind: 'changed', resource: 'arn:aws:s3:::durtone-prod-assets', before: 'FAIL', after: 'PASS' },
  { kind: 'new', resource: 'arn:aws:ec2:us-east-1:123456789012:instance/i-0a11223344', after: 'FAIL' },
  { kind: 'missing', resource: 'arn:aws:iam::123456789012:role/legacy-admin', before: 'FAIL' },
];

export function getCspmSummary(): CspmSummary {
  return {
    provider: 'aws',
    accountId: '123456789012',
    postureScore: 82,
    totalChecks: 34,
    passChecks: 27,
    failChecks: 5,
    criticalFindings: 2,
    driftCount: baselineDrifts.length,
    lastScanAt: new Date().toISOString(),
    drifts: baselineDrifts,
  };
}
