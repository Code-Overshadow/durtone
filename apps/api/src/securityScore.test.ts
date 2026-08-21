import { expect, test } from 'bun:test';
import { correlateGuardianChange, correlateWafAttack } from './correlation';
import { resetEventBus, publishEvent, onEvent } from './eventBus';
import { buildExecutiveReport } from './report';
import { calculateSecurityScore } from './securityScore';

test('calculates the weighted unified security score', () => {
  const score = calculateSecurityScore({
    waf: { totalRequests: 100, blockedRequests: 80 },
    cspm: { postureScore: 70 },
    itdr: { totalIdentities: 10, highRiskIdentities: 1, staleIdentities: 1 },
  });

  expect(score.components).toEqual({ waf: 80, cspm: 70, itdr: 80 });
  expect(score.score).toBe(77);
});

test('correlates blocked WAF traffic and Guardian changes to identities', () => {
  const identities = [{ id: 'svc-1', name: 'deploy', status: 'active' as const, permissions: ['iam:write'], ipAddresses: ['10.0.0.8'] }];
  expect(correlateWafAttack({ remoteIp: '10.0.0.8', blocked: true }, identities).action).toBe('revoke-active-matches');
  expect(correlateGuardianChange({ resource: 'role/admin', kind: 'changed', requiredPermission: 'iam:write' }, identities).action).toBe('audit-identity');
});

test('publishes locally and generates a readable PDF', async () => {
  resetEventBus();
  const received: string[] = [];
  onEvent('itdr.snapshot', (event) => { received.push(event.type); });
  await publishEvent({ type: 'itdr.snapshot', payload: { totalIdentities: 1 } });
  const pdf = await buildExecutiveReport(calculateSecurityScore({ waf: { totalRequests: 0, blockedRequests: 0 }, cspm: { postureScore: 100 }, itdr: { totalIdentities: 0, highRiskIdentities: 0, staleIdentities: 0 } }));

  expect(received).toEqual(['itdr.snapshot']);
  expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe('%PDF-');
});
