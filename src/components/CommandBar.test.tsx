import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { ReactFlowProvider } from '@/lib/reactflowCompat';
import { CommandBar } from './CommandBar';

const { commandAction } = vi.hoisted(() => ({ commandAction: vi.fn() }));

vi.mock('./command-bar/useCommandBarCommands', () => ({
  useCommandBarCommands: () => [
    {
      id: 'command-1',
      label: 'Open AI',
      description: 'Open AI tools',
      type: 'action',
      action: commandAction,
    },
    {
      id: 'command-2',
      label: 'Open Search',
      description: 'Open search tools',
      type: 'navigation',
      view: 'search',
    },
  ],
}));

describe('CommandBar', () => {
  beforeEach(() => vi.clearAllMocks());
  const baseProps = {
    isOpen: true,
    onClose: vi.fn(),
    nodes: [],
    edges: [],
  };

  it('renders with dialog semantics and focuses the search input', () => {
    render(<CommandBar {...baseProps} />);

    expect(screen.getByRole('dialog', { name: 'Command bar' })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'Search command bar actions' }));
  });

  it('closes on Escape and restores focus to the previous control', async () => {
    function Harness(): React.ReactElement {
      const [isOpen, setIsOpen] = React.useState(false);

      return (
        <div>
          <button type="button" onClick={() => setIsOpen(true)}>
            Open command bar
          </button>
          <CommandBar {...baseProps} isOpen={isOpen} onClose={() => setIsOpen(false)} />
        </div>
      );
    }

    render(<Harness />);

    const trigger = screen.getByRole('button', { name: 'Open command bar' });
    trigger.focus();
    fireEvent.click(trigger);

    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Open command bar' }));
    });
  });

  it('wires the search input to the active command option for assistive tech', () => {
    render(<CommandBar {...baseProps} />);

    const input = screen.getByRole('combobox', { name: 'Search command bar actions' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    expect(input.getAttribute('aria-controls')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toContain('-option-0');
    expect(screen.getByRole('listbox')).toBeTruthy();
  });

  it('wraps Shift+Tab from command search and leaves focused button keys out of command navigation', () => {
    render(<CommandBar {...baseProps} />);
    const input = screen.getByRole('combobox');
    const close = within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Tab', shiftKey: true });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Enter' });
    expect(commandAction).not.toHaveBeenCalled();
    fireEvent.keyDown(close, { key: 'Tab' });
    expect(input).toHaveFocus();
  });

  it('filters while typing, ignores composition, and runs the keyboard-selected command once', () => {
    render(<CommandBar {...baseProps} />);
    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Open AI' } });
    expect(input).toHaveValue('Open AI');
    expect(screen.queryByRole('option', { name: /Open Search/ })).not.toBeInTheDocument();
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    expect(commandAction).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(commandAction).toHaveBeenCalledOnce();
    expect(baseProps.onClose).toHaveBeenCalledOnce();
  });

  it('allows Escape from the node-search input to close its dialog', async () => {
    const onClose = vi.fn();
    render(
      <MemoryRouter>
        <ReactFlowProvider>
          <CommandBar {...baseProps} initialView="search" onClose={onClose} />
        </ReactFlowProvider>
      </MemoryRouter>
    );
    const input = await screen.findByPlaceholderText('commandBar.search.placeholder');
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: 'service' } });
    expect(input).toHaveValue('service');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledOnce();
  });
});
