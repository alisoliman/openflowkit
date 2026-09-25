import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '@/store';
import { Toolbar } from './Toolbar';

function renderToolbar() {
  const props: React.ComponentProps<typeof Toolbar> = {
    onUndo: vi.fn(),
    canUndo: true,
    onRedo: vi.fn(),
    canRedo: true,
    onToggleSelectMode: vi.fn(),
    isSelectMode: true,
    onTogglePanMode: vi.fn(),
    onCommandBar: vi.fn(),
    isCommandBarOpen: false,
    onToggleStudio: vi.fn(),
    isStudioOpen: false,
    onOpenAssets: vi.fn(),
    onAddShape: vi.fn(),
    onAddAnnotation: vi.fn(),
    onAddSection: vi.fn(),
    onAddTextNode: vi.fn(),
    onAddClassNode: vi.fn(),
    onAddEntityNode: vi.fn(),
    onAddMindmapNode: vi.fn(),
    onAddJourneyNode: vi.fn(),
    onAddArchitectureNode: vi.fn(),
    onAddSequenceParticipant: vi.fn(),
    onAddWireframe: vi.fn(),
    onLayout: vi.fn(),
    getCenter: () => ({ x: 0, y: 0 }),
  };
  render(<Toolbar {...props} />);
  return props;
}

describe('Toolbar', () => {
  afterEach(() => {
    act(() => {
      useFlowStore.getState().setAgentTurn(null);
    });
  });

  it('locks the tools during a Flowpilot turn but keeps the studio, and its Stop, one click away', () => {
    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    });
    const props = renderToolbar();
    const toggle = screen.getByTestId('toolbar-flowpilot-toggle');

    const otherButtons = screen.getAllByRole('button').filter((button) => button !== toggle);
    expect(otherButtons.length).toBeGreaterThan(0);
    for (const button of otherButtons) {
      expect(button).toBeDisabled();
    }
    expect(toggle).toBeEnabled();
    fireEvent.click(toggle);
    expect(props.onToggleStudio).toHaveBeenCalledTimes(1);
  });

  it('enables the tools when no turn is running', () => {
    renderToolbar();

    for (const button of screen.getAllByRole('button')) {
      expect(button).toBeEnabled();
    }
  });

  it('names every tool and exposes the current editing mode', () => {
    renderToolbar();
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }
    expect(screen.getByRole('button', { name: /select mode/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /pan mode/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByTestId('toolbar-flowpilot-toggle')).toHaveAttribute('aria-expanded', 'false');
  });

});
