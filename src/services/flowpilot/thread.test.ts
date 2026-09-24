import { describe, expect, it } from 'vitest';
import { COPILOT_MAX_MESSAGE_CHARS } from '@/services/copilot/protocol';
import {
  assistantThreadToAgentHistory, assistantThreadToChatMessages, createAgentTurnThreadItem, createAnswerThreadItem,
  createErrorThreadItem, createPlanThreadItem, createPreviewThreadItem, createUserThreadItem, describeCanvasChanges,
  expirePendingPreviews, getLatestAssistantResponse, getPendingConversationPlan, interruptUnfinishedAgentTurns,
  setPreviewStatus, upsertThreadItem,
} from './thread';
import type { DiagramChange, DiagramChangeSummary } from './types';

function changesOf(details: DiagramChange[]): DiagramChangeSummary {
  return {
    addedCount: 0, removedCount: 0, updatedCount: 0, addedEdgeCount: 0, removedEdgeCount: 0, updatedEdgeCount: 0,
    totalChanges: details.length, details,
  };
}

describe('Flowpilot conversation state', () => {
  it.each(['pending', 'applied', 'discarded', 'superseded', 'undone'] as const)(
    'keeps %s proposal DSL out of model history',
    (status) => {
      const preview = createPreviewThreadItem('flow: Test\n[process] cache: Orders Cache', 'Changes ready');
      const thread = setPreviewStatus([preview], preview.id, status);
      const messages = assistantThreadToChatMessages(thread);
      expect(messages).toHaveLength(1);
      expect(messages[0].parts[0].text).toContain(status);
      expect(messages[0].parts[0].text).not.toContain('Orders Cache');
      expect(messages[0].parts[0].text).not.toContain('flow:');
      expect(thread[0].content).toContain('Orders Cache');
      expect(thread[0].applied).toBe(status === 'applied');
    },
  );

  it('expires unaccepted previews on reload without resurrecting or losing discarded states', () => {
    const pending = createPreviewThreadItem('flow: Pending', 'Pending');
    const discarded = { ...createPreviewThreadItem('flow: Discarded', 'Discarded'), previewStatus: 'discarded' as const };
    const applied = { ...createPreviewThreadItem('flow: Applied', 'Applied'), previewStatus: 'applied' as const, applied: true };
    expect(expirePendingPreviews([pending, discarded, applied]).map((item) => item.previewStatus))
      .toEqual(['superseded', 'discarded', 'applied']);
  });

  it('uses only an actual conversational plan for a confirmation', () => {
    const plan = createAnswerThreadItem('Rename Redis to Orders Cache.', 'plan');
    expect(getPendingConversationPlan([plan])).toBe(plan.content);
    expect(getPendingConversationPlan([plan, createAnswerThreadItem('Redis is the current cache.', 'answer')])).toBeUndefined();
    expect(getPendingConversationPlan([plan, createPreviewThreadItem('flow: New', 'Draft')])).toBeUndefined();
  });

  it('invalidates older plans and previews when a newer user turn has no response', () => {
    const request = createUserThreadItem('Instead, rename the API.');
    const plan = createAnswerThreadItem('Rename Redis to Orders Cache.', 'plan');
    const preview = createPreviewThreadItem('flow: Old\n[process] cache: Orders Cache', 'Previous draft');
    expect(getPendingConversationPlan([plan, request])).toBeUndefined();
    expect(getLatestAssistantResponse([preview, request])).toBeUndefined();
  });

  it('does not mistake internal planning metadata for a response to the newer user turn', () => {
    const plan = createAnswerThreadItem('Rename Redis to Orders Cache.', 'plan');
    const request = createUserThreadItem('Explain the existing API instead.');
    expect(getPendingConversationPlan([plan, request, {
      ...plan, id: 'internal-plan', type: 'assistant_plan',
    }])).toBeUndefined();
    const latest = createAnswerThreadItem('Rename the API to Gateway.', 'plan');
    expect(getPendingConversationPlan([plan, request, latest])).toBe(latest.content);
  });

  it('replays a Copilot turn as its reply and a change note, and leaves errors out', () => {
    const turn = {
      ...createAgentTurnThreadItem(),
      content: 'Added a cache.',
      changes: changesOf([
        { kind: 'node', status: 'added', label: 'Cache' },
        { kind: 'node', status: 'updated', label: 'Orders API', previousLabel: 'API' },
      ]),
    };
    const plan = createPlanThreadItem({
      goal: 'Add a cache', mode: 'plan', steps: [], requiresApproval: false, intendedOutput: '', confidence: 1,
      reasoningSummary: 'Internal plan', skillId: 'plan_diagram',
    });
    const history = assistantThreadToAgentHistory([
      createUserThreadItem('Add a cache.'), plan, turn, createErrorThreadItem('Copilot timed out.'),
      { ...turn, id: 'undone', agentTurn: { status: 'done', steps: [], questions: [], undone: true } },
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'Add a cache.' },
      { role: 'assistant', content: 'Added a cache.\n[Canvas changes this turn: added node "Cache"; renamed node "API" to "Orders API"]' },
      {
        role: 'assistant',
        content: 'Added a cache.\n[Canvas changes this turn: added node "Cache"; renamed node "API" to "Orders API"; the user has since undone these changes]',
      },
    ]);
  });

  it('replays the questions the user answered with a Copilot turn', () => {
    const turn = {
      ...createAgentTurnThreadItem(),
      content: 'Built it on Azure.',
      agentTurn: {
        status: 'done' as const,
        steps: [],
        questions: [
          { kind: 'question' as const, id: 'q-1', status: 'answered' as const, question: 'Which cloud?', allowFreeform: true, answer: 'Azure' },
          { kind: 'question' as const, id: 'q-2', status: 'closed' as const, question: 'Region?', allowFreeform: true },
          { kind: 'confirm' as const, id: 'c-1', status: 'answered' as const, removedLabels: ['API'], removedCount: 1, clearsCanvas: false, approved: true },
          { kind: 'question' as const, id: 'q-3', status: 'answered' as const, question: 'Serverless?', allowFreeform: true, answer: 'Yes' },
        ],
      },
    };
    expect(assistantThreadToAgentHistory([turn])).toEqual([{
      role: 'assistant',
      content: 'Built it on Azure.\n[Canvas changes this turn: none]\n'
        + '[Questions this turn: asked "Which cloud?" and the user answered "Azure"; asked "Serverless?" and the user answered "Yes"]',
    }]);
  });

  it('shortens a replayed message the request would refuse', () => {
    const [message] = assistantThreadToAgentHistory([createUserThreadItem('x'.repeat(COPILOT_MAX_MESSAGE_CHARS + 1))]);
    expect(message.content).toHaveLength(COPILOT_MAX_MESSAGE_CHARS);
  });

  it('keeps the change note short', () => {
    expect(describeCanvasChanges(undefined)).toBe('none');
    const many = Array.from({ length: 23 }, (_, index): DiagramChange => ({ kind: 'edge', status: 'removed', label: `e${index}` }));
    const note = describeCanvasChanges(changesOf(many));
    expect(note).toMatch(/^removed edge "e0"; .*removed edge "e19"; and 3 more$/);
    const moved = { ...changesOf([{ kind: 'node', status: 'added', label: 'Cache' }]), movedCount: 2, totalChanges: 3 };
    expect(describeCanvasChanges(moved)).toBe('added node "Cache"; moved 2 nodes');
  });

  it('marks turns saved mid-run as interrupted, failing their unfinished steps and closing their open questions', () => {
    const running = {
      ...createAgentTurnThreadItem(),
      agentTurn: {
        status: 'waiting' as const,
        steps: [
          { callId: 'c-1', name: 'get_canvas', status: 'succeeded' as const },
          { callId: 'c-2', name: 'edit_canvas', status: 'started' as const },
        ],
        questions: [
          { kind: 'question' as const, id: 'q-1', status: 'waiting' as const, question: 'Which cloud?', allowFreeform: true },
          { kind: 'question' as const, id: 'q-2', status: 'answered' as const, question: 'Region?', allowFreeform: true, answer: 'EU' },
        ],
      },
    };
    const done = { ...createAgentTurnThreadItem(), agentTurn: { status: 'done' as const, steps: [], questions: [] } };
    const [interrupted, unchanged] = interruptUnfinishedAgentTurns([running, done]);
    expect(interrupted.agentTurn).toMatchObject({
      status: 'interrupted',
      steps: [{ status: 'succeeded' }, { status: 'failed' }],
      questions: [{ status: 'closed' }, { status: 'answered' }],
    });
    expect(unchanged).toBe(done);
  });

  it('replaces a thread item in place or appends it', () => {
    const user = createUserThreadItem('Hi');
    const turn = createAgentTurnThreadItem();
    expect(upsertThreadItem([user], turn)).toEqual([user, turn]);
    const updated = { ...turn, content: 'Hello' };
    expect(upsertThreadItem([turn, user], updated)).toEqual([updated, user]);
  });
});
