// @vitest-environment node
import { randomBytes } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { AGENT_API_PATH, AGENT_SUBPROTOCOL, type AgentServerMessage } from '../../src/services/copilot/agentProtocol';
import { COPILOT_CLIENT_HEADER, CopilotRequestError } from '../../src/services/copilot/protocol';
import type { CopilotAgentRuntime } from '../copilotAgentRuntime';
import type { CopilotRuntime } from '../copilotRuntime';
import { createHostedApp, type HostedApp } from './app';
import { GENERATION_LEASE_MS, SESSION_LIFETIME_MS, type HostedConfig } from './config';
import { decryptState, stateKey } from './credentials';
import type { GitHubAuth } from './githubAuth';
import { MemoryStateStore } from './stateStore';

let directory: string;
let server: Server;
let origin: string;
let config: HostedConfig;
let store: MemoryStateStore;
let github: GitHubAuth;
let runtime: CopilotRuntime;
let app: HostedApp;

const AGENT_START = {
  v: 1, type: 'start', turnId: 'turn-1', prompt: 'Draw a login flow', model: 'auto', history: [],
  canvas: { pageName: 'Page 1', nodeCount: 0, edgeCount: 0, selectedIds: [] },
};

// Ends an aborted turn as turnError does: an AbortError interrupts it, a CopilotRequestError keeps its code, and
// anything else fails it.
function abortedTurnError(reason: unknown): CopilotRequestError {
  if (reason instanceof CopilotRequestError) return reason;
  if (reason instanceof Error && reason.name === 'AbortError') return new CopilotRequestError('interrupted', 'Interrupted.');
  return new CopilotRequestError('request_failed', 'Copilot could not finish this turn.', 502);
}

// Accepts the turn and holds it until the browser cancels or the turn is aborted.
function fakeAgent(): CopilotAgentRuntime {
  return {
    startTurn: vi.fn<CopilotAgentRuntime['startTurn']>((start, transport, signal) => {
      let finish!: () => void;
      const finished = new Promise<void>((resolve) => { finish = resolve; });
      const end = (message: AgentServerMessage) => {
        transport.send(message);
        finish();
      };
      transport.send({ v: 1, type: 'accepted', turnId: start.turnId });
      signal.addEventListener('abort', () => {
        const failure = abortedTurnError(signal.reason);
        end({ v: 1, type: 'error', code: failure.code, message: failure.message });
      }, { once: true });
      return {
        receive: (message) => { if (message.type === 'cancel') end({ v: 1, type: 'done', reply: '' }); },
        finished,
      };
    }),
  };
}

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'openflowkit-hosted-test-'));
  await mkdir(join(directory, 'assets'));
  await writeFile(join(directory, 'index.html'), '<html><head></head><body>Editor</body></html>');
  await writeFile(join(directory, 'assets', 'example.js'), 'export const example = true;');
  await writeFile(join(directory, 'staticwebapp.config.json'), await readFile('public/staticwebapp.config.json'));
  config = {
    origin: 'https://127.0.0.1', clientId: 'test-client', clientSecret: 'test-secret',
    encryptionKey: randomBytes(32), development: false, storageAccount: 'testaccount', port: 3045,
  };
  store = new MemoryStateStore();
  const tokens = {
    accessToken: 'ghu_test_only', refreshToken: 'ghr_test_only',
    accessExpiresAt: Date.now() + 8 * 3600_000, refreshExpiresAt: Date.now() + 180 * 86_400_000,
  };
  github = {
    exchange: vi.fn().mockResolvedValue(tokens),
    refresh: vi.fn().mockImplementation(async () => ({
      ...tokens, accessToken: 'ghu_renewed_test_only', refreshToken: 'ghr_renewed_test_only',
      accessExpiresAt: Date.now() + 8 * 3600_000,
    })),
    user: vi.fn().mockResolvedValue({ id: '123', login: 'test-user' }),
  };
  runtime = {
    ready: vi.fn().mockResolvedValue(undefined),
    status: vi.fn<CopilotRuntime['status']>(async (identity) => ({
      runtime: 'github-copilot-sdk', mode: 'hosted', signedIn: Boolean(identity),
      authenticated: Boolean(identity), login: identity?.login,
      models: identity ? [{ id: 'account-model', name: 'Account model' }] : [],
    })),
    generate: vi.fn(async (_input, delta) => { delta('flow: "Hosted"'); return 'flow: "Hosted"'; }),
    agent: fakeAgent(),
    cancelConnection: vi.fn(),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  app = await createHostedApp({ config, store, github, runtime, distDirectory: directory, revision: 'test-sha' });
  server = createServer(app.request);
  server.on('upgrade', app.upgrade);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test server address');
  origin = `http://127.0.0.1:${address.port}`;
  config.origin = `https://127.0.0.1:${address.port}`;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  await app?.close();
  server?.closeAllConnections();
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
  if (directory) await rm(directory, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function headers(cookie?: string): Record<string, string> {
  return {
    [COPILOT_CLIENT_HEADER]: '1', Origin: config.origin, 'Content-Type': 'application/json',
    ...(cookie ? { Cookie: cookie } : {}),
  };
}

async function start(returnTo = '/editor?view=canvas#diagram') {
  const response = await fetch(`${origin}/api/copilot/auth/start`, {
    method: 'POST', headers: headers(), body: JSON.stringify({ returnTo }),
  });
  const data = await response.json();
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  return { response, data, cookie, state: data.url ? new URL(data.url).searchParams.get('state') : undefined };
}

async function signIn() {
  const flow = await start();
  const response = await fetch(`${origin}/api/copilot/auth/callback?state=${flow.state}&code=test-code`, {
    headers: { Cookie: flow.cookie }, redirect: 'manual',
  });
  const cookie = response.headers.getSetCookie().map((value) => value.split(';')[0])
    .reverse().find((value) => value.startsWith('__Host-ofk-session=') && value.length > '__Host-ofk-session='.length);
  if (!cookie) throw new Error('No sign-in session');
  return { flow, response, cookie, key: stateKey(cookie.split('=')[1]) };
}

function agentSocket(extra: Record<string, string> = {}, protocols = [AGENT_SUBPROTOCOL], path = AGENT_API_PATH) {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}${path}`, protocols, { headers: { Origin: config.origin, ...extra } });
  const received: AgentServerMessage[] = [];
  socket.on('message', (data) => received.push(JSON.parse(data.toString())));
  const closed = new Promise<number>((resolve) => socket.on('close', resolve));
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  // Call right after sending: the reply needs a round trip, so it cannot arrive first.
  const next = () => new Promise<void>((resolve) => socket.once('message', () => resolve()));
  return { socket, received, closed, opened, next };
}

async function agentRejection(...options: Parameters<typeof agentSocket>): Promise<string> {
  return agentSocket(...options).opened.then(() => 'Connected', (error: Error) => error.message);
}

async function agentTurn(cookie: string) {
  const client = agentSocket({ Cookie: cookie });
  await client.opened;
  client.socket.send(JSON.stringify(AGENT_START));
  await client.next();
  return client;
}

describe('hosted GitHub authentication boundary', () => {
  it('keeps the editor anonymous and serves its runtime marker, assets, headers, and health', async () => {
    const page = await fetch(`${origin}/`);
    expect(await page.text()).toContain('<meta name="flowpilot-runtime" content="hosted">');
    expect(page.headers.get('cache-control')).toBe('no-store');
    expect(page.headers.get('x-content-type-options')).toBe('nosniff');
    const asset = await fetch(`${origin}/assets/example.js`);
    expect(asset.headers.get('content-type')).toContain('text/javascript');
    expect(asset.headers.get('cache-control')).toContain('immutable');
    expect((await fetch(`${origin}/assets/missing.js`)).status).toBe(404);
    expect((await fetch(`${origin}/%2e%2e%2fpackage.json`)).status).toBe(400);
    expect(await (await fetch(`${origin}/readyz`)).json()).toEqual({ status: 'ready', revision: 'test-sha' });
    expect(github.exchange).not.toHaveBeenCalled();
  });

  it('advertises hosted sign-in without starting a user model session when anonymous', async () => {
    const response = await fetch(`${origin}/api/copilot/status`, { headers: headers() });
    expect(await response.json()).toMatchObject({ mode: 'hosted', authenticated: false, signedIn: false });
    const chat = await fetch(`${origin}/api/copilot/chat`, { method: 'POST', headers: headers(), body: '{}' });
    expect(chat.status).toBe(401);
    expect(runtime.generate).not.toHaveBeenCalled();
  });

  it('explicitly rejects and clears malformed session cookies so a fresh connection can recover', async () => {
    const response = await fetch(`${origin}/api/copilot/status`, { headers: headers('__Host-ofk-session=broken') });
    expect(response.status).toBe(401);
    expect(response.headers.getSetCookie()[0]).toContain('__Host-ofk-session=;');
    expect(response.headers.getSetCookie()[0]).toContain('Max-Age=0');
    expect((await signIn()).response.status).toBe(303);
  });

  it.each<Record<string, string>>([
    { Origin: 'https://evil.example', [COPILOT_CLIENT_HEADER]: '1' },
    { Origin: 'null', [COPILOT_CLIENT_HEADER]: '1' },
    { [COPILOT_CLIENT_HEADER]: '1' },
    { 'sec-fetch-site': 'cross-site', [COPILOT_CLIENT_HEADER]: '1' },
    {},
  ])('rejects cross-origin or unmarked sign-in and API requests: %j', async (unsafe) => {
    const response = await fetch(`${origin}/api/copilot/auth/start`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...unsafe }, body: '{"returnTo":"/"}',
    });
    expect(response.status).toBe(403);
    expect(github.exchange).not.toHaveBeenCalled();
  });

  it.each(['https://evil.example', '//evil.example', '/\\evil.example', '/api/copilot/auth/callback'])('rejects unsafe return addresses: %s', async (returnTo) => {
    expect((await start(returnTo)).response.status).toBe(400);
  });

  it('uses single-use, cookie-bound OAuth state and PKCE with a fixed callback', async () => {
    const { flow, response } = await signIn();
    const url = new URL(flow.data.url);
    expect(url.origin).toBe('https://github.com');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toHaveLength(43);
    expect(url.searchParams.get('redirect_uri')).toBe(`${config.origin}/api/copilot/auth/callback`);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${config.origin}/editor?view=canvas#diagram`);
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.getSetCookie().at(-1)).toMatch(/HttpOnly; SameSite=Lax; Max-Age=604800; Secure$/);
    expect(github.exchange).toHaveBeenCalledWith('test-code', expect.stringMatching(/^[A-Za-z0-9_-]{43}$/));
    const replay = await fetch(`${origin}/api/copilot/auth/callback?state=${flow.state}&code=test-code`, {
      headers: { Cookie: flow.cookie }, redirect: 'manual',
    });
    expect(replay.status).toBe(401);
    expect(github.exchange).toHaveBeenCalledOnce();
  });

  it('rejects a callback without the browser state cookie', async () => {
    const flow = await start();
    const response = await fetch(`${origin}/api/copilot/auth/callback?state=${flow.state}&code=test-code`, { redirect: 'manual' });
    expect(response.status).toBe(400);
    expect(github.exchange).not.toHaveBeenCalled();
  });

  it('encrypts tokens at rest and sends only opaque cookies and public status to the browser', async () => {
    const { cookie, key, response } = await signIn();
    const record = await store.get('auth', key);
    expect(record?.value).not.toContain('ghu_');
    expect(record?.value).not.toContain('ghr_');
    expect(record?.value).not.toContain('test-user');
    expect(JSON.stringify(response.headers.getSetCookie())).not.toContain('ghu_');
    const status = await fetch(`${origin}/api/copilot/status`, { headers: headers(cookie) });
    expect(await status.json()).toMatchObject({ authenticated: true, login: 'test-user' });
    expect(runtime.status).toHaveBeenCalledWith(expect.objectContaining({ userId: '123', token: 'ghu_test_only', sessionKey: key }), expect.any(AbortSignal));
  });

  it('renews expiring tokens once for concurrent requests without extending the seven-day session', async () => {
    const { cookie, key } = await signIn();
    const before = await store.get('auth', key);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 8 * 3600_000 - 60_000);
    const responses = await Promise.all(Array.from({ length: 3 }, () => fetch(`${origin}/api/copilot/status`, { headers: headers(cookie) })));
    expect(responses.every((response) => response.status === 200)).toBe(true);
    expect(github.refresh).toHaveBeenCalledOnce();
    const after = await store.get('auth', key);
    expect(after?.expiresAt).toBe(before?.expiresAt);
    expect(decryptState(after!.value, config.encryptionKey, `auth:${key}`)).toMatchObject({ accessToken: 'ghu_renewed_test_only' });
  });

  it('renews a token expiring within four hours before an agent turn, but not for a request', async () => {
    const { cookie } = await signIn();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 3600_000 - 3 * 3600_000);
    expect((await fetch(`${origin}/api/copilot/status`, { headers: headers(cookie) })).status).toBe(200);
    expect(github.refresh).not.toHaveBeenCalled();

    const client = await agentTurn(cookie);
    expect(github.refresh).toHaveBeenCalledOnce();
    expect(runtime.agent?.startTurn).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), expect.any(AbortSignal), expect.objectContaining({ token: 'ghu_renewed_test_only' }),
    );
    client.socket.send(JSON.stringify({ v: 1, type: 'cancel' }));
    expect(await client.closed).toBe(1000);
  });

  it('expires sessions after seven days and never starts unauthenticated generations', async () => {
    const { cookie, key } = await signIn();
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + SESSION_LIFETIME_MS + 1);
    const response = await fetch(`${origin}/api/copilot/status`, { headers: headers(cookie) });
    expect(await response.json()).toMatchObject({ authenticated: false });
    expect(await store.get('auth', key)).toBeUndefined();
  });

  it('disconnects only the opaque app session, cancels its work, and prevents reuse', async () => {
    const { cookie, key } = await signIn();
    const response = await fetch(`${origin}/api/copilot/auth/logout`, { method: 'POST', headers: headers(cookie) });
    expect(response.status).toBe(200);
    expect(await store.get('auth', key)).toBeUndefined();
    expect(runtime.cancelConnection).toHaveBeenCalledWith(key);
    expect(await (await fetch(`${origin}/api/copilot/status`, { headers: headers(cookie) })).json()).toMatchObject({ authenticated: false });
  });

  it('passes the authenticated identity to streaming generation, never a browser-supplied token', async () => {
    const { cookie } = await signIn();
    const request = { prompt: 'Draw a queue', systemInstruction: 'Return DSL', history: [], model: 'auto' };
    const response = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: headers(cookie), body: JSON.stringify(request),
    });
    expect(response.status).toBe(200);
    expect((await response.text()).trim().split('\n').map((line) => JSON.parse(line).type)).toEqual(['delta', 'done']);
    expect(runtime.generate).toHaveBeenCalledWith(request, expect.any(Function), expect.any(AbortSignal), expect.objectContaining({ userId: '123', token: 'ghu_test_only' }));
    const malicious = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: headers(cookie), body: JSON.stringify({ ...request, gitHubToken: 'ghu_attacker' }),
    });
    expect(malicious.status).toBe(400);
    expect(runtime.generate).toHaveBeenCalledOnce();
  });

  it('does not leak tokens or raw upstream failures to responses or logs', async () => {
    vi.mocked(github.exchange).mockRejectedValue(new Error('Upstream exposed ghu_sensitive-value'));
    const flow = await start();
    const response = await fetch(`${origin}/api/copilot/auth/callback?state=${flow.state}&code=test-code`, {
      headers: { Cookie: flow.cookie }, redirect: 'manual',
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('ghu_sensitive-value');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('ghu_sensitive-value');
  });

  it('cancels a stream when another replica removes its sign-in record', async () => {
    const { cookie, key } = await signIn();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    vi.mocked(runtime.generate).mockImplementation(async (_request, onDelta, signal) => {
      onDelta('partial');
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    });
    const response = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: headers(cookie),
      body: JSON.stringify({ prompt: 'Draw a queue', systemInstruction: 'Return DSL' }),
    });
    const record = await store.get('auth', key);
    expect(record).toBeDefined();
    await store.delete('auth', key, record!.version);
    await vi.advanceTimersByTimeAsync(5000);
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(['delta', 'error']);
    expect(events[1].error.code).toBe('not_authenticated');
  });

  it('does not return a completed draft after a connection is removed during generation', async () => {
    const { cookie, key } = await signIn();
    vi.mocked(runtime.generate).mockImplementation(async (_request, onDelta) => {
      onDelta('partial');
      const record = await store.get('auth', key);
      await store.delete('auth', key, record!.version);
      return 'flow: "Cancelled"';
    });
    const response = await fetch(`${origin}/api/copilot/chat`, {
      method: 'POST', headers: headers(cookie),
      body: JSON.stringify({ prompt: 'Draw a queue', systemInstruction: 'Return DSL' }),
    });
    const events = (await response.text()).trim().split('\n').map((line) => JSON.parse(line));
    expect(events.map((event) => event.type)).toEqual(['delta', 'error']);
  });

  it('rejects agent sockets before upgrading without a session, from another site, or off the agent path', async () => {
    const { cookie } = await signIn();
    const rejections = await Promise.all([
      agentRejection(),
      agentRejection({ Cookie: '__Host-ofk-session=broken' }),
      agentRejection({ Cookie: cookie, Origin: 'https://evil.example' }),
      agentRejection({ Cookie: cookie, Host: 'evil.example' }),
      agentRejection({ Cookie: cookie, 'Sec-Fetch-Site': 'cross-site' }),
      agentRejection({ Cookie: cookie }, []),
      agentRejection({ Cookie: cookie }, [AGENT_SUBPROTOCOL], '/api/copilot/chat'),
    ]);
    expect(rejections).toEqual([401, 401, 403, 403, 403, 403, 404].map((status) => `Unexpected server response: ${status}`));
    expect(runtime.agent?.startTurn).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/ofk-session|ghu_/);
  });

  it('runs one agent turn per account with the signed-in identity and frees the account afterwards', async () => {
    const { cookie, key } = await signIn();
    const first = await agentTurn(cookie);
    expect(first.received).toEqual([{ v: 1, type: 'accepted', turnId: 'turn-1' }]);
    expect(runtime.agent?.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Draw a login flow' }), expect.anything(), expect.any(AbortSignal),
      expect.objectContaining({ userId: '123', token: 'ghu_test_only', sessionKey: key }),
    );
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const second = agentSocket({ Cookie: cookie });
    await second.opened;
    second.socket.send(JSON.stringify(AGENT_START));
    await vi.waitFor(() => expect(second.received).toEqual([expect.objectContaining({ type: 'error', code: 'busy' })]));
    // Neither socket reads the browser's answer to its close, so each is dropped after a short grace.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await second.closed).toBe(1000);
    first.socket.send(JSON.stringify({ v: 1, type: 'cancel' }));
    await vi.waitFor(() => expect(first.received.at(-1)).toEqual({ v: 1, type: 'done', reply: '' }));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await first.closed).toBe(1000);
    expect(await store.get('users', stateKey('123'))).toBeUndefined();
    expect(runtime.agent?.startTurn).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/ghu_|login flow/);
  });

  it('renews the generation lease every minute and ends the turn once the sign-in is removed', async () => {
    const { cookie, key } = await signIn();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const client = await agentTurn(cookie);
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await store.get('users', stateKey('123')))?.expiresAt).toBe(now + 60_000 + GENERATION_LEASE_MS);
    expect((await store.get('slots', '0'))?.expiresAt).toBe(now + 60_000 + GENERATION_LEASE_MS);

    const record = await store.get('auth', key);
    await store.delete('auth', key, record!.version);
    await vi.advanceTimersByTimeAsync(5000);
    expect(await client.closed).toBe(1000);
    expect(client.received.at(-1)).toMatchObject({ type: 'error', code: 'not_authenticated' });
    expect(await store.get('users', stateKey('123'))).toBeUndefined();
  });

  it('interrupts the turn, so it can be continued, when the store cannot renew its generation lease', async () => {
    const { cookie } = await signIn();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const client = await agentTurn(cookie);
    vi.spyOn(store, 'put').mockRejectedValue(new Error('storage offline'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(await client.closed).toBe(1000);
    expect(client.received.at(-1)).toMatchObject({ type: 'error', code: 'interrupted' });
    expect(await store.get('users', stateKey('123'))).toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/ghu_|storage offline|login flow/);
  });

  it('interrupts the turn, so it can be continued, when the store cannot check the sign-in', async () => {
    const { cookie } = await signIn();
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const client = await agentTurn(cookie);
    vi.spyOn(store, 'get').mockRejectedValueOnce(new Error('storage offline'));
    await vi.advanceTimersByTimeAsync(5000);
    expect(await client.closed).toBe(1000);
    expect(client.received.at(-1)).toMatchObject({ type: 'error', code: 'interrupted' });
    expect(await store.get('users', stateKey('123'))).toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/ghu_|storage offline|login flow/);
  });

  it('frees the account when the browser disconnects and interrupts turns on shutdown', async () => {
    const { cookie } = await signIn();
    const lost = await agentTurn(cookie);
    lost.socket.terminate();
    await vi.waitFor(async () => expect(await store.get('users', stateKey('123'))).toBeUndefined());

    const running = await agentTurn(cookie);
    await app.close();
    expect(await running.closed).toBe(1001);
    expect(running.received.at(-1)).toMatchObject({ type: 'error', code: 'interrupted' });
    expect(await store.get('users', stateKey('123'))).toBeUndefined();
    expect(await agentRejection({ Cookie: cookie })).toBe('Unexpected server response: 503');
  });
});
