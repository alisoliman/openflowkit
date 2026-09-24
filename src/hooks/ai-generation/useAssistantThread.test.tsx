import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAgentTurnThreadItem, createUserThreadItem } from '@/services/flowpilot/thread';
import type { AgentTurnState, AssistantThreadItem } from '@/services/flowpilot/types';
import { loadAssistantThreadHistory, saveAssistantThreadHistory } from './chatHistoryStorage';
import { useAssistantThread } from './useAssistantThread';

const { addToast } = vi.hoisted(() => ({ addToast: vi.fn() }));
vi.mock('@/components/ui/ToastContext', () => ({ useToast: () => ({ addToast }) }));
vi.mock('./chatHistoryStorage', () => ({
  loadAssistantThreadHistory: vi.fn(), saveAssistantThreadHistory: vi.fn(),
}));

const QUESTION = { kind: 'question', id: 'q1', question: 'Which cloud?', allowFreeform: true } as const;

function savedTurn(agentTurn: AgentTurnState): AssistantThreadItem[] {
  return [createUserThreadItem('Add a cache'), { ...createAgentTurnThreadItem(), content: 'Adding a cache.', agentTurn }];
}

async function restore(items: AssistantThreadItem[]) {
  vi.mocked(loadAssistantThreadHistory).mockResolvedValue(items);
  const { result } = renderHook(() => useAssistantThread('doc-1'));
  await waitFor(() => expect(result.current.threadReady).toBe(true));
  return result.current.assistantThread;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(saveAssistantThreadHistory).mockResolvedValue(undefined);
});

describe('useAssistantThread', () => {
  it('ends a turn saved while it waited for an answer, and saves the thread that way', async () => {
    const thread = await restore(savedTurn({
      status: 'waiting',
      steps: [{ callId: 'c1', name: 'ask_user', status: 'started' }],
      questions: [{ ...QUESTION, status: 'waiting' }],
    }));

    // No live turn owns it after a reload, so the question can only start a new turn.
    expect(thread[1].agentTurn).toEqual({
      status: 'interrupted',
      steps: [{ callId: 'c1', name: 'ask_user', status: 'failed' }],
      questions: [{ ...QUESTION, status: 'closed' }],
    });
    expect(saveAssistantThreadHistory).toHaveBeenCalledWith('doc-1', thread);
  });

  it('ends a turn saved while it ran, and saves the thread that way', async () => {
    const thread = await restore(savedTurn({
      status: 'running',
      steps: [{ callId: 'c1', name: 'edit_canvas', status: 'started' }],
      questions: [],
    }));

    expect(thread[1].agentTurn).toEqual({
      status: 'interrupted',
      steps: [{ callId: 'c1', name: 'edit_canvas', status: 'failed' }],
      questions: [],
    });
    expect(saveAssistantThreadHistory).toHaveBeenCalledWith('doc-1', thread);
  });

  it('does not save a thread again when nothing in it was left open', async () => {
    const items = savedTurn({
      status: 'done',
      steps: [{ callId: 'c1', name: 'edit_canvas', status: 'succeeded' }],
      questions: [{ ...QUESTION, status: 'answered', answer: 'Azure' }],
    });

    expect(await restore(items)).toEqual(items);
    expect(saveAssistantThreadHistory).not.toHaveBeenCalled();
  });
});
