import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '@/store';
import { FlowEditorChrome, type FlowEditorChromeProps } from './FlowEditorChrome';

vi.mock('@/components/TopNav', () => ({ TopNav: () => <div data-testid="top-nav" /> }));
vi.mock('@/components/Toolbar', () => ({ Toolbar: () => <div data-testid="toolbar" /> }));
vi.mock('@/components/PlaybackControls', () => ({ PlaybackControls: () => <div data-testid="playback-controls" /> }));
vi.mock('@/components/FlowEditorEmptyState', () => ({ FlowEditorEmptyState: () => <div data-testid="empty-state" /> }));
vi.mock('@/components/diagram-diff/DiffModeBanner', () => ({ DiffModeBanner: () => null }));

function renderChrome(toolbarVisible: boolean) {
  const props = {
    pages: [],
    activePageId: 'tab-1',
    topNav: {},
    canvas: null,
    shouldRenderPanels: false,
    collaborationEnabled: false,
    remotePresence: [],
    layoutMessage: '',
    isLayouting: false,
    playback: {},
    toolbar: { isVisible: toolbarVisible },
    emptyState: {},
  } as unknown as FlowEditorChromeProps;
  render(<FlowEditorChrome {...props} />);
}

describe('FlowEditorChrome', () => {
  afterEach(() => {
    act(() => {
      useFlowStore.getState().setAgentTurn(null);
    });
  });

  it('makes the top bar, playback controls, and empty state inert while a Flowpilot turn edits the page', async () => {
    renderChrome(false);
    const controls = await Promise.all(
      ['top-nav', 'playback-controls', 'empty-state'].map((testId) => screen.findByTestId(testId))
    );
    expect(controls.map((control) => control.closest('[inert]'))).toEqual([null, null, null]);

    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    });
    for (const control of controls) expect(control.closest('[inert]')).not.toBeNull();
  });

  it('leaves the toolbar to lock itself, so its Flowpilot toggle stays usable', async () => {
    useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    renderChrome(true);

    expect((await screen.findByTestId('toolbar')).closest('[inert]')).toBeNull();
  });
});
