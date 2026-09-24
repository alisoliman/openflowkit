import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '@/lib/types';
import type { AssistantThreadItem } from '@/services/flowpilot/types';
import type { CodebaseAnalysis } from './ai-generation/codebaseAnalyzer';
import type { GenerateAIFlowResult } from './ai-generation/requestLifecycle';
import { useFlowStore } from '@/store';
import { useAIGeneration } from './useAIGeneration';
import { generateAIFlowResult } from './ai-generation/requestLifecycle';
import { chatWithFlowpilot } from '@/services/aiService';
import { startAgentTurn, type AgentTurnHandlers } from '@/services/copilot/agentClient';
import { loadAssistantThreadHistory, saveAssistantThreadHistory } from './ai-generation/chatHistoryStorage';
import { useStreamingState } from './ai-generation/streamingStore';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/components/ui/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('@/services/aiService', () => ({ chatWithFlowpilot: vi.fn() }));
vi.mock('./ai-generation/requestLifecycle', () => ({ generateAIFlowResult: vi.fn() }));
vi.mock('./ai-generation/chatHistoryStorage', () => ({
  loadAssistantThreadHistory: vi.fn(), saveAssistantThreadHistory: vi.fn(), saveAssistantThreadItem: vi.fn(),
}));
vi.mock('@/services/copilot/agentClient', () => ({ startAgentTurn: vi.fn() }));
vi.mock('./ai-generation/useCopilotConnection', () => ({
  useCopilotConnection: () => ({ connection: {
    state: 'ready', status: { runtime: 'github-copilot-sdk', authenticated: true, models: [] },
  } }),
}));
vi.mock('@/services/flowpilot/assetGrounding', () => ({
  groundFlowpilotAssets: vi.fn(async () => []), summarizeAssetGrounding: vi.fn(),
}));
vi.mock('@/services/analytics/analytics', () => ({ captureAnalyticsEvent: vi.fn() }));

const INITIAL: FlowNode[] = [
  { id: 'api', type: 'process', data: { label: 'Orders API' }, position: { x: 10, y: 20 } },
  { id: 'cache', type: 'process', data: { label: 'Redis' }, position: { x: 200, y: 20 } },
];

function resultWith(label = 'Orders Cache'): GenerateAIFlowResult {
  return {
    dslText: `flow: Orders\n[process] api: Orders API\n[process] cache: ${label}`,
    layoutedNodes: INITIAL.map((node) => node.id === 'cache' ? { ...node, data: { label } } : node),
    layoutedEdges: [],
    userMessage: { role: 'user', parts: [{ text: 'Rename the cache' }] },
  };
}

function commitGraph(nodes: FlowNode[], edges: GenerateAIFlowResult['layoutedEdges']) {
  const state = useFlowStore.getState();
  state.recordHistoryV2();
  state.setNodes(nodes);
  state.setEdges(edges);
}

beforeEach(() => {
  vi.resetAllMocks();
  useFlowStore.setState({ documents: [], tabs: [], nodes: [], edges: [], agentTurn: null });
  useFlowStore.getState().createDocument();
  useFlowStore.getState().setNodes(INITIAL);
  // Copilot chat runs agent turns (below); the one-shot review flow is what the other providers use.
  useFlowStore.getState().setAISettings({ provider: 'openai', apiKey: 'test-key', model: 'gpt-5-mini', autoApply: false });
  vi.mocked(loadAssistantThreadHistory).mockResolvedValue([]);
  vi.mocked(saveAssistantThreadHistory).mockResolvedValue(undefined);
  vi.mocked(generateAIFlowResult).mockResolvedValue(resultWith());
  vi.mocked(chatWithFlowpilot).mockResolvedValue('The current cache is Redis.');
});

async function setup() {
  const apply = vi.fn(commitGraph);
  const hook = renderHook(() => useAIGeneration(apply));
  await waitFor(() => expect(hook.result.current.readiness.canGenerate).toBe(true));
  return { ...hook, apply };
}

describe('multi-turn Flowpilot harness', () => {
  it('reviews a rename, commits one undo step, and restores it with Undo AI edit', async () => {
    const { result, apply } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    expect(chatWithFlowpilot).not.toHaveBeenCalled();
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.pendingDiff?.changes).toMatchObject({ updatedCount: 1, totalChanges: 1 });
    expect(useFlowStore.getState().nodes[1].data.label).toBe('Redis');
    act(() => { result.current.confirmPendingDiff(); });
    expect(apply).toHaveBeenCalledOnce();
    const state = useFlowStore.getState();
    expect(state.tabs.find((tab) => tab.id === state.activeTabId)?.history.past).toHaveLength(1);
    expect(result.current.canUndoLastChange).toBe(true);
    act(() => result.current.undoLastChange());
    expect(useFlowStore.getState().nodes).toEqual(INITIAL);
    expect(result.current.assistantThread.find((item) => item.type === 'assistant_canvas_preview')?.previewStatus).toBe('undone');
  });

  it('keeps discarded DSL out of later answers and supplies the actual canvas', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    act(() => result.current.discardPendingDiff());
    await act(async () => { await result.current.handleAIRequest('What is the cache currently named?'); });
    const [history, prompt] = vi.mocked(chatWithFlowpilot).mock.calls[0];
    expect(prompt).toContain('[process] cache: Redis');
    expect(prompt).not.toContain('[process] cache: Orders Cache');
    expect(history.filter((item) => item.role === 'model').map((item) => item.parts[0].text).join('\n')).toContain('discarded');
    expect(history.filter((item) => item.role === 'model').map((item) => item.parts[0].text).join('\n')).not.toContain('Orders Cache');
    expect(result.current.assistantThread.find((item) => item.type === 'assistant_canvas_preview')?.previewStatus).toBe('discarded');
    expect(saveAssistantThreadHistory).toHaveBeenCalledWith(expect.any(String), expect.arrayContaining([
      expect.objectContaining({ previewStatus: 'discarded' }),
    ]));
  });

  it('turns confirmation of a conversational plan into a diagram request', async () => {
    const { result } = await setup();
    vi.mocked(chatWithFlowpilot).mockResolvedValueOnce('Rename the Redis node to Orders Cache; keep the rest.');
    await act(async () => { await result.current.handleAIRequest('Plan a clearer cache label before drawing.'); });
    await act(async () => { await result.current.handleAIRequest('Yes, do that.'); });
    expect(chatWithFlowpilot).toHaveBeenCalledOnce();
    expect(generateAIFlowResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      prompt: expect.stringContaining('Rename the Redis node to Orders Cache'),
    }));
    expect(result.current.pendingDiff).not.toBeNull();
  });

  it('accepts an existing preview through confirmation without another model request', async () => {
    const { result, apply } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    await act(async () => { await result.current.handleAIRequest('Yes, do that.'); });
    expect(generateAIFlowResult).toHaveBeenCalledOnce();
    expect(apply).toHaveBeenCalledOnce();
    expect(result.current.pendingDiff).toBeNull();
  });

  it('confirms the latest plan instead of applying an older outstanding preview', async () => {
    const { result, apply } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename Redis to Orders Cache.'); });
    vi.mocked(chatWithFlowpilot).mockResolvedValueOnce('Rename Redis to Session Cache instead.');
    await act(async () => { await result.current.handleAIRequest('Plan a different cache label instead.'); });
    vi.mocked(generateAIFlowResult).mockResolvedValueOnce(resultWith('Session Cache'));
    await act(async () => { await result.current.handleAIRequest('Yes, do that.'); });

    expect(apply).not.toHaveBeenCalled();
    expect(generateAIFlowResult).toHaveBeenCalledTimes(2);
    expect(vi.mocked(generateAIFlowResult).mock.calls[1][0].prompt).toContain('Rename Redis to Session Cache instead.');
    expect(result.current.pendingDiff?.result.layoutedNodes[1].data.label).toBe('Session Cache');
    expect(useFlowStore.getState().nodes[1].data.label).toBe('Redis');
  });

  it('does not interpret confirmation of an intervening answer as approval of an older preview', async () => {
    const { result, apply } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename Redis to Orders Cache.'); });
    await act(async () => { await result.current.handleAIRequest('What is the cache currently called?'); });
    await act(async () => { await result.current.handleAIRequest('Yes.'); });

    expect(apply).not.toHaveBeenCalled();
    expect(chatWithFlowpilot).toHaveBeenCalledTimes(2);
    expect(result.current.pendingDiff).not.toBeNull();
  });

  it.each(['plan', 'preview'] as const)(
    'does not approve an older %s after a newer request was cancelled without a response',
    async (previous) => {
      const { result, apply } = await setup();
      if (previous === 'plan') {
        vi.mocked(chatWithFlowpilot).mockResolvedValueOnce('Rename Redis to Orders Cache.');
        await act(async () => { await result.current.handleAIRequest('Plan a clearer cache label.'); });
      } else {
        await act(async () => { await result.current.handleAIRequest('Rename Redis to Orders Cache.'); });
      }
      const diagramCalls = vi.mocked(generateAIFlowResult).mock.calls.length;
      let finish!: (text: string) => void;
      vi.mocked(chatWithFlowpilot).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
      let cancelled!: Promise<boolean>;
      act(() => { cancelled = result.current.handleAIRequest('Explain the API instead.'); });
      await waitFor(() => expect(result.current.isGenerating).toBe(true));
      act(() => result.current.cancelGeneration());
      await act(async () => { finish('This cancelled answer must not be saved.'); await cancelled; });

      vi.mocked(chatWithFlowpilot).mockResolvedValueOnce('Which change should I make?');
      await act(async () => { await result.current.handleAIRequest('Yes, do that.'); });
      expect(generateAIFlowResult).toHaveBeenCalledTimes(diagramCalls);
      expect(apply).not.toHaveBeenCalled();
      expect(result.current.assistantThread.at(-1)?.content).toBe('Which change should I make?');
    },
  );

  it('does not resurrect an expired preview when returning to its page', async () => {
    const { result, apply } = await setup();
    const originalDocument = useFlowStore.getState().activeDocumentId;
    await act(async () => { await result.current.handleAIRequest('Rename Redis to Orders Cache.'); });
    const savedThread = result.current.assistantThread;

    act(() => { useFlowStore.getState().createDocument(); });
    await waitFor(() => expect(result.current.readiness.canGenerate).toBe(true));
    vi.mocked(loadAssistantThreadHistory).mockResolvedValueOnce(savedThread);
    act(() => { useFlowStore.getState().setActiveDocumentId(originalDocument); });
    await waitFor(() => expect(result.current.assistantThread.some((item) => item.previewStatus === 'superseded')).toBe(true));

    expect(result.current.pendingDiff).toBeNull();
    act(() => { result.current.confirmPendingDiff(); });
    expect(apply).not.toHaveBeenCalled();
  });

  it('automatically applies only when opted in, with one undo operation', async () => {
    useFlowStore.getState().setAISettings({ autoApply: true });
    const { result, apply } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    expect(apply).toHaveBeenCalledOnce();
    expect(result.current.pendingDiff).toBeNull();
    expect(result.current.assistantThread.find((item) => item.type === 'assistant_canvas_preview')?.previewStatus).toBe('applied');
    expect(result.current.canUndoLastChange).toBe(true);
    act(() => result.current.undoLastChange());
    expect(useFlowStore.getState().nodes).toEqual(INITIAL);
  });

  it('clears the streaming overlay after a fast automatic response instead of reviving it during a render', async () => {
    useFlowStore.getState().setAISettings({ autoApply: true });
    const { result } = await setup();
    const stream = renderHook(() => useStreamingState());
    vi.mocked(generateAIFlowResult).mockImplementationOnce(async (options) => {
      options.onChunk?.('flow: Orders\n[process] cache: Orders Cache');
      return resultWith();
    });
    await act(async () => { await result.current.handleAIRequest('Rename the cache.'); });
    expect(stream.result.current).toMatchObject({ isGenerating: false, nodeCount: 0, nodes: [] });
    act(() => result.current.undoLastChange());
    expect(stream.result.current.isGenerating).toBe(false);
  });

  it('does not use Undo AI edit to remove a later manual edit', async () => {
    useFlowStore.getState().setAISettings({ autoApply: true });
    const { result } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    act(() => {
      const state = useFlowStore.getState();
      state.recordHistoryV2();
      state.setNodes((nodes) => nodes.map((node) => node.id === 'api' ? { ...node, data: { label: 'Manual edit' } } : node));
    });
    expect(result.current.canUndoLastChange).toBe(false);
    act(() => result.current.undoLastChange());
    expect(useFlowStore.getState().nodes[0].data.label).toBe('Manual edit');
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining('canvas has changed'), 'warning');
  });

  it('rejects a stale preview rather than overwriting a manually moved node', async () => {
    const { result, apply } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    act(() => useFlowStore.getState().setNodes((nodes) => nodes.map((node) => ({ ...node, position: { x: 900, y: 900 } }))));
    expect(result.current.pendingDiff?.stale).toBe(true);
    act(() => { result.current.confirmPendingDiff(); });
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.lastError).toContain('canvas changed');
  });

  it('does not apply a draft while a Flowpilot turn edits the page', async () => {
    const { result, apply } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    act(() => { useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: useFlowStore.getState().activeTabId }); });
    act(() => { result.current.confirmPendingDiff(); });
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.lastError).toContain('Flowpilot is editing this page');
    expect(useFlowStore.getState().nodes).toEqual(INITIAL);
  });

  it('offers Undo AI edit again only once a Flowpilot turn ends', async () => {
    useFlowStore.getState().setAISettings({ autoApply: true });
    const { result } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    act(() => { useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: useFlowStore.getState().activeTabId }); });
    expect(result.current.canUndoLastChange).toBe(false);
    act(() => result.current.undoLastChange());
    expect(result.current.assistantThread.find((item) => item.type === 'assistant_canvas_preview')?.previewStatus).toBe('applied');
    act(() => { useFlowStore.getState().setAgentTurn(null); });
    expect(result.current.canUndoLastChange).toBe(true);
    act(() => result.current.undoLastChange());
    expect(useFlowStore.getState().nodes).toEqual(INITIAL);
  });

  it('supersedes a previous draft when another edit is requested', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.handleAIRequest('Rename it to Orders Cache.'); });
    vi.mocked(generateAIFlowResult).mockResolvedValueOnce(resultWith('Session Cache'));
    await act(async () => { await result.current.handleAIRequest('Rename it to Session Cache instead.'); });
    expect(result.current.assistantThread.filter((item) => item.type === 'assistant_canvas_preview').map((item) => item.previewStatus))
      .toEqual(['superseded', 'pending']);
  });

  it('does not create a preview or undo entry for a no-op result', async () => {
    const { result, apply } = await setup();
    vi.mocked(generateAIFlowResult).mockResolvedValueOnce(resultWith('Redis'));
    await act(async () => { await result.current.handleAIRequest('Keep the current diagram.'); });
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.pendingDiff).toBeNull();
    expect(result.current.assistantThread.at(-1)?.content).toContain('No changes');
  });

  it.each(['cancel', 'move-node', 'switch-page'] as const)(
    'does not auto-apply an in-flight request after %s',
    async (action) => {
      useFlowStore.getState().setAISettings({ autoApply: true });
      const { result, apply } = await setup();
      let complete!: (value: GenerateAIFlowResult) => void;
      vi.mocked(generateAIFlowResult).mockReturnValueOnce(new Promise((resolve) => { complete = resolve; }));
      let request!: Promise<boolean>;
      act(() => { request = result.current.handleAIRequest('Rename it to Orders Cache.'); });
      await waitFor(() => expect(generateAIFlowResult).toHaveBeenCalledOnce());
      act(() => {
        if (action === 'cancel') result.current.cancelGeneration();
        if (action === 'move-node') useFlowStore.getState().setNodes((nodes) => nodes.map((node) => ({ ...node, position: { x: 500, y: 600 } })));
        if (action === 'switch-page') useFlowStore.getState().createDocument();
      });
      await act(async () => { complete(resultWith()); await request; });
      expect(apply).not.toHaveBeenCalled();
      expect(useFlowStore.getState().nodes.some((node) => node.data.label === 'Orders Cache')).toBe(false);
    },
  );

  it('does not restore an unaccepted preview as current state after reopening the conversation', async () => {
    const saved: AssistantThreadItem[] = [{
      id: 'old-preview', type: 'assistant_canvas_preview', role: 'model', content: 'flow: Old\n[process] cache: Orders Cache',
      createdAt: '2026-09-22T10:00:00Z', previewStatus: 'pending',
    }];
    vi.mocked(loadAssistantThreadHistory).mockResolvedValueOnce(saved);
    const { result } = await setup();
    expect(result.current.pendingDiff).toBeNull();
    expect(result.current.assistantThread[0].previewStatus).toBe('superseded');
    expect(result.current.chatMessages[0].parts[0].text).not.toContain('Orders Cache');
  });

  it('sends a property-panel AI edit to the other providers as the panel built it', async () => {
    const { result } = await setup();
    await act(async () => { await result.current.handleFocusedAIRequest('Rename the selected cache.', ['cache']); });
    expect(generateAIFlowResult).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      prompt: 'Rename the selected cache.',
      selectedNodeIds: ['cache'],
    }));
    expect(result.current.assistantThread[0]).toMatchObject({ type: 'user_message', content: 'Rename the selected cache.' });
    expect(result.current.pendingDiff).not.toBeNull();
  });
});

describe('Copilot chat', () => {
  it('runs an agent turn instead of the one-shot requests', async () => {
    useFlowStore.getState().setAISettings({ provider: 'copilot', model: 'auto' });
    const connection = { sendToolResult: vi.fn(), answer: vi.fn(), cancel: vi.fn(), close: vi.fn() };
    let handlers!: AgentTurnHandlers;
    vi.mocked(startAgentTurn).mockImplementation((_start, turnHandlers) => {
      handlers = turnHandlers;
      return connection;
    });
    const { result } = await setup();

    let request!: Promise<boolean>;
    act(() => { request = result.current.handleAIRequest('Add a database.'); });
    expect(startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'Add a database.', model: 'auto' }), expect.anything());
    expect(result.current.isGenerating).toBe(true);
    act(() => handlers.onEvent({ v: 1, type: 'reply_delta', text: 'Adding it now.' }));
    expect(result.current.assistantThread.at(-1)).toMatchObject({
      type: 'assistant_agent_turn', content: 'Adding it now.', agentTurn: { status: 'running' },
    });

    act(() => result.current.cancelGeneration());
    expect(connection.cancel).toHaveBeenCalledOnce();
    await act(async () => { handlers.onEnd({ type: 'done', reply: 'Stopped before adding it.' }); await request; });
    expect(result.current.isGenerating).toBe(false);
    expect(result.current.assistantThread.at(-1)).toMatchObject({ content: 'Stopped before adding it.', agentTurn: { status: 'stopped' } });
    expect(chatWithFlowpilot).not.toHaveBeenCalled();
    expect(generateAIFlowResult).not.toHaveBeenCalled();
  });

  it('runs a property-panel AI edit as an agent turn on the named node', async () => {
    useFlowStore.getState().setAISettings({ provider: 'copilot', model: 'auto' });
    vi.mocked(startAgentTurn).mockReturnValue({ sendToolResult: vi.fn(), answer: vi.fn(), cancel: vi.fn(), close: vi.fn() });
    const { result } = await setup();

    act(() => { void result.current.handleFocusedAIRequest('Refine the selected architecture node.', ['api']); });
    expect(startAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      prompt: 'Refine the selected architecture node.\n\nSelected node ids: "api".',
    }), expect.anything());
    expect(result.current.isGenerating).toBe(true);
    expect(generateAIFlowResult).not.toHaveBeenCalled();
  });

  it('reviews an AI import before applying it, even with auto-apply left on from another provider', async () => {
    useFlowStore.getState().setAISettings({ provider: 'copilot', model: 'auto', autoApply: true });
    const { result, apply } = await setup();
    const analysis: CodebaseAnalysis = {
      files: [{ path: 'src/index.ts', content: '', language: 'typescript', imports: [] }],
      edges: [],
      entryPoints: ['src/index.ts'],
      cloudPlatform: 'unknown',
      detectedServices: [],
      infraFiles: [],
      stats: { totalFiles: 1, sourceFiles: 1, languages: { typescript: 1 }, directories: 1 },
      summary: 'CODEBASE STRUCTURE',
    };

    await act(async () => { expect(await result.current.handleCodebaseAnalysis(analysis)).toBe(true); });
    expect(generateAIFlowResult).toHaveBeenCalledOnce();
    expect(apply).not.toHaveBeenCalled();
    expect(result.current.pendingDiff).not.toBeNull();
  });
});
