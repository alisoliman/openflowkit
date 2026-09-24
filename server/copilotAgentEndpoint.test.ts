// @vitest-environment node
import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  AGENT_API_PATH,
  AGENT_INVALID_START_MESSAGE,
  AGENT_SUBPROTOCOL,
  type AgentClientMessage,
  type AgentServerMessage,
} from '../src/services/copilot/agentProtocol';
import { CopilotRequestError } from '../src/services/copilot/protocol';
import type { CopilotAgentRuntime } from './copilotAgentRuntime';
import { createCopilotAgentEndpoint, type CopilotAgentEndpoint } from './copilotAgentEndpoint';
import type { HostedCopilotBoundary } from './copilotMiddleware';
import type { CopilotRuntime } from './copilotRuntime';
import type { HostedIdentity } from './hosted/authSessions';
import type { Lease } from './hosted/leases';

const START = {
  v: 1, type: 'start', turnId: 'turn-1', prompt: 'Draw a login flow', model: 'auto', history: [],
  canvas: { pageName: 'Page 1', nodeCount: 0, edgeCount: 0, selectedIds: [] },
};
const TOOL_RESULT = { v: 1, type: 'tool_result', callId: 'call-1', ok: true, result: { nodes: [] } };
const IDENTITY: HostedIdentity = { userId: '1', login: 'one', token: 'ghu_test_only', sessionKey: 'one' };
let server: Server;
let origin: string;
let runtime: CopilotRuntime;
let endpoint: CopilotAgentEndpoint;
let turns: Array<{ signal: AbortSignal; received: AgentClientMessage[] }>;
let startTurn: ReturnType<typeof vi.fn<CopilotAgentRuntime['startTurn']>>;

// Ends an aborted turn as turnError does: an AbortError interrupts it, a CopilotRequestError keeps its code, and
// anything else fails it.
function abortedTurnError(reason: unknown): CopilotRequestError {
  if (reason instanceof CopilotRequestError) return reason;
  if (reason instanceof Error && reason.name === 'AbortError') return new CopilotRequestError('interrupted', 'Interrupted.');
  return new CopilotRequestError('request_failed', 'Copilot could not finish this turn.', 502);
}

// Behaves like the agent runtime at the transport edge: one tool call, then done; an abort ends it with its reason.
function fakeAgent(): CopilotAgentRuntime {
  startTurn = vi.fn<CopilotAgentRuntime['startTurn']>((start, transport, signal) => {
    const turn = { signal, received: [] as AgentClientMessage[] };
    turns.push(turn);
    let ended = false;
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const end = (message: AgentServerMessage) => {
      if (ended) return;
      ended = true;
      transport.send(message);
      finish();
    };
    transport.send({ v: 1, type: 'accepted', turnId: start.turnId });
    transport.send({ v: 1, type: 'tool_call', callId: 'call-1', name: 'get_canvas', args: {} });
    signal.addEventListener('abort', () => {
      const failure = abortedTurnError(signal.reason);
      end({ v: 1, type: 'error', code: failure.code, message: failure.message });
    }, { once: true });
    return {
      receive(message) {
        turn.received.push(message);
        if (message.type === 'tool_result') end({ v: 1, type: 'done', reply: 'Drawn.' });
        if (message.type === 'cancel') end({ v: 1, type: 'done', reply: '' });
      },
      finished,
    };
  });
  return { startTurn };
}

beforeEach(async () => {
  turns = [];
  runtime = {
    status: vi.fn(),
    generate: vi.fn(),
    agent: fakeAgent(),
    stop: vi.fn().mockResolvedValue(undefined),
  };
  endpoint = createCopilotAgentEndpoint(runtime);
  server = createServer((_request, response) => {
    response.writeHead(404);
    response.end();
  });
  server.on('upgrade', (request, socket, head) => endpoint.upgrade(request, socket, head));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No test server address');
  origin = `http://127.0.0.1:${address.port}`;
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(async () => {
  vi.useRealTimers();
  await endpoint.close();
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  vi.restoreAllMocks();
});

function connect(options: { protocols?: string[]; origin?: string; headers?: Record<string, string>; path?: string } = {}) {
  const socket = new WebSocket(`${origin.replace('http', 'ws')}${options.path ?? AGENT_API_PATH}`, options.protocols ?? [AGENT_SUBPROTOCOL], {
    ...(options.origin === '' ? {} : { origin: options.origin ?? origin }),
    headers: options.headers,
  });
  const received: AgentServerMessage[] = [];
  socket.on('message', (data) => received.push(JSON.parse(data.toString())));
  const closed = new Promise<{ code: number }>((resolve) => socket.on('close', (code) => resolve({ code })));
  const opened = new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return { socket, received, closed, opened };
}

async function rejection(options: Parameters<typeof connect>[0]): Promise<number> {
  const { opened } = connect(options);
  const error = await opened.then(() => new Error('Connected'), (failure: Error) => failure);
  const status = error.message.match(/Unexpected server response: (\d+)/)?.[1];
  if (!status) throw error;
  return Number(status);
}

// vi.waitFor advances fake timers, so heartbeat tests wait on socket I/O instead.
async function until(condition: () => boolean): Promise<void> {
  for (let attempt = 0; !condition(); attempt++) {
    if (attempt > 10_000) throw new Error('Condition not met');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// Counts the frames the server has read. The client socket only receives server frames.
function serverReads(client: WebSocket): () => number {
  const emit = vi.spyOn(WebSocket.prototype, 'emit');
  return () => emit.mock.calls.filter(([event], index) => event === 'message' && emit.mock.contexts[index] !== client).length;
}

function send(socket: WebSocket, message: unknown): void {
  socket.send(typeof message === 'string' ? message : JSON.stringify(message));
}

function sent(socket: WebSocket, message: unknown): Promise<void> {
  return new Promise((resolve, reject) => socket.send(JSON.stringify(message), (error) => error ? reject(error) : resolve()));
}

async function useHosted(acquire: HostedCopilotBoundary['acquire']): Promise<void> {
  await endpoint.close();
  endpoint = createCopilotAgentEndpoint(runtime, { authorize: async () => IDENTITY, acquire, isActive: async () => true });
}

describe('local Flowpilot agent socket', () => {
  it('runs one turn over the subprotocol and closes after it ends', async () => {
    const client = connect();
    await client.opened;
    expect(client.socket.protocol).toBe(AGENT_SUBPROTOCOL);
    send(client.socket, START);
    await vi.waitFor(() => expect(client.received.map((message) => message.type)).toEqual(['accepted', 'tool_call']));
    send(client.socket, { v: 1, type: 'pong' });
    send(client.socket, TOOL_RESULT);
    expect(await client.closed).toEqual({ code: 1000 });
    expect(client.received.at(-1)).toEqual({ v: 1, type: 'done', reply: 'Drawn.' });
    expect(startTurn).toHaveBeenCalledWith(expect.objectContaining({ turnId: 'turn-1', prompt: 'Draw a login flow' }), expect.anything(), expect.any(AbortSignal), undefined);
    expect(turns[0].received).toEqual([TOOL_RESULT]);
  });

  it.each([
    ['another origin', { origin: 'http://evil.example' }],
    ['a missing origin', { origin: '' }],
    ['a different loopback origin', { origin: 'http://localhost:3000' }],
    ['a non-loopback host', { headers: { Host: 'evil.example' } }],
    ['a rebinding host', { headers: { Host: '127.0.0.1.evil.example' } }],
    ['a missing subprotocol', { protocols: [] }],
    ['another subprotocol', { protocols: ['vite-hmr'] }],
  ])('rejects %s before upgrading', async (_name, options) => {
    expect(await rejection(options)).toBe(403);
    expect(startTurn).not.toHaveBeenCalled();
  });

  it('rejects a non-loopback socket and leaves other upgrades such as Vite HMR untouched', () => {
    const request = (url: string, remoteAddress: string) => ({
      url, socket: { remoteAddress },
      headers: { host: '127.0.0.1:3000', origin: 'http://127.0.0.1:3000', 'sec-websocket-protocol': AGENT_SUBPROTOCOL },
    }) as unknown as IncomingMessage;
    const remote = new PassThrough();
    endpoint.upgrade(request(AGENT_API_PATH, '192.0.2.10'), remote, Buffer.alloc(0));
    expect(String(remote.read())).toMatch(/^HTTP\/1\.1 403 Forbidden\r\n/);

    const hmr = new PassThrough();
    endpoint.upgrade(request('/', '127.0.0.1'), hmr, Buffer.alloc(0));
    expect(hmr.read()).toBeNull();
    expect(hmr.destroyed).toBe(false);
  });

  it.each([
    ['invalid JSON', 'not json', 1008],
    ['a binary frame', Buffer.from(JSON.stringify(START)), 1008],
    ['a message before start', TOOL_RESULT, 1008],
    ['an answer over its size cap', { v: 1, type: 'answer', questionId: 'q', answer: 'x'.repeat(17 * 1024), wasFreeform: true }, 1008],
    ['a frame over the start cap', 'x'.repeat(8 * 1024 * 1024 + 1), 1009],
  ])('closes the socket on %s', async (_name, message, code) => {
    const client = connect();
    await client.opened;
    client.socket.send(typeof message === 'string' || Buffer.isBuffer(message) ? message : JSON.stringify(message));
    expect(await client.closed).toEqual({ code });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it('explains an unreadable start before closing the socket', async () => {
    const client = connect();
    await client.opened;
    send(client.socket, { ...START, image: 'data:image/svg+xml;base64,PHN2Zz4=' });
    expect(await client.closed).toEqual({ code: 1008 });
    expect(client.received).toEqual([{ v: 1, type: 'error', code: 'invalid_request', message: AGENT_INVALID_START_MESSAGE }]);
    expect(startTurn).not.toHaveBeenCalled();
  });

  it('closes on a second start without starting another turn', async () => {
    const client = connect();
    await client.opened;
    send(client.socket, START);
    await vi.waitFor(() => expect(client.received).toHaveLength(2));
    send(client.socket, START);
    expect(await client.closed).toEqual({ code: 1008 });
    expect(startTurn).toHaveBeenCalledTimes(1);
    expect(turns[0].signal.aborted).toBe(true);
  });

  it('drops frames that follow an invalid one without reading them', async () => {
    const client = connect();
    await client.opened;
    send(client.socket, START);
    await vi.waitFor(() => expect(client.received).toHaveLength(2));
    send(client.socket, 'not json');
    send(client.socket, TOOL_RESULT);
    expect(await client.closed).toEqual({ code: 1008 });
    expect(turns[0].received).toEqual([]);
  });

  it('forwards cancel and aborts the turn when the browser disconnects', async () => {
    const stopped = connect();
    await stopped.opened;
    send(stopped.socket, START);
    await vi.waitFor(() => expect(stopped.received).toHaveLength(2));
    send(stopped.socket, { v: 1, type: 'cancel' });
    expect(await stopped.closed).toEqual({ code: 1000 });
    expect(stopped.received.at(-1)).toEqual({ v: 1, type: 'done', reply: '' });

    const lost = connect();
    await lost.opened;
    send(lost.socket, START);
    await vi.waitFor(() => expect(turns).toHaveLength(2));
    lost.socket.terminate();
    await vi.waitFor(() => expect(turns[1].signal.aborted).toBe(true));
  });

  it('interrupts running and waiting connections on shutdown and then rejects new ones', async () => {
    const running = connect();
    const waiting = connect();
    await Promise.all([running.opened, waiting.opened]);
    send(running.socket, START);
    await vi.waitFor(() => expect(running.received).toHaveLength(2));
    await endpoint.close();
    for (const client of [running, waiting]) {
      expect(await client.closed).toEqual({ code: 1001 });
      expect(client.received.at(-1)).toMatchObject({ type: 'error', code: 'interrupted' });
    }
    expect(await rejection({})).toBe(503);
  });

  it('pings every 25 seconds, closes 60 seconds after the last pong, and requires an early start', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const idle = connect();
    await idle.opened;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await idle.closed).toEqual({ code: 1008 });

    const client = connect();
    await client.opened;
    const reads = serverReads(client.socket);
    send(client.socket, START);
    await until(() => client.received.length === 2);
    send(client.socket, { v: 1, type: 'answer', questionId: 'none', answer: 'Yes', wasFreeform: true });
    await until(() => turns[0].received.length === 1);
    await vi.advanceTimersByTimeAsync(25_000);
    await until(() => client.received.length === 3);
    expect(client.received.at(-1)).toEqual({ v: 1, type: 'ping' });
    // Only the pong can keep the socket open past 60 seconds after the answer.
    send(client.socket, { v: 1, type: 'pong' });
    await until(() => reads() === 3);
    await vi.advanceTimersByTimeAsync(59_000);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await client.closed).toEqual({ code: 1006 });
    expect(turns[0].signal.aborted).toBe(true);
  });

  it('closes 60 seconds after the last frame when a ping goes unanswered', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    const client = connect();
    await client.opened;
    send(client.socket, START);
    await until(() => client.received.length === 2);
    await vi.advanceTimersByTimeAsync(25_000);
    await until(() => client.received.length === 3);
    await vi.advanceTimersByTimeAsync(34_000);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(await client.closed).toEqual({ code: 1006 });
    expect(turns[0].signal.aborted).toBe(true);
  });
});

describe('hosted Flowpilot agent socket', () => {
  it.each([
    ['taken over', () => Promise.resolve(false)],
    ['unreadable', () => Promise.reject(new Error('storage offline'))],
  ])('ends the turn and frees the account when its generation lease is %s', async (_name, renew) => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
    const lease: Lease = { renew: vi.fn(renew), release: vi.fn().mockResolvedValue(undefined) };
    const acquire = vi.fn().mockResolvedValue(lease);
    await useHosted(acquire);
    const client = connect();
    await client.opened;
    send(client.socket, START);
    await until(() => client.received.length === 2);
    expect(acquire).toHaveBeenCalledExactlyOnceWith(IDENTITY);

    await vi.advanceTimersByTimeAsync(60_000);
    expect(await client.closed).toEqual({ code: 1000 });
    expect(client.received.at(-1)).toMatchObject({ type: 'error', code: 'interrupted' });
    expect(turns[0].signal.aborted).toBe(true);
    expect(lease.renew).toHaveBeenCalledOnce();
    expect(lease.release).toHaveBeenCalledOnce();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/ghu_|storage offline/);
  });

  it('answers Stop during admission with an empty reply and never starts the turn', async () => {
    let admit!: (lease: Lease) => void;
    const lease: Lease = { renew: vi.fn(), release: vi.fn().mockResolvedValue(undefined) };
    const acquire = vi.fn(() => new Promise<Lease>((resolve) => { admit = resolve; }));
    await useHosted(acquire);
    const client = connect();
    await client.opened;
    await vi.waitFor(() => expect(acquire).toHaveBeenCalledExactlyOnceWith(IDENTITY));
    // Both frames go out in one TCP write, so they wait unread until the account holds its lease and arrive together.
    const raw = (client.socket as unknown as { _socket: Socket })._socket;
    raw.cork();
    const frames = Promise.all([sent(client.socket, START), sent(client.socket, { v: 1, type: 'cancel' })]);
    raw.uncork();
    await frames;

    admit(lease);
    expect(await client.closed).toEqual({ code: 1000 });
    expect(client.received).toEqual([{ v: 1, type: 'done', reply: '' }]);
    expect(startTurn).not.toHaveBeenCalled();
    expect(lease.release).toHaveBeenCalledOnce();
  });

  it('reads no frame until the account holds its generation lease, and explains a busy account', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let refuse!: (error: Error) => void;
    const acquire = vi.fn(() => new Promise<Lease>((_resolve, reject) => { refuse = reject; }));
    await useHosted(acquire);
    // Only the server side of a socket receives client frames such as start.
    const emit = vi.spyOn(WebSocket.prototype, 'emit');
    const client = connect();
    await client.opened;
    await until(() => acquire.mock.calls.length === 1);
    await sent(client.socket, START);
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(emit.mock.calls.some(([event]) => event === 'message')).toBe(false);

    refuse(new CopilotRequestError('busy', 'Your account already has a generation in progress. Finish or cancel it before retrying.', 429));
    await until(() => client.received.length === 1);
    expect(client.received).toEqual([{
      v: 1, type: 'error', code: 'busy', message: 'Your account already has a generation in progress. Finish or cancel it before retrying.',
    }]);
    // The unread socket never sees the browser answer its close, so it is dropped after a short grace.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await client.closed).toEqual({ code: 1000 });
    expect(startTurn).not.toHaveBeenCalled();
  });

  it('reports the end only once the account is free, and reads nothing more meanwhile', async () => {
    let free!: () => void;
    const lease: Lease = { renew: vi.fn(), release: vi.fn(() => new Promise<void>((resolve) => { free = resolve; })) };
    await useHosted(vi.fn().mockResolvedValue(lease));
    const client = connect();
    await client.opened;
    send(client.socket, START);
    await until(() => client.received.length === 2);
    const reads = serverReads(client.socket);
    send(client.socket, TOOL_RESULT);
    await until(() => vi.mocked(lease.release).mock.calls.length === 1);
    // Read now, this frame would close the socket as invalid.
    await new Promise((resolve) => client.socket.send('not json', resolve));
    for (let turn = 0; turn < 20; turn++) await new Promise((resolve) => setImmediate(resolve));
    expect(client.received.map((message) => message.type)).toEqual(['accepted', 'tool_call']);
    expect(reads()).toBe(1);

    free();
    expect(await client.closed).toEqual({ code: 1000 });
    expect(client.received.at(-1)).toEqual({ v: 1, type: 'done', reply: 'Drawn.' });
    expect(turns[0].received).toEqual([TOOL_RESULT]);
  });

  it('still delivers the end when freeing the account outlasts the pong timeout', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    let free!: () => void;
    const lease: Lease = { renew: vi.fn().mockResolvedValue(true), release: vi.fn(() => new Promise<void>((resolve) => { free = resolve; })) };
    await useHosted(vi.fn().mockResolvedValue(lease));
    const client = connect();
    await client.opened;
    send(client.socket, START);
    await until(() => client.received.length === 2);
    send(client.socket, TOOL_RESULT);
    await until(() => vi.mocked(lease.release).mock.calls.length === 1);

    // The paused socket reads no pongs, so neither pings nor the silence timer apply any more.
    await vi.advanceTimersByTimeAsync(120_000);
    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    expect(client.received.map((message) => message.type)).toEqual(['accepted', 'tool_call']);

    free();
    await until(() => client.received.length === 3);
    expect(client.received.at(-1)).toEqual({ v: 1, type: 'done', reply: 'Drawn.' });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await client.closed).toEqual({ code: 1000 });
  });
});
