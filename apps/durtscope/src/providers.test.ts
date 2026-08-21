import { afterEach, expect, test } from 'bun:test';
import { listGoogleWorkspaceIdentities, listOktaIdentities } from './providers';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('normalizes Okta users into the shared identity inventory', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify([
    { id: 'okta-1', status: 'ACTIVE', lastLogin: '2026-08-19T00:00:00.000Z', profile: { login: 'alice@example.com' } },
    { id: 'okta-2', status: 'SUSPENDED', profile: { displayName: 'old-bot' } },
  ]), { status: 200 })) as unknown as typeof fetch;

  const identities = await listOktaIdentities({ baseUrl: 'https://example.okta.com', apiToken: 'test-token' });
  expect(identities).toHaveLength(2);
  expect(identities[0]).toMatchObject({ provider: 'okta', name: 'alice@example.com', status: 'active' });
  expect(identities[1]?.status).toBe('suspended');
});

test('normalizes Google Workspace admins and suspended users', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ users: [
    { id: 'google-1', primaryEmail: 'admin@example.com', isAdmin: true, lastLoginTime: '2026-08-18T00:00:00.000Z' },
    { id: 'google-2', primaryEmail: 'former@example.com', suspended: true },
  ] }), { status: 200 })) as unknown as typeof fetch;

  const identities = await listGoogleWorkspaceIdentities({ accessToken: 'test-token', customer: 'my_customer' });
  expect(identities[0]).toMatchObject({ type: 'service-account', permissions: ['admin'] });
  expect(identities[1]?.status).toBe('suspended');
});
