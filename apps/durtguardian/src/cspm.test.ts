import { expect, test } from 'bun:test';
import {
  buildProwlerCommand,
  compareWithBaseline,
  computeBaselineHash,
  credentialEnv,
  parseOcsfFindings,
  summarizeFindings,
} from './cspm';

test('buildProwlerCommand includes provider and the json-ocsf output mode', () => {
  // AWS has no account/id flag at all in Prowler 5.x - the account comes from whichever
  // credentials are in the environment (resolved via STS), confirmed against the installed
  // CLI's own --help.
  const command = buildProwlerCommand({ provider: 'aws', accountId: '123456789012', outputDirectory: '/tmp/scan', outputFilename: 'out' });

  expect(command).toEqual(['prowler', 'aws', '--output-formats', 'json-ocsf', '--output-filename', 'out', '--output-directory', '/tmp/scan', '--only-logs']);
  // Prowler 5.x dropped the plain "json" mode - only json-ocsf/json-asff/csv/html/sarif remain,
  // and none of them write to stdout, only to a file (--output-directory/--output-filename).
  expect(command.includes('--quiet')).toBe(false);
});

test('buildProwlerCommand maps Azure and GCP to their own account flags', () => {
  const azure = buildProwlerCommand({ provider: 'azure', accountId: 'sub-123', outputDirectory: '/tmp/scan', outputFilename: 'out' });
  expect(azure).toEqual(['prowler', 'azure', '--sp-env-auth', '--subscription-id', 'sub-123', '--output-formats', 'json-ocsf', '--output-filename', 'out', '--output-directory', '/tmp/scan', '--only-logs']);

  const gcp = buildProwlerCommand({ provider: 'gcp', accountId: 'project-123', outputDirectory: '/tmp/scan', outputFilename: 'out' });
  expect(gcp).toEqual(['prowler', 'gcp', '--project-id', 'project-123', '--output-formats', 'json-ocsf', '--output-filename', 'out', '--output-directory', '/tmp/scan', '--only-logs']);
});

test('parseOcsfFindings maps the OCSF detection-finding shape to our flat ProwlerFinding', () => {
  const ocsf = JSON.stringify([
    {
      status_code: 'FAIL',
      severity: 'High',
      resources: [{ uid: 'arn:aws:s3:::bucket-a' }],
      metadata: { event_code: 'check-1' },
    },
    {
      status_code: 'PASS',
      severity: 'Low',
      resources: [{ name: 'i-123' }],
      finding_info: { uid: 'check-2' },
    },
  ]);

  const findings = parseOcsfFindings(ocsf);
  expect(findings).toEqual([
    { id: 'check-1', resource: 'arn:aws:s3:::bucket-a', status: 'FAIL', severity: 'High' },
    { id: 'check-2', resource: 'i-123', status: 'PASS', severity: 'Low' },
  ]);
});

test('parseOcsfFindings returns an empty list for a non-array payload', () => {
  expect(parseOcsfFindings('{}')).toEqual([]);
  expect(parseOcsfFindings('[]')).toEqual([]);
});

test('credentialEnv maps decrypted credentials to provider-specific env vars', () => {
  const aws = credentialEnv('aws', JSON.stringify({ accessKeyId: 'AKIA...', secretAccessKey: 'secret', sessionToken: 'token' }));
  expect(aws).toEqual({ AWS_ACCESS_KEY_ID: 'AKIA...', AWS_SECRET_ACCESS_KEY: 'secret', AWS_SESSION_TOKEN: 'token' });

  const azure = credentialEnv('azure', JSON.stringify({ clientId: 'id', clientSecret: 'secret', tenantId: 'tenant' }));
  expect(azure).toEqual({ AZURE_CLIENT_ID: 'id', AZURE_CLIENT_SECRET: 'secret', AZURE_TENANT_ID: 'tenant' });

  expect(credentialEnv('aws', 'not-json')).toEqual({});
});

test('baseline hash is stable for equivalent findings', () => {
  const findings = [
    { id: 'check-1', resource: 'arn:aws:s3:::bucket-a', status: 'FAIL', severity: 'high' },
    { id: 'check-2', resource: 'arn:aws:ec2:us-east-1:123456789012:instance/i-123', status: 'PASS', severity: 'low' },
  ];

  const hashA = computeBaselineHash({ provider: 'aws', accountId: '123456789012', findings, timestamp: '2026-01-01T00:00:00Z' });
  const hashB = computeBaselineHash({ provider: 'aws', accountId: '123456789012', findings: [...findings].reverse(), timestamp: '2026-01-01T00:05:00Z' });

  expect(hashA).toBe(hashB);
});

test('drift detection surfaces changed and missing findings', () => {
  const previous = {
    provider: 'aws',
    accountId: '123456789012',
    timestamp: '2026-01-01T00:00:00Z',
    findings: [
      { id: 'check-1', resource: 'arn:aws:s3:::bucket-a', status: 'FAIL', severity: 'high' },
      { id: 'check-2', resource: 'arn:aws:ec2:us-east-1:123456789012:instance/i-123', status: 'PASS', severity: 'low' },
    ],
  };

  const current = {
    provider: 'aws',
    accountId: '123456789012',
    timestamp: '2026-01-01T00:10:00Z',
    findings: [
      { id: 'check-1', resource: 'arn:aws:s3:::bucket-a', status: 'PASS', severity: 'medium' },
      { id: 'check-3', resource: 'arn:aws:iam::123456789012:user/admin', status: 'FAIL', severity: 'critical' },
    ],
  };

  const drifts = compareWithBaseline(previous, current);

  expect(summarizeFindings(current.findings).total).toBe(2);
  expect(drifts.some((entry) => entry.resource === 'arn:aws:s3:::bucket-a')).toBe(true);
  expect(drifts.some((entry) => entry.kind === 'new')).toBe(true);
});
