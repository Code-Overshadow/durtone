import { expect, test } from 'bun:test';
import {
  buildProwlerCommand,
  compareWithBaseline,
  computeBaselineHash,
  summarizeFindings,
} from './cspm';

test('buildProwlerCommand includes provider and output format', () => {
  const command = buildProwlerCommand({ provider: 'aws', accountId: '123456789012' });

  expect(command[0]).toBe('prowler');
  expect(command[1]).toBe('aws');
  expect(command.includes('--output-formats')).toBe(true);
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
