// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadHostedConfig } from './config';
import { decryptState, encryptState } from './credentials';

describe('hosted credential protection', () => {
  it('authenticates ciphertext and binds it to one record', () => {
    const key = randomBytes(32);
    const value = { token: 'ghu_test_only' };
    const ciphertext = encryptState(value, key, 'auth:first');
    expect(decryptState(ciphertext, key, 'auth:first')).toEqual(value);
    expect(() => decryptState(ciphertext, key, 'auth:second')).toThrow();
    expect(() => decryptState(ciphertext, randomBytes(32), 'auth:first')).toThrow();
    const bytes = Buffer.from(ciphertext, 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptState(bytes.toString('base64'), key, 'auth:first')).toThrow();
  });

  it('requires explicit production credentials, HTTPS, and a shared store', () => {
    const env = {
      PUBLIC_ORIGIN: 'https://app.example.com',
      HOSTED_GITHUB_CLIENT_ID: 'test-client',
      HOSTED_GITHUB_CLIENT_SECRET: 'test-only-secret',
      HOSTED_SESSION_KEY: randomBytes(32).toString('base64'),
      HOSTED_STORAGE_ACCOUNT: 'testaccount',
    };
    expect(loadHostedConfig(env).development).toBe(false);
    expect(() => loadHostedConfig({ ...env, PUBLIC_ORIGIN: 'http://app.example.com' })).toThrow();
    expect(() => loadHostedConfig({ ...env, HOSTED_SESSION_KEY: 'short' })).toThrow();
    expect(() => loadHostedConfig({ ...env, HOSTED_STORAGE_ACCOUNT: '' })).toThrow();
    expect(() => loadHostedConfig({ ...env, HOSTED_DEVELOPMENT: 'true' })).toThrow();
    expect(loadHostedConfig({ ...env, HOSTED_DEVELOPMENT: 'true', PUBLIC_ORIGIN: 'http://127.0.0.1:3045' }).development).toBe(true);
  });
});
