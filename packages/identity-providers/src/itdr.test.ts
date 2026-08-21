import { expect, test } from 'bun:test';
import { buildIdentityRisk, findStaleIdentities, normalizeKeycloakUsers, summarizeIdentities, type IdentityRecord } from './itdr';

test('risk scoring increases with stale tokens and broad permissions', () => {
  const identity: IdentityRecord = {
    id: 'svc-1',
    type: 'service-account',
    provider: 'keycloak',
    name: 'payments-worker',
    status: 'active',
    permissions: ['read:users', 'write:users', 'manage:clients'],
    ipAddresses: [],
    lastSeen: '2024-01-01T00:00:00.000Z',
  };

  const score = buildIdentityRisk(identity);
  expect(score).toBeGreaterThan(60);
});

test('summary groups identities by provider and risk band', () => {
  const identities: IdentityRecord[] = [
    { id: 'u-1', type: 'human', provider: 'keycloak', name: 'alice', status: 'active', permissions: ['read:users'], ipAddresses: [], lastSeen: '2026-06-01T00:00:00.000Z' },
    { id: 'svc-1', type: 'service-account', provider: 'aws', name: 'payments-worker', status: 'active', permissions: ['read:all', 'write:all'], ipAddresses: [], lastSeen: '2025-01-01T00:00:00.000Z' },
    { id: 'bot-1', type: 'bot', provider: 'okta', name: 'deploy-bot', status: 'suspended', permissions: ['deploy'], ipAddresses: [], lastSeen: '2026-07-01T00:00:00.000Z' },
  ];

  const summary = summarizeIdentities(identities);
  expect(summary.total).toBe(3);
  expect(summary.byProvider.keycloak).toBe(1);
  expect(summary.byRisk.high).toBeGreaterThanOrEqual(1);
});

test('stale identities and Keycloak normalization are detected correctly', () => {
  const rawUsers = [
    {
      id: 'u-1',
      username: 'alice',
      enabled: true,
      lastSeen: '2024-01-01T00:00:00.000Z',
      roles: ['realm-admin'],
      clientRoles: ['manage-clients'],
    },
    {
      id: 'u-2',
      username: 'bob',
      enabled: true,
      lastSeen: '2026-07-01T00:00:00.000Z',
      roles: ['read-users'],
      clientRoles: [],
    },
  ];

  const identities = normalizeKeycloakUsers(rawUsers);
  const stale = findStaleIdentities(identities, 30);

  expect(identities).toHaveLength(2);
  expect(stale[0]?.id).toBe('u-1');
  expect(buildIdentityRisk(identities[0])).toBeGreaterThan(60);
});

test('normalizeKeycloakUsers carries through session ip addresses', () => {
  const identities = normalizeKeycloakUsers([
    { id: 'u-1', username: 'alice', enabled: true, ipAddresses: ['203.0.113.5', '203.0.113.5', '198.51.100.9'] },
  ]);

  expect(identities[0]?.ipAddresses).toEqual(['203.0.113.5', '203.0.113.5', '198.51.100.9']);
});
