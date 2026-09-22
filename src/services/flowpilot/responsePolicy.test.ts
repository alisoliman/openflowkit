import { describe, expect, it } from 'vitest';
import { buildFlowpilotPlan, chooseFlowpilotResponseMode, isFlowpilotConfirmation } from './responsePolicy';

describe('flowpilot response policy', () => {
  it.each([
    'Rename it to Orders Cache.', 'Make it Azure-based.', 'Add Redis.',
    'Change its color to blue.', 'Remove the queue.', 'Connect it to the API.',
    'Replace the icon with Redis.', 'Move it below the database.',
    'Update this diagram.', 'Simplify it.',
  ])('routes short contextual edits to an editable result: %s', (prompt) => {
    expect(chooseFlowpilotResponseMode({ prompt, nodeCount: 4, selectedNodeCount: 0 }).mode).toBe('diagram_preview');
  });

  it.each(['Yes, do that.', 'Go ahead', 'Apply it', 'yes', 'Yes please', 'Please proceed'])(
    'executes a confirmed plan rather than returning another plan: %s',
    (prompt) => {
      expect(isFlowpilotConfirmation(prompt)).toBe(true);
      expect(chooseFlowpilotResponseMode({ prompt, nodeCount: 4, selectedNodeCount: 0, hasPendingPlan: true }).mode).toBe('diagram_preview');
      expect(chooseFlowpilotResponseMode({ prompt, nodeCount: 4, selectedNodeCount: 0 }).mode).toBe('clarification');
    },
  );

  it.each(['How should I add a cache?', 'What is the cache called?', 'Explain the current diagram'])(
    'preserves questions as non-mutating conversation: %s',
    (prompt) => {
      expect(chooseFlowpilotResponseMode({ prompt, nodeCount: 4, selectedNodeCount: 0 }).mode).toBe('answer');
    },
  );

  it('selects answer mode for explanatory prompts', () => {
    const result = chooseFlowpilotResponseMode({
      prompt: "Explain what's wrong with this architecture",
      nodeCount: 8,
      selectedNodeCount: 0,
    });

    expect(result.mode).toBe('answer');
    expect(result.skillId).toBe('explain_existing_diagram');
  });

  it('selects plan mode for planning prompts', () => {
    const plan = buildFlowpilotPlan({
      prompt: 'Plan a better version before drawing it',
      nodeCount: 5,
      selectedNodeCount: 0,
    });

    expect(plan.mode).toBe('plan');
    expect(plan.steps.length).toBeGreaterThan(1);
  });

  it('selects preview mode for explicit architecture creation', () => {
    const result = chooseFlowpilotResponseMode({
      prompt: 'Create an AWS architecture diagram for a payments platform',
      nodeCount: 0,
      selectedNodeCount: 0,
    });

    expect(result.mode).toBe('diagram_preview');
    expect(result.requiresApproval).toBe(true);
  });
});
