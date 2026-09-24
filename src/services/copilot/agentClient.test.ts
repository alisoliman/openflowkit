import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCopilotStatus } from './client';
import { startAgentTurn, type AgentTurnHandlers, type AgentTurnStart } from './agentClient';
import { AGENT_INVALID_START_MESSAGE } from './agentProtocol';

vi.mock('./client', async (importOriginal) => ({
  ...await importOriginal<typeof import('./client')>(),
  getCopilotStatus: vi.fn(),
}));

class FakeSocket extends EventTarget {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeSocket[] = [];
  readyState = FakeSocket.CONNECTING;
  sent: unknown[] = [];

  constructor(readonly url: string, readonly protocol: string) {
    super();
    FakeSocket.instances.push(this);
  }

  send(data: string): void {
    this.sent.push(JSON.parse(data));
  }

  close(): void {
    if (this.readyState === FakeSocket.CLOSED) return;
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new Event('close'));
  }

  open(): void {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event('open'));
  }

  receive(message: unknown): void {
    const data = typeof message === 'string' ? message : JSON.stringify({ v: 1, ...message as object });
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const START: AgentTurnStart = {
  turnId: 'turn-1',
  prompt: 'Add a database.',
  model: 'auto',
  history: [],
  canvas: { pageName: 'Checkout', nodeCount: 2, edgeCount: 1, selectedIds: [] },
};

function start() {
  const handlers = { onEvent: vi.fn(), onEnd: vi.fn() } satisfies AgentTurnHandlers;
  const connection = startAgentTurn(START, handlers);
  const socket = FakeSocket.instances.at(-1);
  if (!socket) throw new Error('No socket opened.');
  return { handlers, connection, socket };
}

beforeEach(() => {
  FakeSocket.instances = [];
  vi.stubGlobal('WebSocket', FakeSocket);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});

describe('Flowpilot agent socket', () => {
  it('opens the agent endpoint with the subprotocol and sends the start frame', () => {
    const { socket } = start();
    expect(socket.url).toBe(`${window.location.origin.replace(/^http/, 'ws')}/api/copilot/agent`);
    expect(socket.protocol).toBe('flowpilot-agent.v1');
    expect(socket.sent).toEqual([]);
    socket.open();
    expect(socket.sent).toEqual([{ v: 1, type: 'start', ...START }]);
  });

  it('passes turn events on, answers pings and ends once with the reply', () => {
    const { handlers, socket } = start();
    socket.open();
    socket.receive({ type: 'accepted', turnId: 'turn-1' });
    socket.receive({ type: 'reply_delta', text: 'Adding it.' });
    socket.receive({ type: 'ping' });
    expect(handlers.onEvent).toHaveBeenCalledExactlyOnceWith({ v: 1, type: 'reply_delta', text: 'Adding it.' });
    expect(socket.sent.at(-1)).toEqual({ v: 1, type: 'pong' });

    socket.receive({ type: 'done', reply: 'Added it.' });
    socket.receive({ type: 'reply_delta', text: 'late' });
    expect(handlers.onEnd).toHaveBeenCalledExactlyOnceWith({ type: 'done', reply: 'Added it.' });
    expect(handlers.onEvent).toHaveBeenCalledOnce();
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
  });

  it('sends tool results and answers as protocol frames', () => {
    const { connection, socket } = start();
    connection.sendToolResult('call-0', { ok: true, result: {} });
    expect(socket.sent).toEqual([]);
    socket.open();
    connection.sendToolResult('call-1', { ok: true, result: { summary: 'Added 1 node.' } });
    connection.sendToolResult('call-2', { ok: false, error: 'User declined.', resultType: 'rejected' });
    connection.answer('q-1', 'Azure', false);
    expect(socket.sent.slice(1)).toEqual([
      { v: 1, type: 'tool_result', callId: 'call-1', ok: true, result: { summary: 'Added 1 node.' } },
      { v: 1, type: 'tool_result', callId: 'call-2', ok: false, error: 'User declined.', resultType: 'rejected' },
      { v: 1, type: 'answer', questionId: 'q-1', answer: 'Azure', wasFreeform: false },
    ]);
  });

  it('ends with the server error, or as interrupted when the server stops the turn', () => {
    const failed = start();
    failed.socket.open();
    failed.socket.receive({ type: 'error', code: 'quota_exceeded', message: 'Your Copilot quota is used up.' });
    expect(failed.handlers.onEnd).toHaveBeenCalledExactlyOnceWith({
      type: 'error', code: 'quota_exceeded', message: 'Your Copilot quota is used up.',
    });

    const stopped = start();
    stopped.socket.open();
    stopped.socket.receive({ type: 'error', code: 'interrupted', message: 'The server is restarting.' });
    expect(stopped.handlers.onEnd).toHaveBeenCalledExactlyOnceWith({ type: 'interrupted' });
  });

  it.each([
    ['malformed JSON', '{'],
    ['an unknown type', JSON.stringify({ v: 1, type: 'shell', command: 'ls' })],
    ['another protocol version', JSON.stringify({ v: 2, type: 'ping' })],
  ])('ends the turn on %s', (_label, frame) => {
    const { handlers, socket } = start();
    socket.open();
    socket.receive(frame);
    expect(handlers.onEnd).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ type: 'error', code: 'bad_response' }));
    expect(handlers.onEvent).not.toHaveBeenCalled();
  });

  it('treats a socket lost after it opened as interrupted', () => {
    const { handlers, socket } = start();
    socket.open();
    socket.close();
    expect(handlers.onEnd).toHaveBeenCalledExactlyOnceWith({ type: 'interrupted' });
  });

  it('explains a failed handshake with the Copilot sign-in status', async () => {
    const changed = vi.fn();
    window.addEventListener('copilot-connection-changed', changed);
    vi.mocked(getCopilotStatus).mockResolvedValueOnce({
      runtime: 'github-copilot-sdk', mode: 'hosted', authenticated: false, models: [],
    });
    const signedOut = start();
    signedOut.socket.close();
    await vi.waitFor(() => expect(signedOut.handlers.onEnd).toHaveBeenCalledOnce());
    expect(signedOut.handlers.onEnd).toHaveBeenCalledWith(expect.objectContaining({ type: 'error', code: 'not_authenticated' }));
    expect(changed).toHaveBeenCalledOnce();
    window.removeEventListener('copilot-connection-changed', changed);

    vi.mocked(getCopilotStatus).mockResolvedValueOnce({ runtime: 'github-copilot-sdk', authenticated: true, models: [] });
    const dropped = start();
    dropped.socket.close();
    await vi.waitFor(() => expect(dropped.handlers.onEnd).toHaveBeenCalledExactlyOnceWith({ type: 'interrupted' }));
  });

  it('ends a turn cancelled before the socket opens at once', () => {
    const { connection, handlers, socket } = start();
    connection.cancel();
    expect(handlers.onEnd).toHaveBeenCalledExactlyOnceWith({ type: 'done', reply: '' });
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
  });

  it('asks the server to cancel, and gives up on a silent server after 30 seconds', () => {
    vi.useFakeTimers();
    const { connection, handlers, socket } = start();
    socket.open();
    connection.cancel();
    connection.cancel();
    expect(socket.sent.slice(1)).toEqual([{ v: 1, type: 'cancel' }, { v: 1, type: 'cancel' }]);
    expect(handlers.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(29_000);
    expect(handlers.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(handlers.onEnd).toHaveBeenCalledExactlyOnceWith({ type: 'interrupted' });
  });

  it('treats 75 seconds without any server message as a lost connection', () => {
    vi.useFakeTimers();
    const { handlers, socket } = start();
    socket.open();
    vi.advanceTimersByTime(70_000);
    socket.receive({ type: 'ping' });
    vi.advanceTimersByTime(70_000);
    expect(handlers.onEnd).not.toHaveBeenCalled();
    vi.advanceTimersByTime(5_000);
    expect(handlers.onEnd).toHaveBeenCalledExactlyOnceWith({ type: 'interrupted' });
    expect(socket.readyState).toBe(FakeSocket.CLOSED);

    const finished = start();
    finished.socket.open();
    finished.socket.receive({ type: 'done', reply: 'Added it.' });
    vi.advanceTimersByTime(75_000);
    expect(finished.handlers.onEnd).toHaveBeenCalledExactlyOnceWith({ type: 'done', reply: 'Added it.' });
  });

  it('closes without reporting an end', () => {
    const { connection, handlers, socket } = start();
    socket.open();
    connection.close();
    expect(socket.readyState).toBe(FakeSocket.CLOSED);
    expect(handlers.onEnd).not.toHaveBeenCalled();
  });

  it('refuses a start frame that is too large before opening a socket', () => {
    const handlers = { onEvent: vi.fn(), onEnd: vi.fn() };
    expect(() => startAgentTurn({ ...START, prompt: 'x'.repeat(9 * 1024 * 1024) }, handlers)).toThrow('too large');
    expect(FakeSocket.instances).toEqual([]);
  });

  it.each([
    ['an image type the server refuses', { ...START, image: 'data:image/svg+xml;base64,PHN2Zz4=' }],
    ['an id longer than the protocol allows', { ...START, turnId: 't'.repeat(201) }],
  ])('refuses a start frame with %s before opening a socket', (_label, invalid) => {
    const handlers = { onEvent: vi.fn(), onEnd: vi.fn() };
    expect(() => startAgentTurn(invalid, handlers)).toThrow(expect.objectContaining({
      code: 'invalid_request', message: AGENT_INVALID_START_MESSAGE,
    }));
    expect(FakeSocket.instances).toEqual([]);
  });
});
