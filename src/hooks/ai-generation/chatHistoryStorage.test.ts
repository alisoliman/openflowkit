import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatMessage } from '@/services/aiService';

const replaceChatThread = vi.fn();
const clearChatThread = vi.fn();
const loadChatThread = vi.fn();

vi.mock('@/services/storage/localFirstRepository', () => ({
  localFirstRepository: {
    loadChatThread,
    replaceChatThread,
    clearChatThread,
  },
}));

describe('chatHistoryStorage', () => {
  beforeEach(() => {
    clearChatThread.mockReset();
    loadChatThread.mockReset();
    replaceChatThread.mockReset();
    localStorage.clear();
  });

  it('loads chat history from the local-first repository', async () => {
    loadChatThread.mockResolvedValue([
      {
        id: 'doc-1:0:user',
        documentId: 'doc-1',
        role: 'user',
        parts: [{ text: 'hello' }],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ]);

    const { loadChatHistory } = await import('./chatHistoryStorage');

    await expect(loadChatHistory('doc-1')).resolves.toEqual([
      { role: 'user', parts: [{ text: 'hello' }] } satisfies ChatMessage,
    ]);
  });

  it('falls back to legacy localStorage when repository loading fails', async () => {
    loadChatThread.mockRejectedValue(new Error('offline'));
    localStorage.setItem('ofk_chat_history_doc-2', JSON.stringify([
      { role: 'model', parts: [{ text: 'stored locally' }] },
    ] satisfies ChatMessage[]));

    const { loadChatHistory } = await import('./chatHistoryStorage');

    await expect(loadChatHistory('doc-2')).resolves.toEqual([
      { role: 'model', parts: [{ text: 'stored locally' }] },
    ]);
  });

  it('drops malformed legacy localStorage chat payloads', async () => {
    loadChatThread.mockRejectedValue(new Error('offline'));
    localStorage.setItem(
      'ofk_chat_history_doc-bad',
      JSON.stringify([{ role: 'system', parts: ['bad-shape'] }])
    );

    const { loadChatHistory } = await import('./chatHistoryStorage');

    await expect(loadChatHistory('doc-bad')).resolves.toEqual([]);
  });

  it('writes the full chat thread to the repository', async () => {
    const messages: ChatMessage[] = [
      { role: 'user', parts: [{ text: 'a' }] },
      { role: 'model', parts: [{ text: 'b' }] },
    ];
    const { saveChatHistory } = await import('./chatHistoryStorage');

    await saveChatHistory('doc-3', messages);

    expect(replaceChatThread).toHaveBeenCalledTimes(1);
    expect(replaceChatThread).toHaveBeenCalledWith(
      'doc-3',
      expect.arrayContaining([
        expect.objectContaining({ documentId: 'doc-3', role: 'user', parts: [{ text: 'a' }] }),
        expect.objectContaining({ documentId: 'doc-3', role: 'model', parts: [{ text: 'b' }] }),
      ])
    );
  });

  it('loads assistant thread items with metadata from the repository', async () => {
    loadChatThread.mockResolvedValue([
      {
        id: 'doc-1:1:assistant_plan',
        documentId: 'doc-1',
        role: 'model',
        parts: [{ text: 'Plan first' }],
        createdAt: '2026-01-01T00:00:01.000Z',
        threadType: 'assistant_plan',
        responseMode: 'plan',
        thinkingState: 'planning',
      },
    ]);

    const { loadAssistantThreadHistory } = await import('./chatHistoryStorage');
    const [item] = await loadAssistantThreadHistory('doc-1');

    expect(item?.type).toBe('assistant_plan');
    expect(item?.responseMode).toBe('plan');
    expect(item?.thinkingState).toBe('planning');
  });

  it('round-trips preview disposition and semantic changes', async () => {
    const { loadAssistantThreadHistory, saveAssistantThreadHistory } = await import('./chatHistoryStorage');
    const item = {
      id: 'preview', role: 'model' as const, type: 'assistant_canvas_preview' as const,
      content: 'flow: Draft', createdAt: '2026-09-22T00:00:00Z', previewStatus: 'discarded' as const,
      changes: { addedCount: 0, updatedCount: 1, removedCount: 0, addedEdgeCount: 0, updatedEdgeCount: 0, removedEdgeCount: 0, totalChanges: 1, details: [] },
    };
    await saveAssistantThreadHistory('doc-preview', [item]);
    const saved = replaceChatThread.mock.calls[0][1];
    expect(saved[0]).toMatchObject({ previewStatus: 'discarded', sequence: 0, changes: item.changes });
    loadChatThread.mockResolvedValueOnce(saved);
    expect((await loadAssistantThreadHistory('doc-preview'))[0]).toMatchObject(item);
  });

  it('round-trips a Copilot turn and saves one into a page that is no longer open', async () => {
    const { loadAssistantThreadHistory, saveAssistantThreadHistory, saveAssistantThreadItem } = await import('./chatHistoryStorage');
    const user = { id: 'user', role: 'user' as const, type: 'user_message' as const, content: 'Add a cache.', createdAt: '2026-09-22T00:00:00Z' };
    const turn = {
      id: 'turn', role: 'model' as const, type: 'assistant_agent_turn' as const, content: '', createdAt: '2026-09-22T00:00:01Z',
      agentTurn: {
        status: 'waiting' as const,
        steps: [{ callId: 'call-1', name: 'edit_canvas', status: 'succeeded' as const }],
        questions: [{ kind: 'question' as const, id: 'q-1', status: 'waiting' as const, question: 'Which cache?', allowFreeform: true }],
      },
    };
    await saveAssistantThreadHistory('doc-agent', [user, turn]);
    const saved = replaceChatThread.mock.calls[0][1];
    loadChatThread.mockResolvedValue(saved);
    expect(await loadAssistantThreadHistory('doc-agent')).toEqual([user, turn].map((item) => expect.objectContaining(item)));

    const finished = { ...turn, content: 'Added it.', agentTurn: { ...turn.agentTurn, status: 'interrupted' as const, questions: [] } };
    await saveAssistantThreadItem('doc-agent', finished);
    expect(replaceChatThread).toHaveBeenLastCalledWith('doc-agent', [
      expect.objectContaining({ id: 'user' }),
      expect.objectContaining({ id: 'turn', parts: [{ text: 'Added it.' }], agentTurn: finished.agentTurn }),
    ]);
  });

  it('serializes conversation writes so a slow old save cannot overwrite a discard', async () => {
    let finish!: () => void;
    replaceChatThread.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    replaceChatThread.mockResolvedValueOnce(undefined);
    const { saveAssistantThreadHistory } = await import('./chatHistoryStorage');
    const first = saveAssistantThreadHistory('ordered-doc', []);
    const second = saveAssistantThreadHistory('ordered-doc', [{
      id: 'discarded', role: 'model', type: 'assistant_canvas_preview', content: 'draft',
      createdAt: 'now', previewStatus: 'discarded',
    }]);
    await vi.waitFor(() => expect(replaceChatThread).toHaveBeenCalledOnce());
    finish();
    await Promise.all([first, second]);
    expect(replaceChatThread).toHaveBeenCalledTimes(2);
    expect(replaceChatThread.mock.calls[1][1][0].previewStatus).toBe('discarded');
  });

  it('clears the repository thread and falls back to localStorage cleanup on failure', async () => {
    clearChatThread.mockRejectedValueOnce(new Error('boom'));
    localStorage.setItem('ofk_chat_history_doc-4', JSON.stringify([
      { role: 'user', parts: [{ text: 'draft' }] },
    ] satisfies ChatMessage[]));

    const { clearChatHistory } = await import('./chatHistoryStorage');

    await clearChatHistory('doc-4');

    expect(clearChatThread).toHaveBeenCalledWith('doc-4');
    expect(localStorage.getItem('ofk_chat_history_doc-4')).toBeNull();
  });
});
