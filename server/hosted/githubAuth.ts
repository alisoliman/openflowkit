import { z } from 'zod';
import { CopilotRequestError } from '../../src/services/copilot/protocol';
import type { HostedConfig } from './config';

const tokenSchema = z.object({
  access_token: z.string().startsWith('ghu_').max(4096),
  refresh_token: z.string().startsWith('ghr_').max(4096),
  expires_in: z.number().int().positive().max(86_400),
  refresh_token_expires_in: z.number().int().positive().max(366 * 86_400),
});
const userSchema = z.object({
  id: z.number().int().positive(),
  login: z.string().min(1).max(100),
});

export interface GitHubTokens {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: number;
  refreshExpiresAt: number;
}

export interface GitHubAuth {
  exchange(code: string, verifier: string): Promise<GitHubTokens>;
  refresh(refreshToken: string): Promise<GitHubTokens>;
  user(accessToken: string): Promise<{ id: string; login: string }>;
}

export function createGitHubAuth(config: HostedConfig, fetcher: typeof fetch = fetch): GitHubAuth {
  async function tokenRequest(parameters: Record<string, string>): Promise<GitHubTokens> {
    const response = await fetcher('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: config.clientId, client_secret: config.clientSecret, ...parameters }),
      signal: AbortSignal.timeout(10_000),
      redirect: 'error',
    });
    if (response.status >= 500 || response.status === 429) {
      throw new CopilotRequestError('runtime_unavailable', 'GitHub sign-in is temporarily unavailable. Please try again.');
    }
    const parsed = tokenSchema.safeParse(await response.json());
    if (!response.ok || !parsed.success) {
      throw new CopilotRequestError('not_authenticated', 'GitHub authorization expired or was declined. Connect GitHub again.', 401);
    }
    return {
      accessToken: parsed.data.access_token,
      refreshToken: parsed.data.refresh_token,
      accessExpiresAt: Date.now() + parsed.data.expires_in * 1000,
      refreshExpiresAt: Date.now() + parsed.data.refresh_token_expires_in * 1000,
    };
  }

  return {
    exchange: (code, verifier) => tokenRequest({
      code, code_verifier: verifier, redirect_uri: `${config.origin}/api/copilot/auth/callback`,
    }),
    refresh: (refreshToken) => tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    async user(accessToken) {
      const response = await fetcher('https://api.github.com/user', {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${accessToken}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      if (response.status === 401 || response.status === 403) {
        throw new CopilotRequestError('not_authenticated', 'GitHub authorization is unavailable. Connect GitHub again.', 401);
      }
      if (!response.ok) {
        throw new CopilotRequestError('runtime_unavailable', 'GitHub sign-in is temporarily unavailable. Please try again.');
      }
      const parsed = userSchema.safeParse(await response.json());
      if (!parsed.success) throw new CopilotRequestError('bad_response', 'GitHub returned an invalid account response.', 502);
      return { id: String(parsed.data.id), login: parsed.data.login };
    },
  };
}
