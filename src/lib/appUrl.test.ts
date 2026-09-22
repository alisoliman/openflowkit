import { afterEach, describe, expect, it, vi } from 'vitest';
import { getAppUrl } from './appUrl';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('getAppUrl', () => {
  it.each([
    'https://example.azurestaticapps.net',
    'https://diagrams.example.com',
    'http://localhost:4173',
  ])('automatically uses the hosting origin %s', (origin) => {
    vi.stubEnv('VITE_APP_URL', undefined);
    vi.stubGlobal('window', { location: { origin } });

    expect(getAppUrl()).toBe(origin);
  });

  it.each(['', '   '])('uses the hosting origin when the override is empty (%j)', (value) => {
    vi.stubEnv('VITE_APP_URL', value);

    expect(getAppUrl()).toBe(window.location.origin);
  });

  it('prefers the deployment override and normalizes whitespace and trailing slashes', () => {
    vi.stubEnv('VITE_APP_URL', '  https://diagrams.example.com/openflowkit///  ');

    expect(getAppUrl()).toBe('https://diagrams.example.com/openflowkit');
  });
});
