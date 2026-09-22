// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { HostedConfig } from './config';
import { createGitHubAuth } from './githubAuth';

const config: HostedConfig = {
  origin: 'https://app.example.com', clientId: 'test-client', clientSecret: 'test-secret',
  encryptionKey: randomBytes(32), development: false, port: 3045,
};

describe('GitHub App OAuth transport', () => {
  it('exchanges PKCE codes and refreshes expiring user tokens server-side', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({
      access_token: 'ghu_test_only', refresh_token: 'ghr_test_only', expires_in: 28800, refresh_token_expires_in: 15897600,
    }), { headers: { 'Content-Type': 'application/json' } }));
    const github = createGitHubAuth(config, fetcher);
    expect(await github.exchange('code', 'verifier')).toMatchObject({ accessToken: 'ghu_test_only' });
    const exchange = JSON.parse(String(fetcher.mock.calls[0][1]?.body));
    expect(exchange).toMatchObject({ client_id: 'test-client', code: 'code', code_verifier: 'verifier', redirect_uri: `${config.origin}/api/copilot/auth/callback` });
    await github.refresh('ghr_old_test_only');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'ghr_old_test_only' });
  });

  it('rejects non-expiring, installation, and malformed tokens rather than falling back to a server identity', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ access_token: 'ghs_installation' })));
    await expect(createGitHubAuth(config, fetcher).exchange('code', 'verifier')).rejects.toMatchObject({ code: 'not_authenticated' });
  });
});
