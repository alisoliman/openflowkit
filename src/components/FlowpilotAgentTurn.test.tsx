import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n/config';
import type { AgentTurnControls } from '@/hooks/ai-generation/useFlowpilotAgent';
import { createUserThreadItem } from '@/services/flowpilot/thread';
import type { AgentTurnState, AssistantThreadItem } from '@/services/flowpilot/types';
import { FlowpilotAgentTurn } from './FlowpilotAgentTurn';
import { StudioAIPanel } from './StudioAIPanel';

vi.mock('./FlowpilotControls', () => ({ FlowpilotControls: () => null }));
beforeEach(async () => { await i18n.changeLanguage('en'); });

function turnItem(agentTurn: Partial<AgentTurnState>, extra: Partial<AssistantThreadItem> = {}): AssistantThreadItem {
  return {
    id: 'turn-1', type: 'assistant_agent_turn', role: 'model', content: '', createdAt: '2026-09-23T10:00:00Z',
    agentTurn: { status: 'done', steps: [], questions: [], ...agentTurn },
    ...extra,
  };
}

function controls(overrides: Partial<AgentTurnControls> = {}): AgentTurnControls {
  return {
    undoItemId: null,
    answer: vi.fn(async () => true),
    confirm: vi.fn(async () => true),
    continueTurn: vi.fn(async () => true),
    undo: vi.fn(),
    ...overrides,
  };
}

function renderTurn(item: AssistantThreadItem, props: Partial<ComponentProps<typeof FlowpilotAgentTurn>> = {}) {
  const turnControls = props.controls ?? controls();
  render(<FlowpilotAgentTurn item={item} controls={turnControls} isLatest busy={false} {...props} />);
  return turnControls;
}

describe('Flowpilot agent turn', () => {
  it('shows a running turn in the chat without a second thinking bubble', () => {
    const live = turnItem({
      status: 'running',
      steps: [
        { callId: 'call-1', name: 'get_canvas', status: 'succeeded' },
        { callId: 'call-2', name: 'edit_canvas', status: 'started' },
      ],
    }, { content: 'Adding a cache.' });
    render(
      <StudioAIPanel
        onAIGenerate={vi.fn(async () => true)} isGenerating streamingText={null} retryCount={0}
        onCancelGeneration={vi.fn()} pendingDiff={null} onConfirmDiff={vi.fn()} onDiscardDiff={vi.fn()}
        aiReadiness={{ canGenerate: true, blockingIssue: null, advisory: null }} lastError={null}
        onClearError={vi.fn()} chatMessages={[]} assistantThread={[createUserThreadItem('Add a cache.'), live]}
        agentTurnControls={controls()} onClearChat={vi.fn()} nodeCount={2}
      />
    );

    expect(screen.getByText('Steps: 2')).toBeInTheDocument();
    expect(screen.getByText('Read the canvas').closest('li')).toHaveAttribute('data-step-status', 'succeeded');
    expect(screen.getByText('Edited the canvas').closest('li')).toHaveAttribute('data-step-status', 'started');
    expect(screen.getByText('Adding a cache.')).toBeInTheDocument();
    expect(screen.getByText('Working on it…')).toBeInTheDocument();
    expect(screen.queryByText('Thinking')).not.toBeInTheDocument();
    expect(screen.getByTitle('Clear Chat History')).toBeDisabled();
  });

  it('answers a question with a choice or typed text', () => {
    const turnControls = renderTurn(turnItem({
      status: 'waiting',
      questions: [{ kind: 'question', id: 'q-1', status: 'waiting', question: 'Which cloud?', choices: ['Azure', 'AWS'], allowFreeform: true }],
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Azure' }));
    expect(turnControls.answer).toHaveBeenCalledWith('q-1', 'Azure', false);

    const input = screen.getByRole('textbox', { name: 'Type your answer' });
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Both' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(turnControls.answer).toHaveBeenLastCalledWith('q-1', 'Both', true);
  });

  it('asks before a large removal, listing the nodes', () => {
    const turnControls = renderTurn(turnItem({
      status: 'waiting',
      questions: [{
        kind: 'confirm', id: 'confirm-1', status: 'waiting', clearsCanvas: false, removedCount: 12,
        removedLabels: Array.from({ length: 10 }, (_, index) => `Node ${index + 1}`),
      }],
    }));
    expect(screen.getByText('Copilot wants to remove these nodes from before this turn:')).toBeInTheDocument();
    expect(screen.getByText(/Node 10 and 2 more/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(turnControls.confirm).toHaveBeenCalledWith('confirm-1', true, 'Go ahead with the removal.');
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(turnControls.confirm).toHaveBeenLastCalledWith('confirm-1', false, '');
  });

  it('lets an expired question start a new turn only while nothing runs', () => {
    const item = turnItem({
      status: 'interrupted',
      questions: [{ kind: 'question', id: 'q-1', status: 'expired', question: 'Which cloud?', choices: ['Azure'], allowFreeform: false }],
    });
    const { rerender } = render(<FlowpilotAgentTurn item={item} controls={controls()} isLatest busy />);
    expect(screen.getByText(/No answer for 10 minutes/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Azure' })).not.toBeInTheDocument();
    rerender(<FlowpilotAgentTurn item={item} controls={controls()} isLatest busy={false} />);
    expect(screen.getByRole('button', { name: 'Azure' })).toBeInTheDocument();
  });

  it('does not blame a timeout for a question the turn left open', () => {
    renderTurn(turnItem({
      status: 'stopped',
      questions: [{ kind: 'question', id: 'q-1', status: 'closed', question: 'Which cloud?', choices: ['Azure'], allowFreeform: false }],
    }));
    expect(screen.getByText('The turn ended before you answered. Answer to start a new turn.')).toBeInTheDocument();
    expect(screen.queryByText(/No answer for 10 minutes/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Azure' })).toBeInTheDocument();
  });

  it('offers Continue on the latest interrupted turn only', () => {
    const turnControls = renderTurn(turnItem({ status: 'interrupted' }));
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(turnControls.continueTurn).toHaveBeenCalledWith('Continue where you left off.');

    render(<FlowpilotAgentTurn item={turnItem({ status: 'interrupted' }, { id: 'older' })} controls={controls()} isLatest={false} busy={false} />);
    expect(screen.getAllByRole('button', { name: 'Continue' })).toHaveLength(1);
  });

  it('offers undo for the turn it can still revert, and shows how turns ended', () => {
    const changes = {
      addedCount: 1, removedCount: 0, updatedCount: 0, addedEdgeCount: 0, removedEdgeCount: 0, updatedEdgeCount: 0,
      totalChanges: 1, details: [{ kind: 'node' as const, status: 'added' as const, label: 'Cache' }],
    };
    const turnControls = renderTurn(turnItem({ status: 'stopped' }, { content: 'Added a cache.', changes }), {
      controls: controls({ undoItemId: 'turn-1' }),
    });
    expect(screen.getByText('Stopped. Changes so far stay on the canvas.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: "Undo Copilot's changes" }));
    expect(turnControls.undo).toHaveBeenCalledOnce();

    render(<FlowpilotAgentTurn item={turnItem({ status: 'failed', error: 'Copilot timed out.', undone: true }, { id: 'turn-2' })} controls={turnControls} isLatest busy={false} />);
    expect(screen.getByText('Copilot could not finish this turn.')).toBeInTheDocument();
    expect(screen.getByText('Copilot timed out.')).toBeInTheDocument();
    expect(screen.getByText("Copilot's changes were undone.")).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: "Undo Copilot's changes" })).toHaveLength(1);
  });
});
