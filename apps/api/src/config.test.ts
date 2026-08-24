import { expect, test } from 'bun:test';
import { configSchema, DEFAULT_WAF_CONFIG } from './config';

test('configSchema validates and normalizes a WAF config payload', () => {
  const parsed = configSchema.parse({
    upstream: 'http://localhost:3001',
    mode: 'block',
    alertWebhookUrl: 'https://hooks.example.com/alerts',
  });

  expect(parsed.upstream).toBe('http://localhost:3001');
  expect(parsed.mode).toBe('block');
  expect(parsed.alertWebhookUrl).toBe('https://hooks.example.com/alerts');
});

test('configSchema rejects an invalid payload', () => {
  expect(() => configSchema.parse({ upstream: 'not-a-url', mode: 'block' })).toThrow();
  expect(() => configSchema.parse({ upstream: 'http://localhost:3001', mode: 'bogus' })).toThrow();
});

test('DEFAULT_WAF_CONFIG is a fresh unconfigured state, not shared mutable state', () => {
  expect(DEFAULT_WAF_CONFIG).toEqual({ upstream: '', mode: 'monitor', alertWebhookUrl: '' });
});
