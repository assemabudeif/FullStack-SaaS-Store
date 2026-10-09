import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'development');
  vi.stubEnv('JWT_SECRET', 'configuration-test-random-placeholder-12345');
  vi.stubEnv('DATABASE_URL', '');
  vi.stubEnv('ENABLE_SANDBOX_BILLING', 'false');
  vi.stubEnv('PORT', '3000');
});
afterEach(() => vi.unstubAllEnvs());
describe('configuration safety', () => {
  it('rejects missing, short and example JWT secrets', () => {
    for (const value of ['', 'short', 'replace-with-a-random-secret-at-least-32-characters-long']) {
      vi.stubEnv('JWT_SECRET', value);
      expect(() => loadConfig()).toThrow('JWT_SECRET');
    }
  });
  it('requires PostgreSQL in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => loadConfig()).toThrow('DATABASE_URL');
  });
  it('rejects sandbox billing in production', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('DATABASE_URL', 'postgresql://localhost/store');
    vi.stubEnv('ENABLE_SANDBOX_BILLING', 'true');
    expect(() => loadConfig()).toThrow('Sandbox billing');
  });
  it('validates ports and environment names', () => {
    vi.stubEnv('PORT', '70000');
    expect(() => loadConfig()).toThrow('PORT');
    vi.stubEnv('PORT', '3000');
    vi.stubEnv('NODE_ENV', 'prod');
    expect(() => loadConfig()).toThrow('NODE_ENV');
  });
  it('parses explicit origins and safe development settings', () => {
    vi.stubEnv('CORS_ORIGINS', 'http://localhost:5173, http://localhost:3000,');
    const config = loadConfig();
    expect(config.corsOrigins).toEqual(['http://localhost:5173', 'http://localhost:3000']);
    expect(config.databaseUrl).toBeUndefined();
    expect(config.sandboxBilling).toBe(false);
  });
});
