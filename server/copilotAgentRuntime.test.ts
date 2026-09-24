// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BuiltInTools, type SessionConfig } from '@github/copilot-sdk';
import { createCopilotClientOptions, createCopilotRuntime, type CopilotRuntime } from './copilotRuntime';
import type { AgentStart } from './copilotAgentRuntime';
import { FLOWPILOT_AGENT_SYSTEM_MESSAGE } from './flowpilotAgentPrompt';
import type { HostedIdentity } from './hosted/authSessions';
import { parseAgentClientMessage, parseAgentServerMessage, type AgentServerMessage } from '../src/services/copilot/agentProtocol';
import { AGENT_TOOL_NAMES, AGENT_TOOLS, ASK_USER_TOOL_NAME, agentToolJsonSchema } from '../src/services/copilot/agentTools';
import { CopilotRequestError } from '../src/services/copilot/protocol';

const mocks = vi.hoisted(() => ({
  construct: vi.fn(),
  start: vi.fn(),
  forceStop: vi.fn(),
  stop: vi.fn(),
  getAuthStatus: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getStatus: vi.fn(),
  send: vi.fn(),
  abort: vi.fn(),
}));

// The real SDK helpers (defineTool, BuiltInTools) with a fake client that never starts a CLI.
vi.mock('@github/copilot-sdk', async (importOriginal) => ({
  ...await importOriginal<typeof import('@github/copilot-sdk')>(),
  RuntimeConnection: { forStdio: () => ({ kind: 'stdio' }) },
  CopilotClient: class {
    constructor(options: unknown) { mocks.construct(options); }
    start = mocks.start;
    forceStop = mocks.forceStop;
    stop = mocks.stop;
    getAuthStatus = mocks.getAuthStatus;
    createSession = mocks.createSession;
    deleteSession = mocks.deleteSession;
    getStatus = mocks.getStatus;
  },
}));

type SessionEventHandler = (event: { type: string; data: Record<string, unknown> }) => void;

/** Stands in for the CLI agent loop: tests emit its events and call the tool and ask_user handlers it was given. */
function fakeSession(sessionId: string) {
  const handlers = new Set<SessionEventHandler>();
  return {
    sessionId,
    send: mocks.send,
    abort: mocks.abort,
    on: vi.fn((handler: SessionEventHandler) => {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    }),
    emit(type: string, data: Record<string, unknown> = {}) {
      for (const handler of [...handlers]) handler({ type, data });
    },
    get listeners() { return handlers.size; },
  };
}

const START: AgentStart = {
  v: 1,
  type: 'start',
  turnId: 'turn-1',
  prompt: 'Add a cache in front of the database',
  model: 'model-1',
  history: [{ role: 'assistant', content: 'Added the API and database.' }],
  canvas: { pageName: 'Checkout', nodeCount: 2, edgeCount: 1, selectedIds: ['db'] },
};
const HOSTED = { hosted: true as const, baseDirectory: '/tmp/test-flowpilot' };
const USER_ONE: HostedIdentity = { userId: '1', login: 'one', token: 'ghu_user_one', sessionKey: 'one' };
const USER_TWO: HostedIdentity = { userId: '2', login: 'two', token: 'ghu_user_two', sessionKey: 'two' };
const OPS = { ops: [{ op: 'add_node', id: 'cache', type: 'custom', label: 'Redis' }] };

let sessions: ReturnType<typeof fakeSession>[];
let invalidFrames: AgentServerMessage[];

function runTurn(options: { runtime?: CopilotRuntime; signal?: AbortSignal; identity?: HostedIdentity; start?: Partial<AgentStart> } = {}) {
  const messages: AgentServerMessage[] = [];
  const turn = (options.runtime ?? createCopilotRuntime()).agent!.startTurn({ ...START, ...options.start }, {
    send(message) {
      // Everything the runtime sends must pass the browser's parser.
      if (!parseAgentServerMessage(JSON.stringify(message))) invalidFrames.push(message);
      messages.push(message);
    },
  }, options.signal ?? new AbortController().signal, options.identity);
  return { turn, messages };
}

function config(index = 0): SessionConfig {
  return mocks.createSession.mock.calls[index][0];
}

function callTool(name: string, args: unknown, toolCallId: string, signal?: AbortSignal, index = 0): Promise<unknown> {
  const tool = config(index).tools!.find((candidate) => candidate.name === name)!;
  return Promise.resolve(tool.handler!(args, { sessionId: sessions[index].sessionId, toolCallId, toolName: name, arguments: args, signal }));
}

function ask(request: { question: string; choices?: string[]; allowFreeform?: boolean }) {
  return Promise.resolve(config().onUserInputRequest!(request, { sessionId: sessions[0].sessionId }));
}

async function sessionStarted(count = 1): Promise<void> {
  await vi.waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(count));
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  sessions = [];
  invalidFrames = [];
  mocks.start.mockResolvedValue(undefined);
  mocks.forceStop.mockResolvedValue(undefined);
  mocks.stop.mockResolvedValue([]);
  mocks.getAuthStatus.mockResolvedValue({ isAuthenticated: true, login: 'test-user' });
  mocks.getStatus.mockResolvedValue({ version: 'test' });
  mocks.deleteSession.mockResolvedValue(undefined);
  mocks.abort.mockResolvedValue(undefined);
  mocks.send.mockResolvedValue('message-1');
  mocks.createSession.mockImplementation(async () => {
    const session = fakeSession(`flowpilot-agent-${sessions.length + 1}`);
    sessions.push(session);
    return session;
  });
});

afterEach(() => {
  expect(invalidFrames).toEqual([]);
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Copilot agent runtime', () => {
  it('creates a locked-down session with only the OpenFlowKit tools and ask_user', async () => {
    const { turn, messages } = runTurn({ start: { image: 'data:image/png;base64,aGVsbG8=' } });
    await sessionStarted();
    const options = config();
    expect(options).toMatchObject({
      model: 'model-1',
      streaming: true,
      mcpServers: {},
      enableConfigDiscovery: false,
      enableFileHooks: false,
      enableSkills: false,
      skipCustomInstructions: true,
      enableSessionStore: false,
      infiniteSessions: { enabled: false },
      largeOutput: { enabled: false },
    });
    expect(options.availableTools).toEqual([
      'get_canvas', 'edit_canvas', 'find_icons', 'layout', 'review_architecture', 'list_templates', 'use_template', 'ask_user',
    ]);
    // ask_user is the SDK's session-isolated built-in; none of ours shadows a built-in.
    expect(BuiltInTools.Isolated).toContain(ASK_USER_TOOL_NAME);
    expect(AGENT_TOOL_NAMES.filter((name) => BuiltInTools.Isolated.includes(name))).toEqual([]);
    expect(options.tools!.map(({ handler: _handler, ...tool }) => tool)).toEqual(AGENT_TOOL_NAMES.map((name) => ({
      name, description: AGENT_TOOLS[name].description, parameters: agentToolJsonSchema(name), skipPermission: true, defer: 'never',
    })));
    expect(options.tools!.every((tool) => typeof tool.handler === 'function')).toBe(true);
    expect(typeof options.onUserInputRequest).toBe('function');
    expect(options.onPermissionRequest!({ kind: 'shell' } as never, { sessionId: 'flowpilot-agent-1' })).toMatchObject({ kind: 'reject' });
    // Local sessions use the CLI sign-in, never a token from the request.
    expect(options).not.toHaveProperty('gitHubToken');
    // Memory, embedding retrieval, host git and instruction discovery are off through the SDK's
    // empty-mode defaults, which apply to local sessions as well as hosted ones.
    expect(createCopilotClientOptions().mode).toBe('empty');

    // The system message is server-owned and keeps the SDK safety sections.
    expect(options.systemMessage).toBe(FLOWPILOT_AGENT_SYSTEM_MESSAGE);
    expect(FLOWPILOT_AGENT_SYSTEM_MESSAGE).toMatchObject({
      mode: 'customize', sections: { preamble: { action: 'replace' }, environment_context: { action: 'remove' } },
    });
    expect(FLOWPILOT_AGENT_SYSTEM_MESSAGE.sections).not.toHaveProperty('safety');
    expect(FLOWPILOT_AGENT_SYSTEM_MESSAGE.content).toContain('get_canvas');

    const [{ prompt, attachments }] = mocks.send.mock.calls[0];
    expect(prompt).toContain(JSON.stringify(START.history));
    expect(prompt).toContain(JSON.stringify(START.canvas));
    expect(prompt).toContain(START.prompt);
    expect(attachments).toEqual([{ type: 'blob', mimeType: 'image/png', data: 'aGVsbG8=', displayName: 'Diagram reference' }]);
    expect(messages).toEqual([{ v: 1, type: 'accepted', turnId: 'turn-1' }]);

    sessions[0].emit('session.idle');
    await turn.finished;
  });

  it('uses the requesting hosted user token and keeps sessions alive through a 10-minute question', async () => {
    expect(createCopilotClientOptions(HOSTED).sessionIdleTimeoutSeconds).toBe(900);
    const runtime = createCopilotRuntime(HOSTED);
    const first = runTurn({ runtime, identity: USER_ONE });
    await sessionStarted(1);
    const second = runTurn({ runtime, identity: USER_TWO, start: { model: 'auto' } });
    await sessionStarted(2);
    // SDK 1.0.14's gitHubTokenProvider leaves the session unauthenticated, so each session gets its user's token.
    expect(config(0)).not.toHaveProperty('gitHubTokenProvider');
    expect(config(1)).toMatchObject({ gitHubToken: 'ghu_user_two' });
    expect(config(0)).toMatchObject({
      gitHubToken: 'ghu_user_one',
      sessionId: expect.stringMatching(/^flowpilot-[0-9a-f-]{36}$/),
      enableHostGitOperations: false,
      enableOnDemandInstructionDiscovery: false,
      enableSessionTelemetry: false,
      skipEmbeddingRetrieval: true,
      embeddingCacheStorage: 'in-memory',
      memory: { enabled: false },
      systemMessage: FLOWPILOT_AGENT_SYSTEM_MESSAGE,
      availableTools: [...AGENT_TOOL_NAMES, ASK_USER_TOOL_NAME],
    });
    expect(config(1)).toMatchObject({ model: undefined });
    expect(config(0).sessionId).not.toBe(config(1).sessionId);
    expect(mocks.getAuthStatus).not.toHaveBeenCalled();
    for (const session of sessions) session.emit('session.idle');
    await Promise.all([first.turn.finished, second.turn.finished]);
  });

  it('relays tool calls to the browser and returns its results to the model', async () => {
    const { turn, messages } = runTurn();
    await sessionStarted();
    const session = sessions[0];

    session.emit('tool.execution_start', { toolCallId: 'call-1', toolName: 'edit_canvas' });
    const edit = callTool('edit_canvas', OPS, 'call-1');
    expect(messages.at(-1)).toEqual({ v: 1, type: 'tool_call', callId: 'call-1', name: 'edit_canvas', args: OPS });
    turn.receive({ v: 1, type: 'tool_result', callId: 'unknown', ok: true, result: 'ignored' });
    turn.receive({ v: 1, type: 'tool_result', callId: 'call-1', ok: true, result: { applied: 1, idMap: {} } });
    await expect(edit).resolves.toEqual({ textResultForLlm: '{"applied":1,"idMap":{}}', resultType: 'success' });
    session.emit('tool.execution_complete', { toolCallId: 'call-1', success: true });

    const icons = callTool('find_icons', { query: 'redis' }, 'call-2');
    turn.receive({ v: 1, type: 'tool_result', callId: 'call-2', ok: true, result: '[]' });
    await expect(icons).resolves.toEqual({ textResultForLlm: '[]', resultType: 'success' });

    session.emit('tool.execution_start', { toolCallId: 'call-3', toolName: 'edit_canvas' });
    const invalid = callTool('edit_canvas', OPS, 'call-3');
    turn.receive({ v: 1, type: 'tool_result', callId: 'call-3', ok: false, error: 'Unknown node "db".' });
    await expect(invalid).resolves.toEqual({ textResultForLlm: 'Unknown node "db".', resultType: 'failure' });
    session.emit('tool.execution_complete', { toolCallId: 'call-3', success: false });

    const layout = callTool('layout', { scope: 'all' }, 'call-4');
    turn.receive({ v: 1, type: 'tool_result', callId: 'call-4', ok: false, error: 'The user declined.', resultType: 'rejected' });
    await expect(layout).resolves.toEqual({ textResultForLlm: 'The user declined.', resultType: 'rejected' });

    // The runtime can cancel a single call; the turn carries on.
    const cancelled = new AbortController();
    const review = callTool('review_architecture', {}, 'call-5', cancelled.signal);
    cancelled.abort();
    await expect(review).rejects.toMatchObject({ name: 'AbortError' });

    // Steps are only reported for Flowpilot tools.
    session.emit('tool.execution_start', { toolCallId: 'call-6', toolName: 'report_intent' });
    session.emit('tool.execution_complete', { toolCallId: 'call-6', success: true });
    session.emit('session.idle');
    await turn.finished;

    expect(messages.filter((message) => message.type === 'step')).toEqual([
      { v: 1, type: 'step', callId: 'call-1', name: 'edit_canvas', status: 'started' },
      { v: 1, type: 'step', callId: 'call-1', name: 'edit_canvas', status: 'succeeded' },
      { v: 1, type: 'step', callId: 'call-3', name: 'edit_canvas', status: 'started' },
      { v: 1, type: 'step', callId: 'call-3', name: 'edit_canvas', status: 'failed' },
    ]);
    expect(messages.at(-1)).toEqual({ v: 1, type: 'done', reply: '' });
  });

  it('fails a tool call whose result is too deeply nested to serialize, and the turn carries on', async () => {
    const { turn, messages } = runTurn();
    await sessionStarted();
    const edit = callTool('edit_canvas', OPS, 'call-1');
    // Within the 1 MiB frame limit, but deep enough to overflow a recursive JSON.stringify.
    const depth = 150_000;
    const frame = parseAgentClientMessage(`{"v":1,"type":"tool_result","callId":"call-1","ok":true,"result":${'{"a":'.repeat(depth)}{}${'}'.repeat(depth)}}`);
    expect(frame).not.toBeNull();
    expect(() => turn.receive(frame!)).not.toThrow();
    await expect(edit).resolves.toEqual({ textResultForLlm: 'The browser sent a tool result that could not be read.', resultType: 'failure' });
    sessions[0].emit('session.idle');
    await turn.finished;
    expect(messages.at(-1)).toEqual({ v: 1, type: 'done', reply: '' });
  });

  it('streams the reply, separating assistant messages, and never forwards reasoning', async () => {
    const { turn, messages } = runTurn();
    await sessionStarted();
    const session = sessions[0];
    session.emit('assistant.message_delta', { messageId: 'm1', deltaContent: 'Adding a cache.' });
    session.emit('assistant.reasoning_delta', { reasoningId: 'r1', deltaContent: 'secret reasoning' });
    session.emit('assistant.reasoning', { reasoningId: 'r1', content: 'secret reasoning' });
    session.emit('assistant.message', { messageId: 'm1', content: 'Adding a cache.', reasoningText: 'secret reasoning' });
    session.emit('assistant.message_delta', { messageId: 'm2', deltaContent: 'Done.' });
    session.emit('assistant.message_delta', { messageId: 'm2', deltaContent: ' Redis sits in front of the database.' });
    session.emit('session.idle');
    await turn.finished;

    expect(messages.slice(1)).toEqual([
      { v: 1, type: 'reply_delta', text: 'Adding a cache.' },
      { v: 1, type: 'reply_delta', text: '\n\nDone.' },
      { v: 1, type: 'reply_delta', text: ' Redis sits in front of the database.' },
      { v: 1, type: 'done', reply: 'Adding a cache.\n\nDone. Redis sits in front of the database.' },
    ]);
    expect(JSON.stringify(messages)).not.toContain('secret');
    expect(session.listeners).toBe(0);
    expect(mocks.abort).not.toHaveBeenCalled();
    expect(mocks.deleteSession).toHaveBeenCalledExactlyOnceWith('flowpilot-agent-1');
  });

  it('maps session errors, without content in hosted mode', async () => {
    const hosted = runTurn({ runtime: createCopilotRuntime(HOSTED), identity: USER_ONE });
    await sessionStarted(1);
    const local = runTurn();
    await sessionStarted(2);
    sessions[0].emit('session.error', { errorType: 'quota', message: 'Quota exceeded for ghu_user_one: "Add a cache"' });
    sessions[1].emit('session.error', { errorType: 'query', message: 'Model overloaded' });
    await Promise.all([hosted.turn.finished, local.turn.finished]);

    expect(hosted.messages.at(-1)).toMatchObject({ type: 'error', code: 'quota_exceeded' });
    expect(JSON.stringify(hosted.messages)).not.toContain('ghu_');
    expect(local.messages.at(-1)).toMatchObject({ type: 'error', code: 'request_failed', message: expect.stringContaining('Model overloaded') });
    expect(console.error).toHaveBeenCalledWith('[Flowpilot hosted] Copilot agent turn failed:', 'quota_exceeded');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('ghu_');
    expect(mocks.abort).toHaveBeenCalledTimes(2);
    expect(mocks.deleteSession).toHaveBeenCalledTimes(2);
  });

  it('maps session errors by their type, and says a failed hosted turn keeps its changes', async () => {
    const runtime = createCopilotRuntime(HOSTED);
    const denied = runTurn({ runtime, identity: USER_ONE });
    await sessionStarted(1);
    const limited = runTurn({ runtime, identity: USER_TWO });
    await sessionStarted(2);
    const failed = runTurn({ runtime, identity: { ...USER_TWO, userId: '3', token: 'ghu_user_three', sessionKey: 'three' } });
    await sessionStarted(3);
    const tooLong = runTurn();
    await sessionStarted(4);
    sessions[0].emit('session.error', { errorType: 'authorization', message: 'Policy blocks ghu_user_one' });
    sessions[1].emit('session.error', { errorType: 'rate_limit', message: 'Slow down', statusCode: 429 });
    sessions[2].emit('session.error', { errorType: 'query', message: 'Model overloaded' });
    sessions[3].emit('session.error', { errorType: 'context_limit', message: 'Prompt is 200000 tokens' });
    await Promise.all([denied.turn.finished, limited.turn.finished, failed.turn.finished, tooLong.turn.finished]);

    expect(denied.messages.at(-1)).toMatchObject({ type: 'error', code: 'copilot_access_denied' });
    expect(limited.messages.at(-1)).toMatchObject({ type: 'error', code: 'quota_exceeded' });
    expect(failed.messages.at(-1)).toEqual({
      v: 1,
      type: 'error',
      code: 'request_failed',
      message: 'Copilot could not finish this turn. Changes made so far stay on the canvas; check your connection and retry.',
    });
    expect(tooLong.messages.at(-1)).toMatchObject({ type: 'error', code: 'request_failed', message: expect.stringContaining('too long for the model') });
    expect(JSON.stringify([denied.messages, failed.messages])).not.toContain('ghu_');
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toMatch(/ghu_|Policy|overloaded/);
  });

  it('says no changes were applied when a hosted turn fails before the prompt is sent', async () => {
    mocks.createSession.mockRejectedValueOnce(new Error('session.create failed for ghu_user_one'));
    const { turn, messages } = runTurn({ runtime: createCopilotRuntime(HOSTED), identity: USER_ONE });
    await turn.finished;

    expect(messages.at(-1)).toEqual({
      v: 1,
      type: 'error',
      code: 'request_failed',
      message: 'Copilot could not complete the request. Check your connection and retry; no changes were applied.',
    });
    expect(mocks.send).not.toHaveBeenCalled();
    expect(JSON.stringify([messages, vi.mocked(console.error).mock.calls])).not.toContain('ghu_');
  });

  it('pauses on ask_user and resumes with the answer', async () => {
    const { turn, messages } = runTurn();
    await sessionStarted();
    sessions[0].emit('tool.execution_start', { toolCallId: 'ask-1', toolName: 'ask_user' });
    const answer = ask({ question: 'Which cloud should this run on?', choices: ['Azure', 'AWS'] });
    const question = messages.at(-1) as Extract<AgentServerMessage, { type: 'question' }>;
    expect(question).toEqual({
      v: 1, type: 'question', questionId: expect.any(String), question: 'Which cloud should this run on?', choices: ['Azure', 'AWS'], allowFreeform: true,
    });
    expect(messages.at(-2)).toEqual({ v: 1, type: 'step', callId: 'ask-1', name: 'ask_user', status: 'started' });

    turn.receive({ v: 1, type: 'answer', questionId: 'another-question', answer: 'GCP', wasFreeform: true });
    turn.receive({ v: 1, type: 'answer', questionId: question.questionId, answer: 'Azure', wasFreeform: false });
    await expect(answer).resolves.toEqual({ answer: 'Azure', wasFreeform: false });

    // Questions the browser would drop go back to the model as an error instead.
    const count = messages.length;
    await expect(ask({ question: 'Pick one', choices: Array.from({ length: 51 }, (_, index) => `Option ${index}`) }))
      .rejects.toThrow('Ask one question');
    expect(messages).toHaveLength(count);

    sessions[0].emit('session.idle');
    await turn.finished;
    expect(messages.at(-1)).toEqual({ v: 1, type: 'done', reply: '' });
  });

  it('ends a question unanswered for 10 minutes and keeps the reply so far', async () => {
    vi.useFakeTimers();
    const { turn, messages } = runTurn();
    await sessionStarted();
    sessions[0].emit('assistant.message_delta', { messageId: 'm1', deltaContent: 'One question first.' });
    const answer = ask({ question: 'Which cloud?' });
    const unanswered = expect(answer).rejects.toThrow();
    const { questionId } = messages.at(-1) as Extract<AgentServerMessage, { type: 'question' }>;

    await vi.advanceTimersByTimeAsync(10 * 60_000 - 1);
    expect(messages.at(-1)?.type).toBe('question');
    await vi.advanceTimersByTimeAsync(1);
    await turn.finished;
    await unanswered;

    expect(messages.slice(-2)).toEqual([
      { v: 1, type: 'question_expired', questionId },
      { v: 1, type: 'done', reply: 'One question first.' },
    ]);
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledOnce();
    turn.receive({ v: 1, type: 'answer', questionId, answer: 'Azure', wasFreeform: true });
    expect(messages.at(-1)?.type).toBe('done');
  });

  it('stops on cancel, keeping the reply so far, and sends nothing afterwards', async () => {
    const { turn, messages } = runTurn();
    await sessionStarted();
    const session = sessions[0];
    const handler = session.on.mock.calls[0][0];
    session.emit('assistant.message_delta', { messageId: 'm1', deltaContent: 'Working on it.' });
    const edit = callTool('edit_canvas', OPS, 'call-1');
    const stopped = expect(edit).rejects.toMatchObject({ name: 'AbortError' });

    turn.receive({ v: 1, type: 'cancel' });
    await turn.finished;
    await stopped;
    expect(messages.at(-1)).toEqual({ v: 1, type: 'done', reply: 'Working on it.' });
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledOnce();

    const count = messages.length;
    handler({ type: 'assistant.message_delta', data: { messageId: 'm1', deltaContent: 'late' } });
    handler({ type: 'tool.execution_start', data: { toolCallId: 'call-2', toolName: 'edit_canvas' } });
    await expect(callTool('edit_canvas', OPS, 'call-2')).rejects.toMatchObject({ name: 'AbortError' });
    await expect(ask({ question: 'Still there?' })).rejects.toMatchObject({ name: 'AbortError' });
    turn.receive({ v: 1, type: 'tool_result', callId: 'call-1', ok: true, result: 'late' });
    turn.receive({ v: 1, type: 'cancel' });
    expect(messages).toHaveLength(count);
  });

  it('ends with the reason the connection gave, or as interrupted', async () => {
    const disconnected = new AbortController();
    const closed = new AbortController();
    const first = runTurn({ signal: disconnected.signal });
    const second = runTurn({ signal: closed.signal });
    await sessionStarted(2);
    disconnected.abort(new CopilotRequestError('not_authenticated', 'Your GitHub connection ended. Connect again to continue.', 401));
    closed.abort();
    await Promise.all([first.turn.finished, second.turn.finished]);

    expect(first.messages.at(-1)).toEqual({
      v: 1, type: 'error', code: 'not_authenticated', message: 'Your GitHub connection ended. Connect again to continue.',
    });
    expect(second.messages.at(-1)).toMatchObject({ type: 'error', code: 'interrupted' });
    expect(mocks.abort).toHaveBeenCalledTimes(2);
    expect(mocks.deleteSession).toHaveBeenCalledTimes(2);
    // The connection owner already knows why it ended the turn.
    expect(console.error).not.toHaveBeenCalled();
  });

  it('interrupts turns on shutdown and when a hosted user disconnects GitHub', async () => {
    const local = createCopilotRuntime();
    const shutdown = runTurn({ runtime: local });
    await sessionStarted(1);
    const hosted = createCopilotRuntime(HOSTED);
    const disconnect = runTurn({ runtime: hosted, identity: USER_ONE });
    await sessionStarted(2);
    const other = runTurn({ runtime: hosted, identity: USER_TWO });
    await sessionStarted(3);

    hosted.cancelConnection!('one');
    await disconnect.turn.finished;
    expect(disconnect.messages.at(-1)).toMatchObject({ type: 'error', code: 'not_authenticated' });

    await local.stop();
    await shutdown.turn.finished;
    expect(shutdown.messages.at(-1)).toMatchObject({ type: 'error', code: 'interrupted' });
    expect(other.messages.at(-1)?.type).toBe('accepted');
    sessions[2].emit('session.idle');
    await other.turn.finished;
  });

  it('refuses turns without a hosted identity, beyond two local turns, or when signed out locally', async () => {
    const anonymous = runTurn({ runtime: createCopilotRuntime(HOSTED) });
    await anonymous.turn.finished;
    expect(anonymous.messages).toEqual([{ v: 1, type: 'error', code: 'not_authenticated', message: expect.stringContaining('Connect GitHub') }]);
    expect(mocks.start).not.toHaveBeenCalled();

    const runtime = createCopilotRuntime();
    const running = [runTurn({ runtime }), runTurn({ runtime })];
    const busy = runTurn({ runtime });
    await busy.turn.finished;
    expect(busy.messages).toEqual([{ v: 1, type: 'error', code: 'busy', message: expect.any(String) }]);
    await sessionStarted(2);
    for (const { turn } of running) turn.receive({ v: 1, type: 'cancel' });
    await Promise.all(running.map(({ turn }) => turn.finished));

    mocks.getAuthStatus.mockResolvedValue({ isAuthenticated: false });
    const signedOut = runTurn({ runtime });
    await signedOut.turn.finished;
    expect(signedOut.messages.at(-1)).toMatchObject({ type: 'error', code: 'not_authenticated', message: expect.stringContaining('gh copilot login') });
    expect(mocks.createSession).toHaveBeenCalledTimes(2);
  });

  it('bounds session setup and disposes a session that arrives late', async () => {
    vi.useFakeTimers();
    let complete!: (session: ReturnType<typeof fakeSession>) => void;
    mocks.createSession.mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
    const { turn, messages } = runTurn();
    await vi.advanceTimersByTimeAsync(60_000);
    await turn.finished;
    expect(messages).toEqual([
      { v: 1, type: 'accepted', turnId: 'turn-1' },
      { v: 1, type: 'error', code: 'timeout', message: expect.any(String) },
    ]);

    complete(fakeSession('late-session'));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.abort).toHaveBeenCalledOnce();
    expect(mocks.deleteSession).toHaveBeenCalledExactlyOnceWith('late-session');
  });

  it('fails closed when hosted cleanup fails, interrupting other turns', async () => {
    mocks.deleteSession.mockRejectedValueOnce(new Error('cleanup containing sensitive prompt'));
    const runtime = createCopilotRuntime(HOSTED);
    const failing = runTurn({ runtime, identity: USER_ONE });
    await sessionStarted(1);
    const other = runTurn({ runtime, identity: USER_TWO });
    await sessionStarted(2);
    sessions[0].emit('assistant.message_delta', { messageId: 'm1', deltaContent: 'Added a cache.' });
    sessions[0].emit('session.idle');
    await Promise.all([failing.turn.finished, other.turn.finished]);

    expect(failing.messages.at(-1)).toEqual({ v: 1, type: 'done', reply: 'Added a cache.' });
    expect(other.messages.at(-1)).toMatchObject({ type: 'error', code: 'interrupted' });
    expect(mocks.forceStop).toHaveBeenCalledOnce();
    await expect(runtime.ready?.()).rejects.toMatchObject({ code: 'runtime_unavailable' });
    // A later turn never started, so there is nothing to continue; it can be retried once the runtime is back.
    const later = runTurn({ runtime, identity: USER_ONE });
    await later.turn.finished;
    expect(later.messages).toEqual([{
      v: 1, type: 'error', code: 'runtime_unavailable', message: 'The hosted Copilot runtime is restarting. Please retry shortly.',
    }]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain('sensitive prompt');
  });

  it('ends the turn and never rejects when the transport fails', async () => {
    const turn = createCopilotRuntime().agent!.startTurn(START, {
      send() { throw new Error('socket closed'); },
    }, new AbortController().signal);
    await expect(turn.finished).resolves.toBeUndefined();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('shares one Copilot client with one-shot requests', async () => {
    const runtime = createCopilotRuntime();
    await runtime.ready?.();
    const { turn } = runTurn({ runtime });
    await sessionStarted();
    sessions[0].emit('session.idle');
    await turn.finished;
    expect(mocks.construct).toHaveBeenCalledOnce();
    expect(mocks.start).toHaveBeenCalledOnce();
  });
});
