import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { checkCertificate, deleteCertificate, FlyRateLimitError, requestCertificate } from './flyCerts';

const originalFetch = globalThis.fetch;
const originalToken = process.env.FLY_API_TOKEN;
const originalApp = process.env.FLY_APP_NAME;

beforeEach(() => {
  process.env.FLY_API_TOKEN = 'test-token';
  process.env.FLY_APP_NAME = 'durtone-edge';
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  process.env.FLY_API_TOKEN = originalToken;
  process.env.FLY_APP_NAME = originalApp;
});

test('requestCertificate posts to /acme with the hostname and auth header', async () => {
  let capturedUrl = '';
  let capturedInit: RequestInit | undefined;
  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    capturedUrl = url.toString();
    capturedInit = init;
    return new Response(JSON.stringify({ certificate: { configured: false } }), { status: 200 });
  }) as unknown as typeof fetch;

  const result = await requestCertificate('app.example.com');
  expect(capturedUrl).toBe('https://api.machines.dev/v1/apps/durtone-edge/certificates/acme');
  expect(capturedInit?.method).toBe('POST');
  expect((capturedInit?.headers as Record<string, string>).Authorization).toBe('Bearer test-token');
  expect(JSON.parse(capturedInit?.body as string)).toEqual({ hostname: 'app.example.com' });
  expect(result).toEqual({ hostname: 'app.example.com', ready: false, awaitingDns: true, raw: { certificate: { configured: false } } });
});

test('checkCertificate reports ready when the certificate has issued', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ certificate: { configured: true, issued: true } }), { status: 200 })) as unknown as typeof fetch;

  const result = await checkCertificate('app.example.com');
  expect(result.ready).toBe(true);
  expect(result.awaitingDns).toBe(false);
});

test('checkCertificate reports awaitingDns when nothing is configured yet', async () => {
  globalThis.fetch = (async () => new Response(JSON.stringify({ certificate: {} }), { status: 200 })) as unknown as typeof fetch;

  const result = await checkCertificate('app.example.com');
  expect(result.ready).toBe(false);
  expect(result.awaitingDns).toBe(true);
});

test('throws FlyRateLimitError on a 429 response', async () => {
  globalThis.fetch = (async () => new Response('', { status: 429, headers: { 'retry-after': '30' } })) as unknown as typeof fetch;

  await expect(checkCertificate('app.example.com')).rejects.toThrow(FlyRateLimitError);
  try {
    await checkCertificate('app.example.com');
  } catch (error) {
    expect((error as FlyRateLimitError).retryAfterSeconds).toBe(30);
  }
});

test('throws a descriptive error on a non-2xx, non-429 response', async () => {
  globalThis.fetch = (async () => new Response('bad request', { status: 400 })) as unknown as typeof fetch;
  await expect(checkCertificate('app.example.com')).rejects.toThrow(/400/);
});

test('deleteCertificate sends a DELETE request', async () => {
  let capturedMethod = '';
  globalThis.fetch = (async (_url: string | URL, init?: RequestInit) => {
    capturedMethod = init?.method ?? '';
    return new Response(null, { status: 204 });
  }) as unknown as typeof fetch;

  await deleteCertificate('app.example.com');
  expect(capturedMethod).toBe('DELETE');
});

test('throws when FLY_API_TOKEN/FLY_APP_NAME are not configured', async () => {
  delete process.env.FLY_API_TOKEN;
  await expect(requestCertificate('app.example.com')).rejects.toThrow(/not configured/);
});
