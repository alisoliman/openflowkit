import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n/config';
import { useFlowStore } from '@/store';
import { StudioAIPanel } from './StudioAIPanel';
import { createPreviewThreadItem } from '@/services/flowpilot/thread';

vi.mock('./FlowpilotControls', () => ({ FlowpilotControls: () => null }));
beforeEach(async () => {
  await i18n.changeLanguage('en');
  useFlowStore.getState().setAISettings({ provider: 'copilot', model: 'auto' });
});

function props(): ComponentProps<typeof StudioAIPanel> {
  return {
    onAIGenerate: vi.fn(async () => true), isGenerating: false, streamingText: null,
    retryCount: 0, onCancelGeneration: vi.fn(), pendingDiff: null,
    onConfirmDiff: vi.fn(), onDiscardDiff: vi.fn(),
    aiReadiness: { canGenerate: true, blockingIssue: null, advisory: null },
    lastError: null, onClearError: vi.fn(), chatMessages: [], assistantThread: [],
    onClearChat: vi.fn(), nodeCount: 0,
  };
}

describe('Flowpilot multi-turn composer', () => {
  it.each(['button', 'enter'])('clears immediately via %s and keeps the next draft after completion', async (submit) => {
    let finish!: (value: boolean) => void;
    const input = props();
    input.onAIGenerate = vi.fn(() => new Promise<boolean>((resolve) => { finish = resolve; }));
    render(<StudioAIPanel {...input} nodeCount={3} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Plan the next edit.' } });
    if (submit === 'button') fireEvent.click(screen.getByRole('button', { name: 'Generate with Flowpilot' }));
    else fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(input.onAIGenerate).toHaveBeenCalledWith('Plan the next edit.', undefined);
    expect(screen.getByRole('textbox')).toHaveValue('');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add Redis next.' } });
    await act(async () => { finish(true); });
    expect(screen.getByRole('textbox')).toHaveValue('Add Redis next.');
  });

  it('automatically offers Edit current after a first draft is applied', async () => {
    useFlowStore.getState().setAISettings({ provider: 'openai', model: 'gpt-5-mini' });
    const input = props();
    const { rerender } = render(<StudioAIPanel {...input} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Create an order diagram.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Generate with Flowpilot' }));
    await waitFor(() => expect(input.onAIGenerate).toHaveBeenCalledOnce());
    rerender(<StudioAIPanel {...input} nodeCount={3} />);
    expect(screen.getByRole('button', { name: 'Edit current' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Create new' })).toHaveAttribute('aria-pressed', 'false');
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add Redis.' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(input.onAIGenerate).toHaveBeenLastCalledWith('Add Redis.', undefined));
  });

  it.each(['button', 'enter'])('honors explicit Create new identically via %s and resets to edit afterwards', async (submit) => {
    useFlowStore.getState().setAISettings({ provider: 'openai', model: 'gpt-5-mini' });
    const input = props();
    render(<StudioAIPanel {...input} nodeCount={3} />);
    fireEvent.click(screen.getByRole('button', { name: 'Create new' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Build a queue diagram.' } });
    if (submit === 'button') fireEvent.click(screen.getByRole('button', { name: 'Generate with Flowpilot' }));
    else fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(input.onAIGenerate).toHaveBeenCalledWith(
      expect.stringContaining('Ignore the existing canvas'), undefined,
    ));
    expect(screen.getByRole('button', { name: 'Edit current' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('sends Copilot prompts unchanged without an edit or create mode', async () => {
    const input = props();
    render(<StudioAIPanel {...input} nodeCount={3} />);
    expect(screen.queryByRole('button', { name: 'Create new' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Start over with a queue diagram.' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    await waitFor(() => expect(input.onAIGenerate).toHaveBeenCalledWith('Start over with a queue diagram.', undefined));
  });

  it('does not let Enter bypass readiness checks', () => {
    const input = props();
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    render(<StudioAIPanel {...input} aiReadiness={{ ...input.aiReadiness, canGenerate: false }} />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Add Redis.' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(input.onAIGenerate).not.toHaveBeenCalled();
    expect(dispatch).toHaveBeenCalledWith(expect.objectContaining({ type: 'open-ai-settings' }));
    dispatch.mockRestore();
  });

  it('shows a concise rename and persistent discard status with code hidden by default', () => {
    const preview = createPreviewThreadItem('flow: Orders\n[process] cache: Orders Cache', 'Changes ready', undefined, undefined, undefined, {
      addedCount: 0, removedCount: 0, updatedCount: 1,
      addedEdgeCount: 0, removedEdgeCount: 0, updatedEdgeCount: 0, totalChanges: 1,
      details: [{ kind: 'node', status: 'updated', label: 'Orders Cache', previousLabel: 'Redis' }],
    });
    render(<StudioAIPanel {...props()} nodeCount={4} assistantThread={[{
      ...preview,
      previewStatus: 'discarded',
      assetMatches: [{
        id: 'unrelated-candidate', label: 'Unrelated asset suggestion', description: '',
        category: 'aws', confidence: 0.5, reasoning: '',
      }],
    }]} />);
    expect(screen.getByText('Discarded · canvas unchanged')).toBeInTheDocument();
    expect(screen.getByText('Nodes changed: 1')).toBeInTheDocument();
    expect(screen.getByText('Renamed "Redis" to "Orders Cache"')).toBeInTheDocument();
    expect(document.querySelector('details')).not.toHaveAttribute('open');
    expect(screen.getByText(/flow: Orders/)).not.toBeVisible();
    expect(screen.queryByText('Unrelated asset suggestion')).not.toBeInTheDocument();
  });
});
