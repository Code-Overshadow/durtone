import { afterEach, expect, test } from 'bun:test';
import { collectProviderIdentities, listGoogleWorkspaceIdentities, listOktaIdentities, revokeIdentity, type IdentityProviderConfig } from './providers';

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
  expect(identities[0]).toMatchObject({ provider: 'okta', name: 'alice@example.com', status: 'active', ipAddresses: [] });
  expect(identities[1]?.status).toBe('suspended');
});

test('normalizes Google Workspace admins and suspended users', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ users: [
    { id: 'google-1', primaryEmail: 'admin@example.com', isAdmin: true, lastLoginTime: '2026-08-18T00:00:00.000Z' },
    { id: 'google-2', primaryEmail: 'former@example.com', suspended: true },
  ] }), { status: 200 })) as unknown as typeof fetch;

  const identities = await listGoogleWorkspaceIdentities({ accessToken: 'test-token', customer: 'my_customer' });
  expect(identities[0]).toMatchObject({ type: 'service-account', permissions: ['admin'], ipAddresses: [] });
  expect(identities[1]?.status).toBe('suspended');
});

test('collectProviderIdentities enriches Keycloak users with session IPs', async () => {
  const config: IdentityProviderConfig = { provider: 'keycloak', baseUrl: 'https://kc.example.com', realm: 'durtone', clientId: 'scope', clientSecret: 'secret' };

  globalThis.fetch = (async (url: string | URL) => {
    const href = url.toString();
    if (href.includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 60, token_type: 'Bearer' }), { status: 200 });
    }
    if (href.endsWith('/users')) {
      return new Response(JSON.stringify([{ id: 'u-1', username: 'alice', enabled: true, realmRoles: ['read-users'] }]), { status: 200 });
    }
    if (href.endsWith('/u-1/sessions')) {
      return new Response(JSON.stringify([{ id: 's-1', userId: 'u-1', ipAddress: '203.0.113.5' }]), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

  const identities = await collectProviderIdentities(config);
  expect(identities).toHaveLength(1);
  expect(identities[0]?.ipAddresses).toEqual(['203.0.113.5']);
});

test('collectProviderIdentities keeps going even if a session lookup fails', async () => {
  const config: IdentityProviderConfig = { provider: 'keycloak', baseUrl: 'https://kc.example.com', realm: 'durtone', clientId: 'scope', clientSecret: 'secret' };

  globalThis.fetch = (async (url: string | URL) => {
    const href = url.toString();
    if (href.includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 60, token_type: 'Bearer' }), { status: 200 });
    }
    if (href.endsWith('/users')) {
      return new Response(JSON.stringify([{ id: 'u-1', username: 'alice', enabled: true }]), { status: 200 });
    }
    return new Response('boom', { status: 500 });
  }) as unknown as typeof fetch;

  const identities = await collectProviderIdentities(config);
  expect(identities[0]?.ipAddresses).toEqual([]);
});

test('revokeIdentity deactivates an Okta user', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    return new Response('', { status: 200 });
  }) as unknown as typeof fetch;

  const result = await revokeIdentity({ provider: 'okta', baseUrl: 'https://example.okta.com', apiToken: 'token' }, { id: 'okta-1', name: 'alice' });
  expect(result).toEqual({ provider: 'okta', action: 'deactivated' });
  expect(calls[0]).toBe('POST https://example.okta.com/api/v1/users/okta-1/lifecycle/deactivate');
});

test('revokeIdentity disables and logs out a Keycloak user', async () => {
  const calls: string[] = [];
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const href = url.toString();
    calls.push(`${init?.method ?? 'GET'} ${href}`);
    if (href.includes('/protocol/openid-connect/token')) {
      return new Response(JSON.stringify({ access_token: 'token', expires_in: 60, token_type: 'Bearer' }), { status: 200 });
    }
    return new Response('', { status: 204 });
  }) as unknown as typeof fetch;

  const result = await revokeIdentity(
    { provider: 'keycloak', baseUrl: 'https://kc.example.com', realm: 'durtone', clientId: 'scope', clientSecret: 'secret' },
    { id: 'u-1', name: 'alice' },
  );
  expect(result).toEqual({ provider: 'keycloak', action: 'disabled and logged out' });
  expect(calls.some((call) => call.includes('/users/u-1/logout'))).toBe(true);
});
