// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCopilotClientOptions, createCopilotRuntime } from './copilotRuntime';
import type { CopilotRequest } from '../src/services/copilot/protocol';

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  start: vi.fn(),
  forceStop: vi.fn(),
  stop: vi.fn(),
  getAuthStatus: vi.fn(),
  listModels: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  sendAndWait: vi.fn(),
  on: vi.fn(),
  unsubscribe: vi.fn(),
  abort: vi.fn(),
}));

vi.mock('@github/copilot-sdk', () => ({
  CopilotClient: class {
    constructor(options: unknown) { mocks.construct(options); }
    start = mocks.start;
    forceStop = mocks.forceStop;
    stop = mocks.stop;
    getAuthStatus = mocks.getAuthStatus;
    listModels = mocks.listModels;
    createSession = mocks.createSession;
    deleteSession = mocks.deleteSession;
  },
}));

const INPUT: CopilotRequest = {
  prompt: 'Add a queue',
  systemInstruction: 'Preserve existing node IDs. Return DSL only.',
  history: [{ role: 'assistant', content: 'The current diagram has an API.' }],
  model: 'model-1',
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.start.mockResolvedValue(undefined);
  mocks.forceStop.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue([]);
  mocks.getAuthStatus.mockResolvedValue({ isAuthenticated: true, login: 'test-user' });
  mocks.listModels.mockResolvedValue([
    { id: 'model-1', name: 'Model one', capabilities: { supports: { vision: true } }, billing: { multiplier: 1 } },
    { id: 'disabled', name: 'Disabled', capabilities: { supports: { vision: false } }, policy: { state: 'disabled' } },
  ]);
  mocks.on.mockReturnValue(mocks.unsubscribe);
  mocks.sendAndWait.mockResolvedValue({ data: { content: 'flow: "Queue"' } });
  mocks.abort.mockResolvedValue(undefined);
  mocks.deleteSession.mockResolvedValue(undefined);
  mocks.createSession.mockResolvedValue({
    sessionId: 'flowpilot-temporary',
    on: mocks.on,
    sendAndWait: mocks.sendAndWait,
    abort: mocks.abort,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('Copilot SDK runtime', () => {
  it('shares CLI credentials without inheriting automation tokens', () => {
    for (const key of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_COPILOT_API_TOKEN']) {
      vi.stubEnv(key, 'test-token');
    }
    const options = createCopilotClientOptions();
    expect(options.mode).toBe('empty');
    expect(options.useLoggedInUser).toBe(true);
    expect(options.baseDirectory).toBeTruthy();
    for (const key of ['COPILOT_GITHUB_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'GITHUB_COPILOT_API_TOKEN']) {
      expect(options.env[key]).toBeUndefined();
    }
  });

  it('discovers account models, filters disabled models, and coalesces startup', async () => {
    const runtime = createCopilotRuntime();
    const [status] = await Promise.all([runtime.status(), runtime.status()]);
    expect(mocks.start).toHaveBeenCalledOnce();
    expect(status).toEqual({
      runtime: 'github-copilot-sdk',
      authenticated: true,
      login: 'test-user',
      models: [{ id: 'model-1', name: 'Model one', vision: true, multiplier: 1 }],
    });
  });

  it('supports dynamic routing models without static capability metadata', async () => {
    mocks.listModels.mockResolvedValue([{ id: 'auto', name: 'Auto', capabilities: { supports: {} } }]);
    const status = await createCopilotRuntime().status();
    expect(status.models[0]).toMatchObject({ id: 'auto', name: 'Auto' });
    expect(status.models[0].vision).toBeUndefined();
  });

  it('does not request models or start a session when signed out', async () => {
    mocks.getAuthStatus.mockResolvedValue({ isAuthenticated: false });
    const runtime = createCopilotRuntime();
    expect(await runtime.status()).toMatchObject({ authenticated: false, models: [] });
    expect(mocks.listModels).not.toHaveBeenCalled();
    await expect(runtime.generate(INPUT, vi.fn(), new AbortController().signal)).rejects.toMatchObject({
      code: 'not_authenticated', message: expect.stringContaining('gh copilot login'),
    });
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('keeps the Flowpilot prompt and history while disabling host tools and ambient configuration', async () => {
    const runtime = createCopilotRuntime();
    const text = await runtime.generate(INPUT, vi.fn(), new AbortController().signal);
    expect(text).toBe('flow: "Queue"');
    expect(mocks.createSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      model: 'model-1',
      streaming: true,
      systemMessage: { mode: 'replace', content: INPUT.systemInstruction },
      availableTools: [],
      tools: [],
      mcpServers: {},
      enableConfigDiscovery: false,
      enableFileHooks: false,
      enableSkills: false,
      skipCustomInstructions: true,
      enableSessionStore: false,
      infiniteSessions: { enabled: false },
    }));
    expect(mocks.createSession.mock.calls[0][0].onPermissionRequest()).toMatchObject({ kind: 'reject' });
    expect(mocks.sendAndWait).toHaveBeenCalledOnce();
    const prompt = mocks.sendAndWait.mock.calls[0][0].prompt;
    expect(prompt).toContain(JSON.stringify(INPUT.history));
    expect(prompt).toContain(INPUT.prompt);
    expect(mocks.deleteSession).toHaveBeenCalledExactlyOnceWith('flowpilot-temporary');
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(mocks.abort).not.toHaveBeenCalled();
  });

  it('passes images as blob attachments, never browser-controlled file paths', async () => {
    await createCopilotRuntime().generate({ ...INPUT, model: 'auto', image: 'data:image/png;base64,aGVsbG8=' }, vi.fn(), new AbortController().signal);
    expect(mocks.createSession.mock.calls[0][0].model).toBeUndefined();
    expect(mocks.sendAndWait.mock.calls[0][0].attachments).toEqual([{
      type: 'blob', mimeType: 'image/png', data: 'aGVsbG8=', displayName: 'Diagram reference',
    }]);
  });

  it('forwards only assistant text deltas', async () => {
    mocks.sendAndWait.mockImplementation(async () => {
      mocks.on.mock.calls[0][1]({ data: { deltaContent: 'flow: "Queue"' } });
      return { data: { content: 'flow: "Queue"' } };
    });
    const onChunk = vi.fn();
    await createCopilotRuntime().generate(INPUT, onChunk, new AbortController().signal);
    expect(mocks.on.mock.calls[0][0]).toBe('assistant.message_delta');
    expect(onChunk).toHaveBeenCalledExactlyOnceWith('flow: "Queue"');
  });

  it('aborts runtime work and deletes only its temporary session on cancellation', async () => {
    mocks.sendAndWait.mockReturnValue(new Promise(() => undefined));
    const controller = new AbortController();
    const result = createCopilotRuntime().generate(INPUT, vi.fn(), controller.signal);
    const rejected = expect(result).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(mocks.sendAndWait).toHaveBeenCalledOnce());
    controller.abort();
    await rejected;
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledExactlyOnceWith('flowpilot-temporary');
  });

  it('does not send a prompt when cancelled during session creation', async () => {
    const controller = new AbortController();
    mocks.createSession.mockImplementation(async () => {
      controller.abort();
      return { sessionId: 'flowpilot-temporary', abort: mocks.abort };
    });
    await expect(createCopilotRuntime().generate(INPUT, vi.fn(), controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.sendAndWait).not.toHaveBeenCalled();
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledOnce();
  });

  it('cancels authentication waits and frees request slots before the RPC completes', async () => {
    mocks.getAuthStatus.mockReturnValue(new Promise(() => undefined));
    const runtime = createCopilotRuntime();
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const request = runtime.generate(INPUT, vi.fn(), controller.signal);
      const rejected = expect(request).rejects.toMatchObject({ name: 'AbortError' });
      await vi.waitFor(() => expect(mocks.getAuthStatus).toHaveBeenCalledTimes(attempt + 1));
      controller.abort();
      await rejected;
    }
    expect(mocks.createSession).not.toHaveBeenCalled();
  });

  it('times out session creation and disposes a session that arrives after cancellation', async () => {
    vi.useFakeTimers();
    let complete!: (value: { sessionId: string; abort: typeof mocks.abort }) => void;
    mocks.createSession.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const request = createCopilotRuntime().generate(INPUT, vi.fn(), new AbortController().signal);
    const rejected = expect(request).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(180_000);
    await rejected;
    expect(mocks.sendAndWait).not.toHaveBeenCalled();

    complete({ sessionId: 'late-session', abort: mocks.abort });
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledExactlyOnceWith('late-session');
  });

  it('does not hang a completed response when session cleanup stops responding', async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    mocks.deleteSession.mockReturnValueOnce(new Promise(() => undefined));
    const request = createCopilotRuntime().generate(INPUT, vi.fn(), new AbortController().signal);
    const result = expect(request).resolves.toBe('flow: "Queue"');
    // AbortSignal.timeout uses native timers, independently of mocked setTimeout.
    vi.spyOn(AbortSignal, 'timeout').mockImplementation((milliseconds) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(new Error('Cleanup timed out')), milliseconds);
      return controller.signal;
    });
    await vi.advanceTimersByTimeAsync(5_000);
    await result;
    expect(error).toHaveBeenCalledWith('[Flowpilot] Could not remove the temporary Copilot session.', expect.any(Error));
  });

  it('cancels timed-out requests rather than merely stopping the wait', async () => {
    vi.useFakeTimers();
    mocks.sendAndWait.mockReturnValue(new Promise(() => undefined));
    const result = createCopilotRuntime().generate(INPUT, vi.fn(), new AbortController().signal);
    const rejected = expect(result).rejects.toMatchObject({ code: 'timeout' });
    await vi.advanceTimersByTimeAsync(180_000);
    await rejected;
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledOnce();
  });

  it('cleans up SDK failures and empty responses', async () => {
    const runtime = createCopilotRuntime();
    mocks.sendAndWait.mockRejectedValueOnce(new Error('Quota exceeded'));
    await expect(runtime.generate(INPUT, vi.fn(), new AbortController().signal)).rejects.toThrow('Quota exceeded');
    mocks.sendAndWait.mockResolvedValueOnce(undefined);
    await expect(runtime.generate(INPUT, vi.fn(), new AbortController().signal)).rejects.toMatchObject({ code: 'bad_response' });
    expect(mocks.abort).toHaveBeenCalledTimes(2);
    expect(mocks.deleteSession).toHaveBeenCalledTimes(2);
  });

  it('can retry runtime startup after a startup failure', async () => {
    mocks.start.mockRejectedValueOnce(new Error('Runtime unavailable'));
    const runtime = createCopilotRuntime();
    await expect(runtime.status()).rejects.toThrow('Runtime unavailable');
    expect(mocks.forceStop).toHaveBeenCalledOnce();
    await expect(runtime.status()).resolves.toMatchObject({ authenticated: true });
    expect(mocks.start).toHaveBeenCalledTimes(2);
  });

  it('stops its client and refuses further requests after shutdown', async () => {
    const runtime = createCopilotRuntime();
    await runtime.status();
    await runtime.stop();
    expect(mocks.stop).toHaveBeenCalledOnce();
    await expect(runtime.status()).rejects.toMatchObject({ code: 'runtime_unavailable' });
  });
});
