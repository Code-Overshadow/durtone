import { expect, test } from 'bun:test';
import { getWafConfig, updateWafConfig } from './config';

test('masks DurtScope credentials while preserving them across dashboard updates', () => {
  const saved = updateWafConfig({
    upstream: 'http://localhost:3001',
    mode: 'block',
    identityProvider: 'okta',
    identityBaseUrl: 'https://example.okta.com',
    identityClientSecret: 'okta-secret',
  });

  expect(saved.identityClientSecret).toBe('********');

  const updated = updateWafConfig({
    ...saved,
    upstream: 'http://localhost:3002',
  });
  expect(updated.identityClientSecret).toBe('********');
  expect(getWafConfig().upstream).toBe('http://localhost:3002');
});
