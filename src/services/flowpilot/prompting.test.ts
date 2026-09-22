import { describe, expect, it } from 'vitest';
import { buildFlowpilotAssistantSystemInstruction, buildFlowpilotConversationPrompt } from './prompting';

describe('Flowpilot live-canvas context', () => {
  it.each(['answer', 'plan'] as const)('uses actual graph content for %s, not just its node count', (mode) => {
    const prompt = buildFlowpilotConversationPrompt('What is the cache called?', {
      prompt: 'What is the cache called?', nodeCount: 1, selectedNodeCount: 0,
      currentDiagram: 'flow: Current\n[system] cache: Redis',
    }, [], mode);
    expect(prompt).toContain('CURRENT CANVAS (source of truth');
    expect(prompt).toContain('[system] cache: Redis');
    expect(buildFlowpilotAssistantSystemInstruction(mode)).toContain('CURRENT CANVAS');
  });

  it('marks an empty canvas explicitly and does not promise execution in a plan response', () => {
    expect(buildFlowpilotConversationPrompt('Explain this', { prompt: 'Explain this', nodeCount: 0, selectedNodeCount: 0 }, [], 'answer')).toContain('(empty canvas)');
    expect(buildFlowpilotAssistantSystemInstruction('plan')).toContain('Never claim that generation or a canvas change has started');
  });
});
