import { describe, expect, test } from 'bun:test';
import { ingestLogs, listEndpoints, replaceOpenApi } from './discovery';

describe('DurtShield discovery', () => {
  test('aggregates logs and identifies shadow APIs', () => {
    replaceOpenApi({ paths: { '/users/{id}': { get: {} } } });
    ingestLogs([
      { method: 'GET', path: '/users/42?verbose=true', status: 200 },
      { method: 'GET', path: '/users/42', status: 404 },
      { method: 'POST', path: '/internal/debug', status: 200 },
    ]);

    const endpoints = listEndpoints();
    const users = endpoints.find((endpoint) => endpoint.path === '/users/42');
    const shadow = endpoints.find((endpoint) => endpoint.path === '/internal/debug');
    expect(users).toMatchObject({ count: 2, documented: true, shadow: false, statusCodes: { '200': 1, '404': 1 } });
    expect(shadow).toMatchObject({ documented: false, shadow: true });
  });
});