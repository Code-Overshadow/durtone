import { beforeAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { decryptSecret, encryptSecret } from './crypto';

describe('credential encryption', () => {
  beforeAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString('base64');
  });

  test('round-trips a plaintext secret', () => {
    const plaintext = 'aws-secret-access-key-example';
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  test('produces different ciphertext for the same plaintext each time', () => {
    const plaintext = 'client-secret';
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  test('fails to decrypt with a tampered ciphertext', () => {
    const encrypted = encryptSecret('client-secret');
    const tampered = `${encrypted.slice(0, -4)}AAAA`;
    expect(() => decryptSecret(tampered)).toThrow();
  });

  test('throws when the encryption key is missing', () => {
    const original = process.env.CREDENTIAL_ENCRYPTION_KEY;
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encryptSecret('anything')).toThrow();
    process.env.CREDENTIAL_ENCRYPTION_KEY = original;
  });
});
