import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '@/lib/types';
import { composeDiagramForDisplay } from '@/services/composeDiagramForDisplay';
import {
  startAgentTurn,
  type AgentTurnConnection,
  type AgentTurnEnd,
  type AgentTurnEvent,
  type AgentTurnHandlers,
  type AgentTurnStart,
} from '@/services/copilot/agentClient';
import { AGENT_INVALID_START_MESSAGE } from '@/services/copilot/agentProtocol';
import { CopilotRequestError } from '@/services/copilot/protocol';
import { createErrorThreadItem } from '@/services/flowpilot/thread';
import type { AssistantThreadItem } from '@/services/flowpilot/types';
import { useFlowStore } from '@/store';
import { saveAssistantThreadItem } from './chatHistoryStorage';
import { useFlowpilotAgent } from './useFlowpilotAgent';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/components/ui/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/services/copilot/agentClient', () => ({ startAgentTurn: vi.fn() }));
vi.mock('./chatHistoryStorage', () => ({ saveAssistantThreadItem: vi.fn() }));
vi.mock('@/services/composeDiagramForDisplay', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/services/composeDiagramForDisplay')>();
  return { ...actual, composeDiagramForDisplay: vi.fn(actual.composeDiagramForDisplay) };
});

const INITIAL: FlowNode[] = [
  { id: 'api', type: 'process', data: { label: 'Orders API' }, position: { x: 10, y: 20 } },
  { id: 'cache', type: 'process', data: { label: 'Redis' }, position: { x: 200, y: 20 } },
];
const ADD_DATABASE = { ops: [{ op: 'add_node', id: 'db', type: 'process', label: 'Orders DB' }] };
const CLEAR_CANVAS = { ops: [{ op: 'remove_node', id: 'api' }, { op: 'remove_node', id: 'cache' }] };

interface FakeTurn {
  start: AgentTurnStart;
  handlers: AgentTurnHandlers;
  connection: { [K in keyof AgentTurnConnection]: ReturnType<typeof vi.fn> };
}

const turns: FakeTurn[] = [];
const onError = vi.fn();

function useHarness(initialThread: AssistantThreadItem[]) {
  const [thread, setThread] = useState(initialThread);
  const pageId = useFlowStore((state) => state.activeTabId);
  const agent = useFlowpilotAgent({ pageId, model: '', thread, updateThread: setThread, blockedReason: null, onError });
  return { ...agent, thread };
}

function setup(thread: AssistantThreadItem[] = []) {
  return renderHook(() => useHarness(thread));
}

function lastTurn(): FakeTurn {
  const turn = turns.at(-1);
  if (!turn) throw new Error('No turn started.');
  return turn;
}

function emit(event: AgentTurnEvent): void {
  act(() => lastTurn().handlers.onEvent(event));
}

function toolCall(callId: string, name: string, args: unknown): AgentTurnEvent {
  return { v: 1, type: 'tool_call', callId, name, args } as AgentTurnEvent;
}

async function end(request: Promise<boolean>, result: AgentTurnEnd): Promise<boolean> {
  let ok = false;
  await act(async () => {
    lastTurn().handlers.onEnd(result);
    ok = await request;
  });
  return ok;
}

type Harness = ReturnType<typeof setup>['result'];

function send(result: Harness, prompt: string): Promise<boolean> {
  let request!: Promise<boolean>;
  act(() => { request = result.current.send(prompt); });
  return request;
}

function labels(): string[] {
  return useFlowStore.getState().nodes.map((node) => String(node.data.label));
}

beforeEach(() => {
  vi.resetAllMocks();
  turns.length = 0;
  useFlowStore.setState({ documents: [], tabs: [], nodes: [], edges: [], agentTurn: null });
  useFlowStore.getState().createDocument();
  useFlowStore.getState().setNodes(INITIAL);
  vi.mocked(saveAssistantThreadItem).mockResolvedValue(undefined);
  vi.mocked(startAgentTurn).mockImplementation((start, handlers) => {
    const connection = { sendToolResult: vi.fn(), answer: vi.fn(), cancel: vi.fn(), close: vi.fn() };
    turns.push({ start, handlers, connection });
    return connection;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useFlowpilotAgent', () => {
  it('edits the canvas live and saves the turn to the thread when it ends', async () => {
    const { result } = setup();
    const request = send(result, 'Add a database.');
    const pageId = useFlowStore.getState().activeTabId;

    expect(lastTurn().start).toMatchObject({
      prompt: 'Add a database.',
      model: 'auto',
      history: [],
      canvas: { nodeCount: 2, edgeCount: 0, selectedIds: [] },
    });
    expect(useFlowStore.getState().agentTurn).toEqual({ turnId: lastTurn().start.turnId, pageId });
    expect(result.current.isRunning).toBe(true);

    emit({ v: 1, type: 'reply_delta', text: 'Adding ' });
    emit({ v: 1, type: 'step', callId: 'call-1', name: 'edit_canvas', status: 'started' });
    emit(toolCall('call-1', 'edit_canvas', ADD_DATABASE));
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledOnce());
    expect(lastTurn().connection.sendToolResult).toHaveBeenCalledWith('call-1', expect.objectContaining({ ok: true }));
    expect(labels()).toContain('Orders DB');
    emit({ v: 1, type: 'step', callId: 'call-1', name: 'edit_canvas', status: 'succeeded' });
    emit({ v: 1, type: 'reply_delta', text: 'the database.' });

    expect(result.current.liveItem).toMatchObject({
      content: 'Adding the database.',
      agentTurn: { status: 'running', steps: [{ callId: 'call-1', status: 'succeeded' }] },
    });
    // Only the user's message is saved while the turn runs.
    expect(result.current.thread.map((item) => item.type)).toEqual(['user_message']);

    expect(await end(request, { type: 'done', reply: 'Added the Orders DB node.' })).toBe(true);
    const turn = result.current.thread[1];
    expect(turn).toMatchObject({
      type: 'assistant_agent_turn',
      content: 'Added the Orders DB node.',
      changes: { addedCount: 1, totalChanges: 1 },
      agentTurn: { status: 'done' },
    });
    expect(result.current.liveItem).toBeNull();
    expect(result.current.isRunning).toBe(false);
    expect(useFlowStore.getState().agentTurn).toBeNull();

    const next = send(result, 'Now label it.');
    expect(lastTurn().start.history).toEqual([
      { role: 'user', content: 'Add a database.' },
      { role: 'assistant', content: 'Added the Orders DB node.\n[Canvas changes this turn: added node "Orders DB"]' },
    ]);
    await end(next, { type: 'done', reply: '' });
  });

  it('runs tool calls one at a time and asks before a removal, saving the question', async () => {
    const { result } = setup();
    const request = send(result, 'Start over.');
    emit(toolCall('call-1', 'edit_canvas', CLEAR_CANVAS));
    emit(toolCall('call-2', 'get_canvas', {}));

    await waitFor(() => expect(result.current.liveItem?.agentTurn?.status).toBe('waiting'));
    const [question] = result.current.liveItem?.agentTurn?.questions ?? [];
    expect(question).toMatchObject({
      kind: 'confirm', status: 'waiting', clearsCanvas: true, removedLabels: ['Orders API', 'Redis'], removedCount: 2,
    });
    expect(result.current.thread.at(-1)?.agentTurn?.status).toBe('waiting');
    expect(lastTurn().connection.sendToolResult).not.toHaveBeenCalled();

    await act(async () => { await result.current.controls.confirm(question.id, false, ''); });
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledTimes(2));
    const results = lastTurn().connection.sendToolResult.mock.calls;
    expect(results[0]).toEqual(['call-1', { ok: false, error: 'User declined removing "Orders API", "Redis". Nothing was changed.' }]);
    expect(results[1]).toEqual(['call-2', expect.objectContaining({ ok: true, result: expect.objectContaining({ nodeCount: 2 }) })]);
    expect(result.current.liveItem?.agentTurn).toMatchObject({ status: 'running', questions: [{ status: 'answered', approved: false }] });
    // Saved too, so a reload before the turn ends does not offer the decision again.
    expect(result.current.thread.at(-1)?.agentTurn?.questions[0]).toMatchObject({ status: 'answered', approved: false });

    await end(request, { type: 'done', reply: 'Kept everything.' });
    expect(labels()).toEqual(['Orders API', 'Redis']);
  });

  it('applies a removal the user approves', async () => {
    const { result } = setup();
    const request = send(result, 'Start over.');
    emit(toolCall('call-1', 'edit_canvas', CLEAR_CANVAS));
    await waitFor(() => expect(result.current.liveItem?.agentTurn?.status).toBe('waiting'));
    const [question] = result.current.liveItem?.agentTurn?.questions ?? [];

    await act(async () => { await result.current.controls.confirm(question.id, true, 'Go ahead.'); });
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledWith('call-1', expect.objectContaining({ ok: true })));
    expect(labels()).toEqual([]);
    expect(result.current.thread.at(-1)?.agentTurn?.questions[0]).toMatchObject({ status: 'answered', approved: true });
    await end(request, { type: 'done', reply: 'Cleared.' });
    expect(result.current.thread.at(-1)?.changes?.removedCount).toBe(2);
  });

  it('ends a removal nobody confirms after 10 minutes, and approving it later starts a new turn', async () => {
    vi.useFakeTimers();
    const { result } = setup();
    const request = send(result, 'Start over.');
    emit(toolCall('call-1', 'edit_canvas', CLEAR_CANVAS));
    emit(toolCall('call-2', 'edit_canvas', ADD_DATABASE));
    await act(() => vi.advanceTimersByTimeAsync(0));
    expect(result.current.liveItem?.agentTurn?.status).toBe('waiting');

    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(lastTurn().connection.cancel).toHaveBeenCalledOnce();
    expect(lastTurn().connection.sendToolResult).toHaveBeenCalledWith('call-1', { ok: false, error: expect.stringContaining('User declined removing') });
    // The call queued behind it no longer edits the canvas either.
    expect(lastTurn().connection.sendToolResult).toHaveBeenCalledWith('call-2', {
      ok: false, error: 'A removal was not confirmed in time, so this turn ended.', resultType: 'rejected',
    });
    await end(request, { type: 'done', reply: '' });
    const saved = result.current.thread.at(-1)?.agentTurn;
    expect(saved?.status).toBe('done');
    expect(saved?.questions[0].status).toBe('expired');
    expect(labels()).toEqual(['Orders API', 'Redis']);

    act(() => { void result.current.controls.confirm(saved?.questions[0].id ?? '', true, 'Go ahead with the removal.'); });
    expect(turns).toHaveLength(2);
    expect(lastTurn().start.prompt).toContain('your earlier edit to clear the canvas ("Orders API", "Redis") was not applied');
    expect(result.current.thread.find((item) => item.agentTurn)?.agentTurn?.questions[0]).toMatchObject({ status: 'answered', approved: true });
    expect(result.current.thread.at(-1)).toMatchObject({ type: 'user_message', content: 'Go ahead with the removal.' });
  });

  it('closes a question asked alongside a removal nobody confirms, so an answer waits for the turn to end', async () => {
    vi.useFakeTimers();
    const { result } = setup();
    const request = send(result, 'Start over.');
    emit(toolCall('call-1', 'edit_canvas', CLEAR_CANVAS));
    emit({ v: 1, type: 'question', questionId: 'q-1', question: 'Which cloud?', allowFreeform: true });
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000));
    expect(lastTurn().connection.cancel).toHaveBeenCalledOnce();
    expect(result.current.liveItem?.agentTurn?.questions.map((question) => [question.kind, question.status])).toEqual([
      ['question', 'closed'], ['confirm', 'expired'],
    ]);

    await act(async () => { expect(await result.current.controls.answer('q-1', 'Azure', true)).toBe(false); });
    expect(lastTurn().connection.answer).not.toHaveBeenCalled();
    await end(request, { type: 'done', reply: '' });
    expect(result.current.thread.at(-1)?.agentTurn?.questions[0]).toMatchObject({ id: 'q-1', status: 'closed' });

    act(() => { void result.current.controls.answer('q-1', 'Azure', true); });
    expect(turns).toHaveLength(2);
    expect(lastTurn().start.prompt).toMatch(/earlier question "Which cloud\?", which was still open when that turn ended/);
  });

  it('names an ended turn, not a timeout, when a removal it left open is approved later', async () => {
    const { result } = setup();
    const request = send(result, 'Start over.');
    emit(toolCall('call-1', 'edit_canvas', CLEAR_CANVAS));
    await waitFor(() => expect(result.current.liveItem?.agentTurn?.status).toBe('waiting'));
    await end(request, { type: 'interrupted' });
    const saved = result.current.thread.at(-1)?.agentTurn;
    expect(saved?.questions[0].status).toBe('closed');

    act(() => { void result.current.controls.confirm(saved?.questions[0].id ?? '', true, 'Go ahead with the removal.'); });
    expect(lastTurn().start.prompt).toContain('was not applied because the turn ended before the user confirmed it.');
  });

  it('keeps nodes from an expired removal without starting a turn', async () => {
    const expired: AssistantThreadItem = {
      id: 'turn-1', type: 'assistant_agent_turn', role: 'model', content: '', createdAt: '2026-09-22T10:00:00Z',
      agentTurn: {
        status: 'interrupted', steps: [],
        questions: [{ kind: 'confirm', id: 'confirm-1', status: 'expired', removedLabels: ['Redis'], removedCount: 1, clearsCanvas: false }],
      },
    };
    const { result } = setup([expired]);
    await act(async () => { expect(await result.current.controls.confirm('confirm-1', false, '')).toBe(true); });
    expect(startAgentTurn).not.toHaveBeenCalled();
    expect(result.current.thread[0].agentTurn?.questions[0]).toMatchObject({ status: 'answered', approved: false });
  });

  it('answers a question in the turn, and an answer after it expired starts a new turn', async () => {
    const { result } = setup();
    const request = send(result, 'Draw our cloud setup.');
    emit({ v: 1, type: 'question', questionId: 'q-1', question: 'Which cloud?', choices: ['Azure', 'AWS'], allowFreeform: false });
    expect(result.current.thread.at(-1)?.agentTurn?.questions[0]).toMatchObject({ id: 'q-1', status: 'waiting' });

    await act(async () => { await result.current.controls.answer('q-1', ' Azure ', false); });
    expect(lastTurn().connection.answer).toHaveBeenCalledWith('q-1', 'Azure', false);
    expect(result.current.liveItem?.agentTurn).toMatchObject({ status: 'running', questions: [{ status: 'answered', answer: 'Azure' }] });
    // Saved too, so a reload before the turn ends does not offer the question again.
    expect(result.current.thread.at(-1)?.agentTurn?.questions[0]).toMatchObject({ status: 'answered', answer: 'Azure' });

    emit({ v: 1, type: 'question', questionId: 'q-2', question: 'Which region?', allowFreeform: true });
    emit({ v: 1, type: 'question_expired', questionId: 'q-2' });
    await end(request, { type: 'done', reply: '' });
    expect(result.current.thread.at(-1)?.agentTurn?.questions.map((question) => question.status)).toEqual(['answered', 'expired']);

    let late!: Promise<boolean>;
    act(() => { late = result.current.controls.answer('q-2', 'West Europe', true); });
    expect(turns).toHaveLength(2);
    expect(lastTurn().start.prompt).toBe(
      '[Flowpilot context note: this answers your earlier question "Which region?", which expired before the user replied. Check the current canvas and continue from there.]\n\nWest Europe'
    );
    expect(result.current.thread.find((item) => item.agentTurn)?.agentTurn?.questions[1]).toMatchObject({ status: 'answered', answer: 'West Europe' });

    // Later turns replay both answers with the questions they answer, not just the bare late reply.
    await end(late, { type: 'done', reply: 'Moved it to West Europe.' });
    const next = send(result, 'Add a cache.');
    expect(lastTurn().start.history[1]).toEqual({
      role: 'assistant',
      content: '\n[Canvas changes this turn: none]\n'
        + '[Questions this turn: asked "Which cloud?" and the user answered "Azure"; asked "Which region?" and the user answered "West Europe"]',
    });
    await end(next, { type: 'done', reply: '' });
  });

  it('lets an answer sent as its question expired start a new turn', async () => {
    const { result } = setup();
    const request = send(result, 'Draw our cloud setup.');
    emit({ v: 1, type: 'question', questionId: 'q-1', question: 'Which cloud?', allowFreeform: true });
    await act(async () => { await result.current.controls.answer('q-1', 'Azure', true); });
    emit({ v: 1, type: 'question_expired', questionId: 'q-1' });
    await end(request, { type: 'done', reply: '' });
    expect(result.current.thread.at(-1)?.agentTurn?.questions[0]).toMatchObject({ status: 'expired' });

    act(() => { void result.current.controls.answer('q-1', 'Azure', true); });
    expect(turns).toHaveLength(2);
    expect(lastTurn().start.prompt).toMatch(/earlier question "Which cloud\?".*\n\nAzure$/);
  });

  it('closes a question left open when the turn ends early, and an answer then names the ended turn', async () => {
    const { result } = setup();
    const request = send(result, 'Draw our cloud setup.');
    emit({ v: 1, type: 'question', questionId: 'q-1', question: 'Which cloud?', allowFreeform: true });
    act(() => result.current.stop());
    // The server drops answers once the turn is stopping, so the question closes right away.
    expect(result.current.liveItem?.agentTurn?.questions[0]).toMatchObject({ status: 'closed' });
    await act(async () => { expect(await result.current.controls.answer('q-1', 'Azure', true)).toBe(false); });
    expect(lastTurn().connection.answer).not.toHaveBeenCalled();
    await end(request, { type: 'done', reply: '' });
    expect(result.current.thread.at(-1)?.agentTurn).toMatchObject({ status: 'stopped', questions: [{ status: 'closed' }] });

    act(() => { void result.current.controls.answer('q-1', 'Azure', true); });
    expect(lastTurn().start.prompt).toBe(
      '[Flowpilot context note: this answers your earlier question "Which cloud?", which was still open when that turn ended. Check the current canvas and continue from there.]\n\nAzure'
    );
  });

  it('closes a question that arrives after Stop, so an answer waits for the turn to end and starts a new one', async () => {
    const { result } = setup();
    const request = send(result, 'Draw our cloud setup.');
    act(() => result.current.stop());
    emit({ v: 1, type: 'question', questionId: 'q-1', question: 'Which cloud?', allowFreeform: true });
    expect(result.current.liveItem?.agentTurn).toMatchObject({ status: 'running', questions: [{ status: 'closed' }] });
    await act(async () => { expect(await result.current.controls.answer('q-1', 'Azure', true)).toBe(false); });
    expect(lastTurn().connection.answer).not.toHaveBeenCalled();
    await end(request, { type: 'done', reply: '' });
    expect(result.current.thread.at(-1)?.agentTurn).toMatchObject({ status: 'stopped', questions: [{ status: 'closed' }] });

    act(() => { void result.current.controls.answer('q-1', 'Azure', true); });
    expect(turns).toHaveLength(2);
    expect(lastTurn().start.prompt).toMatch(/earlier question "Which cloud\?", which was still open when that turn ended/);
  });

  it('saves the changes made so far when a question pauses the turn', async () => {
    const { result } = setup();
    const request = send(result, 'Add a database, then ask about the engine.');
    emit(toolCall('call-1', 'edit_canvas', ADD_DATABASE));
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledOnce());
    emit({ v: 1, type: 'question', questionId: 'q-1', question: 'Which engine?', allowFreeform: true });

    expect(result.current.thread.at(-1)).toMatchObject({ agentTurn: { status: 'waiting' }, changes: { addedCount: 1 } });
    await end(request, { type: 'done', reply: '' });
  });

  it('Stop closes a pending removal without declining it and rejects the calls still queued', async () => {
    const { result } = setup();
    const request = send(result, 'Rebuild it.');
    emit(toolCall('call-1', 'edit_canvas', CLEAR_CANVAS));
    emit(toolCall('call-2', 'edit_canvas', ADD_DATABASE));
    await waitFor(() => expect(result.current.liveItem?.agentTurn?.status).toBe('waiting'));

    act(() => result.current.stop());
    expect(lastTurn().connection.cancel).toHaveBeenCalledOnce();
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledTimes(2));
    expect(lastTurn().connection.sendToolResult.mock.calls[1]).toEqual(['call-2', {
      ok: false, error: 'The user stopped this turn.', resultType: 'rejected',
    }]);

    await end(request, { type: 'done', reply: 'Stopped.' });
    const stopped = result.current.thread.at(-1)?.agentTurn;
    expect(stopped).toMatchObject({ status: 'stopped', questions: [{ kind: 'confirm', status: 'closed' }] });
    expect(labels()).toEqual(['Orders API', 'Redis']);

    // Stop was not a choice, so the removal can still be approved.
    const confirmId = stopped?.questions[0].id ?? '';
    act(() => { void result.current.controls.confirm(confirmId, true, 'Go ahead with the removal.'); });
    expect(turns).toHaveLength(2);
    expect(lastTurn().start.prompt).toContain('was not applied because the turn ended before the user confirmed it.');
  });

  it('Stop drops a whole-page layout that is still running', async () => {
    let finishLayout!: () => void;
    vi.mocked(composeDiagramForDisplay).mockImplementationOnce((nodes, edges) => new Promise((resolve) => {
      finishLayout = () => resolve({ nodes: nodes.map((node) => ({ ...node, position: { x: 0, y: 900 } })), edges });
    }));
    const { result } = setup();
    const request = send(result, 'Tidy the page.');
    emit(toolCall('call-1', 'layout', { scope: 'all' }));
    await waitFor(() => expect(composeDiagramForDisplay).toHaveBeenCalledOnce());

    act(() => result.current.stop());
    await act(async () => finishLayout());
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledOnce());
    expect(lastTurn().connection.sendToolResult).toHaveBeenCalledWith('call-1', { ok: false, error: 'The user stopped this turn.' });
    expect(useFlowStore.getState().nodes.map((node) => node.position)).toEqual([{ x: 10, y: 20 }, { x: 200, y: 20 }]);
    await end(request, { type: 'done', reply: '' });
    expect(result.current.controls.undoItemId).toBeNull();
  });

  it('undoes the whole turn in one step, only while the canvas is unchanged', async () => {
    const { result } = setup();
    const request = send(result, 'Add a database and a queue.');
    emit(toolCall('call-1', 'edit_canvas', ADD_DATABASE));
    emit(toolCall('call-2', 'edit_canvas', { ops: [{ op: 'add_node', id: 'queue', type: 'process', label: 'Queue' }] }));
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledTimes(2));
    await end(request, { type: 'done', reply: 'Added both.' });
    const turnId = result.current.thread.at(-1)?.id;
    expect(result.current.controls.undoItemId).toBe(turnId);

    act(() => result.current.controls.undo());
    expect(labels()).toEqual(['Orders API', 'Redis']);
    expect(result.current.thread.at(-1)?.agentTurn?.undone).toBe(true);
    expect(result.current.controls.undoItemId).toBeNull();
    expect(addToast).toHaveBeenCalledWith("Undid Copilot's changes.", 'success');
  });

  it.each<[string, AgentTurnEnd]>([
    ['stopped', { type: 'done', reply: 'Stopped.' }],
    ['failed', { type: 'error', code: 'request_failed', message: 'Copilot could not finish this turn.' }],
    ['interrupted', { type: 'interrupted' }],
  ])('undoes the changes of a turn that %s', async (status, turnEnd) => {
    const { result } = setup();
    const request = send(result, 'Add a database.');
    emit(toolCall('call-1', 'edit_canvas', ADD_DATABASE));
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledOnce());
    if (status === 'stopped') act(() => result.current.stop());
    await end(request, turnEnd);
    expect(result.current.thread.at(-1)?.agentTurn?.status).toBe(status);
    expect(result.current.controls.undoItemId).toBe(result.current.thread.at(-1)?.id);

    act(() => result.current.controls.undo());
    expect(labels()).toEqual(['Orders API', 'Redis']);
    expect(result.current.thread.at(-1)?.agentTurn?.undone).toBe(true);
  });

  it('offers no undo once the user edits the canvas after the turn', async () => {
    const { result } = setup();
    const request = send(result, 'Add a database.');
    emit(toolCall('call-1', 'edit_canvas', ADD_DATABASE));
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledOnce());
    await end(request, { type: 'done', reply: 'Added.' });
    act(() => useFlowStore.getState().setNodes((nodes) => nodes.map((node) => ({ ...node, position: { x: 900, y: 900 } }))));
    expect(result.current.controls.undoItemId).toBeNull();
  });

  it('keeps the work of an interrupted turn and continues it from the canvas', async () => {
    const { result } = setup();
    const request = send(result, 'Add a database.');
    emit({ v: 1, type: 'step', callId: 'call-1', name: 'edit_canvas', status: 'started' });
    emit(toolCall('call-1', 'edit_canvas', ADD_DATABASE));
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledOnce());

    expect(await end(request, { type: 'interrupted' })).toBe(true);
    // A step that never finished stops spinning.
    expect(result.current.thread.at(-1)).toMatchObject({
      agentTurn: { status: 'interrupted', steps: [{ callId: 'call-1', status: 'failed' }] },
      changes: { addedCount: 1 },
    });
    expect(labels()).toContain('Orders DB');
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('interrupted'), 'warning');

    act(() => { void result.current.controls.continueTurn('Continue where you left off.'); });
    expect(lastTurn().start.prompt).toMatch(/^\[Flowpilot context note: your previous turn was interrupted.*\]\n\nContinue where you left off\.$/);
    expect(lastTurn().start.history.at(-1)?.content).toContain('added node "Orders DB"');
  });

  it('records a turn that failed before doing anything as an error, which later turns do not replay', async () => {
    const { result } = setup([createErrorThreadItem('An older failure.')]);
    const request = send(result, 'Add a database.');
    expect(lastTurn().start.history).toEqual([]);

    expect(await end(request, { type: 'error', code: 'quota_exceeded', message: 'Your Copilot quota is used up.' })).toBe(false);
    expect(result.current.thread.at(-1)).toMatchObject({ type: 'assistant_error', content: 'Your Copilot quota is used up.' });
    expect(onError).toHaveBeenLastCalledWith('Your Copilot quota is used up.');
    expect(useFlowStore.getState().agentTurn).toBeNull();

    send(result, 'Try again.');
    expect(lastTurn().start.history).toEqual([{ role: 'user', content: 'Add a database.' }]);
  });

  it('records a turn that failed after editing the canvas with its error and changes', async () => {
    const { result } = setup();
    const request = send(result, 'Add a database.');
    emit(toolCall('call-1', 'edit_canvas', ADD_DATABASE));
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledOnce());

    const message = 'Copilot could not finish this turn. Changes made so far stay on the canvas; check your connection and retry.';
    expect(await end(request, { type: 'error', code: 'request_failed', message })).toBe(false);
    expect(result.current.thread.at(-1)).toMatchObject({
      type: 'assistant_agent_turn', changes: { addedCount: 1 }, agentTurn: { status: 'failed', error: message },
    });
    expect(labels()).toContain('Orders DB');
    expect(onError).toHaveBeenLastCalledWith(message);
    expect(lastTurn().start.history).toEqual([]);
    send(result, 'Try again.');
    expect(lastTurn().start.history.at(-1)?.content).toContain('added node "Orders DB"');
  });

  it('fails a request the socket refuses to send, so the composer keeps the prompt and image', async () => {
    vi.mocked(startAgentTurn).mockImplementationOnce(() => {
      throw new CopilotRequestError('invalid_request', AGENT_INVALID_START_MESSAGE, 400);
    });
    const { result } = setup();
    let ok = true;
    await act(async () => { ok = await result.current.send('Draw this.', 'data:image/svg+xml;base64,PHN2Zz4='); });
    expect(ok).toBe(false);
    expect(result.current.thread.at(-1)).toMatchObject({ type: 'assistant_error', content: AGENT_INVALID_START_MESSAGE });
    expect(onError).toHaveBeenLastCalledWith(AGENT_INVALID_START_MESSAGE);
    expect(useFlowStore.getState().agentTurn).toBeNull();
  });

  it('leaves out selected ids too long for the protocol', () => {
    useFlowStore.getState().setNodes([{ ...INITIAL[0], selected: true }, { ...INITIAL[1], id: 'x'.repeat(201), selected: true }]);
    const { result } = setup();
    void send(result, 'Rename these.');
    expect(lastTurn().start.canvas.selectedIds).toEqual(['api']);
  });

  it('ends the turn when its page is left and saves it to that page', async () => {
    const { result } = setup();
    const pageId = useFlowStore.getState().activeTabId;
    const request = send(result, 'Add a database.');
    emit(toolCall('call-1', 'edit_canvas', ADD_DATABASE));
    await waitFor(() => expect(lastTurn().connection.sendToolResult).toHaveBeenCalledOnce());

    await act(async () => {
      useFlowStore.getState().createDocument();
      expect(await request).toBe(true);
    });
    expect(lastTurn().connection.close).toHaveBeenCalledOnce();
    expect(saveAssistantThreadItem).toHaveBeenCalledWith(pageId, expect.objectContaining({
      type: 'assistant_agent_turn',
      changes: expect.objectContaining({ addedCount: 1 }),
      agentTurn: expect.objectContaining({ status: 'interrupted' }),
    }));
    expect(useFlowStore.getState().agentTurn).toBeNull();
    expect(result.current.liveItem).toBeNull();
  });

  it('does not start while another turn holds the page', () => {
    const { result } = setup();
    useFlowStore.getState().setAgentTurn({ turnId: 'other', pageId: useFlowStore.getState().activeTabId });
    act(() => { void result.current.send('Add a database.'); });
    expect(startAgentTurn).not.toHaveBeenCalled();
    expect(result.current.thread).toEqual([]);
  });
});
