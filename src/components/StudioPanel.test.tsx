import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '@/store';
import { StudioPanel } from './StudioPanel';

vi.mock('./StudioAIPanel', () => ({
  StudioAIPanel: () => <div data-testid="studio-ai-panel" />,
}));

vi.mock('./StudioCodePanel', () => ({
  StudioCodePanel: () => <div data-testid="studio-code-panel" />,
}));

function createProps(): React.ComponentProps<typeof StudioPanel> {
  return {
    onClose: vi.fn(),
    nodes: [],
    edges: [],
    onApply: vi.fn(),
    onAIGenerate: vi.fn(async () => true),
    isGenerating: false,
    streamingText: null,
    retryCount: 0,
    cancelGeneration: vi.fn(),
    pendingDiff: null,
    onConfirmDiff: vi.fn(),
    onDiscardDiff: vi.fn(),
    aiReadiness: {
      canGenerate: true,
      blockingIssue: null,
      advisory: null,
    },
    lastAIError: null,
    onClearAIError: vi.fn(),
    chatMessages: [],
    assistantThread: [],
    onClearChat: vi.fn(),
    activeTab: 'ai',
    onTabChange: vi.fn(),
    codeMode: 'openflow',
    onCodeModeChange: vi.fn(),
    selectedNode: null,
    selectedNodeCount: 0,
    onViewProperties: vi.fn(),
    playback: {
      currentStepIndex: -1,
      totalSteps: 0,
      isPlaying: false,
      onStartPlayback: vi.fn(),
      onPlayPause: vi.fn(),
      onStop: vi.fn(),
      onScrubToStep: vi.fn(),
      onNext: vi.fn(),
      onPrev: vi.fn(),
      playbackSpeed: 2000,
      onPlaybackSpeedChange: vi.fn(),
    },
  };
}

afterEach(() => {
  act(() => {
    useFlowStore.getState().setAgentTurn(null);
  });
});

describe('StudioPanel', () => {
  it('shows the studio tabs in the shared segmented control and keeps AI as the primary workspace', async () => {
    render(<StudioPanel {...createProps()} />);

    expect(screen.getByText('Flowpilot')).toBeTruthy();
    expect(screen.getByText('Code')).toBeTruthy();
    expect(await screen.findByTestId('studio-ai-panel')).toBeTruthy();
  });

  it('locks the code editor and the properties shortcut while a Flowpilot turn edits the page', async () => {
    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    });
    const selectedNode = {
      id: 'api',
      type: 'process',
      position: { x: 0, y: 0 },
      data: { label: 'API' },
    };
    const { rerender } = render(
      <StudioPanel {...createProps()} activeTab="code" selectedNode={selectedNode as never} />
    );

    expect((await screen.findByTestId('studio-code-panel')).parentElement).toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: /Properties/ }).parentElement).toHaveAttribute(
      'inert'
    );

    rerender(<StudioPanel {...createProps()} activeTab="ai" />);
    expect((await screen.findByTestId('studio-ai-panel')).closest('[inert]')).toBeNull();
  });

  it('shows the Copilot lock with Stop on every studio tab while a turn edits the page', async () => {
    const props = createProps();
    const { rerender } = render(<StudioPanel {...props} />);
    expect(screen.queryByRole('status')).toBeNull();

    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    });
    expect(screen.getByRole('status').textContent).toContain('Copilot is editing this page');
    rerender(<StudioPanel {...props} activeTab="code" />);
    expect(await screen.findByTestId('studio-code-panel')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(props.cancelGeneration).toHaveBeenCalledOnce();
  });
});
