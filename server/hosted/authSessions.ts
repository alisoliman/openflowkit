import { createHash, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { CopilotRequestError } from '../../src/services/copilot/protocol';
import { OAUTH_LIFETIME_MS, SESSION_LIFETIME_MS, type HostedConfig } from './config';
import { decryptState, encryptState, opaqueId, stateKey } from './credentials';
import type { GitHubAuth } from './githubAuth';
import { acquireLease } from './leases';
import type { StateRecord, StateStore } from './stateStore';

const sessionSchema = z.object({
  userId: z.string().regex(/^\d+$/),
  login: z.string().min(1).max(100),
  accessToken: z.string().startsWith('ghu_').max(4096),
  refreshToken: z.string().startsWith('ghr_').max(4096),
  accessExpiresAt: z.number(),
  refreshExpiresAt: z.number(),
  expiresAt: z.number(),
});
const flowSchema = z.object({ verifier: z.string(), returnTo: z.string(), expiresAt: z.number() });
const ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
// Access tokens are renewed this long before they expire. An agent session asks for a new token once its own
// is within the hour and refuses one that is not good for longer, so agent tokens are renewed further ahead.
const REFRESH_MARGIN_MS = 240_000;
const AGENT_REFRESH_MARGIN_MS = 90 * 60_000;
type AuthSession = z.infer<typeof sessionSchema>;

export interface HostedIdentity {
  userId: string;
  login: string;
  token: string;
  sessionKey: string;
  /** Agent sockets only, since a turn can outlast its token. Resolves to undefined once the GitHub connection has ended. */
  renewToken?: () => Promise<{ token: string; expiresAt: number } | undefined>;
}

export function appendCookie(response: ServerResponse, cookie: string): void {
  const previous = response.getHeader('Set-Cookie');
  const cookies = typeof previous === 'string' ? [previous] : Array.isArray(previous) ? previous.map(String) : [];
  response.setHeader('Set-Cookie', [...cookies, cookie]);
}

function readCookie(request: IncomingMessage, name: string): string | undefined {
  const values = (request.headers.cookie ?? '').split(';')
    .map((part) => part.trim()).filter((part) => part.startsWith(`${name}=`));
  if (values.length > 1) throw new CopilotRequestError('invalid_request', 'Ambiguous sign-in cookie. Clear this site connection and try again.', 400);
  const value = values[0]?.slice(name.length + 1);
  if (value && !ID_PATTERN.test(value)) {
    throw new CopilotRequestError('not_authenticated', 'The sign-in cookie is invalid. Connect GitHub again.', 401);
  }
  return value;
}

export class AuthSessions {
  private readonly refreshing = new Map<string, Promise<AuthSession>>();
  readonly sessionCookie: string;
  readonly flowCookie: string;

  constructor(
    private readonly config: HostedConfig,
    private readonly store: StateStore,
    private readonly github: GitHubAuth,
  ) {
    const prefix = config.development ? 'ofk-dev-' : '__Host-ofk-';
    this.sessionCookie = `${prefix}session`;
    this.flowCookie = `${prefix}oauth`;
  }

  private cookie(name: string, value: string, lifetime: number): string {
    return `${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(lifetime / 1000)}${this.config.development ? '' : '; Secure'}`;
  }

  private sessionId(request: IncomingMessage, response?: ServerResponse): string | undefined {
    try { return readCookie(request, this.sessionCookie); }
    catch (error) {
      if (response) appendCookie(response, this.cookie(this.sessionCookie, '', 0));
      throw error;
    }
  }

  private safeReturnTo(value: string): string {
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\') || value.length > 2048) {
      throw new CopilotRequestError('invalid_request', 'The sign-in return address is invalid.', 400);
    }
    const url = new URL(value, this.config.origin);
    if (url.origin !== this.config.origin || url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      throw new CopilotRequestError('invalid_request', 'The sign-in return address is invalid.', 400);
    }
    return `${url.pathname}${url.search}${url.hash}`;
  }

  async start(returnTo: string, response: ServerResponse): Promise<string> {
    const safeReturnTo = this.safeReturnTo(returnTo);
    const state = opaqueId();
    const verifier = opaqueId();
    const key = stateKey(state);
    const expiresAt = Date.now() + OAUTH_LIFETIME_MS;
    const value = encryptState({ verifier, returnTo: safeReturnTo, expiresAt }, this.config.encryptionKey, `oauth:${key}`);
    if (!await this.store.put('oauth', key, value, expiresAt, null)) throw new Error('OAuth state collision.');
    appendCookie(response, this.cookie(this.flowCookie, state, OAUTH_LIFETIME_MS));
    const url = new URL('https://github.com/login/oauth/authorize');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', `${this.config.origin}/api/copilot/auth/callback`);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', createHash('sha256').update(verifier).digest('base64url'));
    url.searchParams.set('code_challenge_method', 'S256');
    return url.href;
  }

  async complete(url: URL, request: IncomingMessage, response: ServerResponse): Promise<string> {
    const state = url.searchParams.get('state');
    const cookie = readCookie(request, this.flowCookie);
    appendCookie(response, this.cookie(this.flowCookie, '', 0));
    if (!state || !ID_PATTERN.test(state) || !cookie || !timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) {
      throw new CopilotRequestError('invalid_request', 'GitHub sign-in could not be verified. Return to the app and connect again.', 400);
    }
    const key = stateKey(state);
    const record = await this.store.get('oauth', key);
    if (!record || record.expiresAt <= Date.now() || !await this.store.delete('oauth', key, record.version)) {
      throw new CopilotRequestError('not_authenticated', 'This GitHub sign-in has expired or was already used. Connect again.', 401);
    }
    const flow = flowSchema.parse(decryptState(record.value, this.config.encryptionKey, `oauth:${key}`));
    if (flow.expiresAt !== record.expiresAt) throw new Error('OAuth expiry mismatch.');
    const code = url.searchParams.get('code');
    if (url.searchParams.has('error') || !code || code.length > 2048) {
      throw new CopilotRequestError('not_authenticated', 'GitHub authorization was declined. Return to the app when you are ready to connect.', 401);
    }
    const tokens = await this.github.exchange(code, flow.verifier);
    const user = await this.github.user(tokens.accessToken);
    const id = opaqueId();
    const sessionKey = stateKey(id);
    const expiresAt = Date.now() + SESSION_LIFETIME_MS;
    const session: AuthSession = { ...tokens, userId: user.id, login: user.login, expiresAt };
    const encrypted = encryptState(session, this.config.encryptionKey, `auth:${sessionKey}`);
    await this.disconnect(request, response);
    if (!await this.store.put('auth', sessionKey, encrypted, expiresAt, null)) throw new Error('Session collision.');
    appendCookie(response, this.cookie(this.sessionCookie, id, SESSION_LIFETIME_MS));
    return this.safeReturnTo(flow.returnTo);
  }

  private parseSession(key: string, record: StateRecord): AuthSession {
    const session = sessionSchema.parse(decryptState(record.value, this.config.encryptionKey, `auth:${key}`));
    if (session.expiresAt !== record.expiresAt) throw new Error('Session expiry mismatch.');
    return session;
  }

  private async refresh(key: string, margin: number): Promise<AuthSession> {
    const pending = this.refreshing.get(key);
    if (pending) return pending;
    const operation = (async () => {
      const lease = await acquireLease(this.store, 'refresh', key, 30_000);
      if (!lease) throw new CopilotRequestError('busy', 'Your GitHub connection is being renewed. Please retry shortly.', 429);
      try {
        const record = await this.store.get('auth', key);
        if (!record || record.expiresAt <= Date.now()) {
          throw new CopilotRequestError('not_authenticated', 'Your GitHub connection expired. Connect again.', 401);
        }
        const session = this.parseSession(key, record);
        if (session.accessExpiresAt > Date.now() + margin) return session;
        if (session.refreshExpiresAt <= Date.now()) {
          await this.store.delete('auth', key, record.version);
          throw new CopilotRequestError('not_authenticated', 'Your GitHub authorization expired. Connect again.', 401);
        }
        try {
          const updated: AuthSession = { ...session, ...await this.github.refresh(session.refreshToken) };
          const value = encryptState(updated, this.config.encryptionKey, `auth:${key}`);
          if (!await this.store.put('auth', key, value, record.expiresAt, record.version)) {
            throw new CopilotRequestError('not_authenticated', 'Your connection changed during sign-in renewal. Connect again.', 401);
          }
          return updated;
        } catch (error) {
          if (error instanceof CopilotRequestError && error.code === 'not_authenticated') {
            await this.store.delete('auth', key, record.version);
          }
          throw error;
        }
      } finally {
        await lease.release();
      }
    })();
    this.refreshing.set(key, operation);
    try { return await operation; }
    finally { this.refreshing.delete(key); }
  }

  /** The stored session, with its token renewed when it expires within `margin`, or undefined once it has ended. */
  private async current(key: string, margin: number): Promise<AuthSession | undefined> {
    const record = await this.store.get('auth', key);
    if (!record || record.expiresAt <= Date.now()) {
      if (record) await this.store.delete('auth', key, record.version);
      return undefined;
    }
    const session = this.parseSession(key, record);
    return session.accessExpiresAt <= Date.now() + margin ? this.refresh(key, margin) : session;
  }

  /**
   * Agent socket upgrades pass no response: the next HTTP request clears a stale cookie, and their token
   * is renewed further ahead and again during the turn, which has no deadline.
   */
  async authenticate(request: IncomingMessage, response?: ServerResponse): Promise<HostedIdentity | undefined> {
    const id = this.sessionId(request, response);
    if (!id) return undefined;
    const key = stateKey(id);
    const session = await this.current(key, response ? REFRESH_MARGIN_MS : AGENT_REFRESH_MARGIN_MS);
    if (!session) {
      if (response) appendCookie(response, this.cookie(this.sessionCookie, '', 0));
      return undefined;
    }
    const identity = { userId: session.userId, login: session.login, token: session.accessToken, sessionKey: key };
    if (response) return identity;
    return {
      ...identity,
      renewToken: async () => {
        const renewed = await this.current(key, AGENT_REFRESH_MARGIN_MS);
        return renewed && { token: renewed.accessToken, expiresAt: renewed.accessExpiresAt };
      },
    };
  }

  async disconnect(request: IncomingMessage, response: ServerResponse): Promise<string | undefined> {
    const id = this.sessionId(request, response);
    const key = id ? stateKey(id) : undefined;
    if (key) {
      let removed = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const record = await this.store.get('auth', key);
        if (!record || await this.store.delete('auth', key, record.version)) {
          removed = true;
          break;
        }
      }
      if (!removed) throw new CopilotRequestError('busy', 'The connection changed while disconnecting. Please retry.', 409);
    }
    appendCookie(response, this.cookie(this.sessionCookie, '', 0));
    return key;
  }
}
