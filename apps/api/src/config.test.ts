import { expect, test } from 'bun:test';
import { getWafConfig, updateWafConfig } from './config';

test('updates and persists the WAF upstream/mode/webhook config', () => {
  const saved = updateWafConfig({
    upstream: 'http://localhost:3001',
    mode: 'block',
    alertWebhookUrl: 'https://hooks.example.com/alerts',
  });

  expect(saved.upstream).toBe('http://localhost:3001');
  expect(saved.mode).toBe('block');

  updateWafConfig({ upstream: 'http://localhost:3002', mode: 'monitor' });
  expect(getWafConfig().upstream).toBe('http://localhost:3002');
  expect(getWafConfig().mode).toBe('monitor');
});
