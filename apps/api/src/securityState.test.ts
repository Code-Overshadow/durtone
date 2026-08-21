import { describe, expect, test } from 'bun:test';
import { getIdentityHygiene, listSecurityIdentities, replaceSecurityIdentities, resetSecurityIdentities } from './securityState';

describe('securityState tenant isolation', () => {
  test('identities replaced for one tenant do not leak into another tenant', () => {
    resetSecurityIdentities('tenant-a');
    resetSecurityIdentities('tenant-b');

    replaceSecurityIdentities('tenant-a', [
      { id: 'a1', name: 'Alice', status: 'active', permissions: [] },
    ]);
    replaceSecurityIdentities('tenant-b', [
      { id: 'b1', name: 'Bob', status: 'active', permissions: [] },
      { id: 'b2', name: 'Carol', status: 'suspended', permissions: [] },
    ]);

    expect(listSecurityIdentities('tenant-a')).toEqual([
      { id: 'a1', name: 'Alice', status: 'active', permissions: [] },
    ]);
    expect(listSecurityIdentities('tenant-b')).toHaveLength(2);
    expect(listSecurityIdentities('unknown-tenant')).toEqual([]);
  });

  test('identity hygiene is computed per tenant, not globally', () => {
    resetSecurityIdentities('tenant-x');
    resetSecurityIdentities('tenant-y');

    replaceSecurityIdentities('tenant-x', [
      { id: 'x1', name: 'High risk', status: 'active', permissions: [], riskScore: 90 },
    ]);
    replaceSecurityIdentities('tenant-y', [
      { id: 'y1', name: 'Low risk', status: 'active', permissions: [], riskScore: 10 },
    ]);

    expect(getIdentityHygiene('tenant-x')).toEqual({ totalIdentities: 1, highRiskIdentities: 1, staleIdentities: 0 });
    expect(getIdentityHygiene('tenant-y')).toEqual({ totalIdentities: 1, highRiskIdentities: 0, staleIdentities: 0 });
  });
});
