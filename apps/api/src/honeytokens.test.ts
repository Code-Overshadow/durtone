import { describe, expect, test } from 'bun:test';
import { listHoneytokenCallbacks, recordHoneytokenCallback } from './honeytokens';

describe('honeytoken callbacks', () => {
  test('records a valid callback and rejects malformed data', () => {
    const event = recordHoneytokenCallback({ token: 'durtone-test', source: 'integration-test' });
    expect(event).toMatchObject({ token: 'durtone-test', source: 'integration-test' });
    const latest = listHoneytokenCallbacks()[0];
    expect(latest).toBeDefined();
    expect(latest?.token).toBe('durtone-test');
  });
});