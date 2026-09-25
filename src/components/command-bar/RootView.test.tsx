import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '@/store';
import { RootView } from './RootView';
import type { CommandItem } from './types';

const commandItems: CommandItem[] = [
  {
    id: 'flowpilot',
    label: 'Open Flowpilot',
    tier: 'core',
    type: 'action',
    icon: <span>AI</span>,
    description: 'Generate and refine diagrams',
    action: vi.fn(),
  },
  {
    id: 'dsl',
    label: 'Edit Flow DSL',
    tier: 'advanced',
    type: 'action',
    icon: <span>DSL</span>,
    description: 'Direct editing surface',
    action: vi.fn(),
  },
];

describe('RootView', () => {
  it('renders non-search results without extra product taxonomy copy', () => {
    render(
      <RootView
        commands={commandItems}
        searchQuery=""
        setSearchQuery={vi.fn()}
        selectedIndex={0}
        setSelectedIndex={vi.fn()}
        onClose={vi.fn()}
        setView={vi.fn()}
        inputRef={React.createRef<HTMLInputElement>()}
      />
    );

    expect(screen.getByText('Open Flowpilot')).toBeTruthy();
    expect(screen.getByText('Edit Flow DSL')).toBeTruthy();
  });

  it('leaves Enter and the arrow keys to the chat while a Flowpilot turn runs', () => {
    const action = vi.fn();
    const setSelectedIndex = vi.fn();
    render(
      <RootView
        commands={[{ ...commandItems[1], action }]}
        searchQuery=""
        setSearchQuery={vi.fn()}
        selectedIndex={0}
        setSelectedIndex={setSelectedIndex}
        onClose={vi.fn()}
        setView={vi.fn()}
        inputRef={React.createRef<HTMLInputElement>()}
      />
    );
    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    });

    const input = screen.getByRole('combobox');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(setSelectedIndex).not.toHaveBeenCalled();
    expect(action).not.toHaveBeenCalled();

    act(() => {
      useFlowStore.getState().setAgentTurn(null);
    });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(action).toHaveBeenCalledTimes(1);
  });
});
