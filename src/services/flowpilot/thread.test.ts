import { describe, expect, it } from 'vitest';
import {
  assistantThreadToChatMessages, createAnswerThreadItem, createPreviewThreadItem,
  expirePendingPreviews, getPendingConversationPlan, setPreviewStatus,
} from './thread';

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
});
