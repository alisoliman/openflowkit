import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlowTabs } from './FlowTabs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

describe('FlowTabs', () => {
  function createProps() {
    return {
      pages: [
        { id: 'page-1', name: 'Page One', nodes: [], edges: [], history: { past: [], future: [] } },
        { id: 'page-2', name: 'Page Two', nodes: [], edges: [], history: { past: [], future: [] } },
        { id: 'page-3', name: 'Page Three', nodes: [], edges: [], history: { past: [], future: [] } },
      ],
      activePageId: 'page-1',
      onSwitchPage: vi.fn(),
      onAddPage: vi.fn(),
      onClosePage: vi.fn(),
      onRenamePage: vi.fn(),
      onReorderPage: vi.fn(),
    };
  }

  it('reorders pages when a tab is dropped onto another tab', () => {
    const props = createProps();
    render(<FlowTabs {...props} />);

    const tabs = screen.getAllByTestId('flow-page-tab');
    fireEvent.dragStart(tabs[0]);
    fireEvent.dragOver(tabs[2]);
    fireEvent.drop(tabs[2]);

    expect(props.onReorderPage).toHaveBeenCalledWith('page-1', 'page-3');
  });

  it('does not reorder when a tab is dropped onto itself', () => {
    const props = createProps();
    render(<FlowTabs {...props} />);

    const tabs = screen.getAllByTestId('flow-page-tab');
    fireEvent.dragStart(tabs[1]);
    fireEvent.dragOver(tabs[1]);
    fireEvent.drop(tabs[1]);

    expect(props.onReorderPage).not.toHaveBeenCalled();
  });

  it('moves focus and selection with arrow keys and Home/End', () => {
    const props = createProps();
    render(<FlowTabs {...props} />);
    const first = screen.getByRole('tab', { name: 'Page One' });
    first.focus();
    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(props.onSwitchPage).toHaveBeenLastCalledWith('page-2');
    expect(screen.getByRole('tab', { name: 'Page Two' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(props.onSwitchPage).toHaveBeenLastCalledWith('page-3');
    expect(screen.getByRole('tab', { name: 'Page Three' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(first).toHaveFocus();
  });

  it('renames through the keyboard once, then returns focus to the page', () => {
    const props = createProps();
    render(<FlowTabs {...props} />);
    const tab = screen.getByRole('tab', { name: 'Page One' });
    fireEvent.keyDown(tab, { key: 'F2' });
    const input = screen.getByRole('textbox', { name: 'Page name' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Service architecture  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onRenamePage).toHaveBeenCalledExactlyOnceWith('page-1', 'Service architecture');
    expect(props.onSwitchPage).not.toHaveBeenCalled();
    expect(tab).toHaveFocus();
  });

  it('cancels a rename with Escape without saving the draft on blur', () => {
    const props = createProps();
    render(<FlowTabs {...props} />);
    fireEvent.click(screen.getByRole('button', { name: 'Rename page: Page One' }));
    const input = screen.getByRole('textbox', { name: 'Page name' });
    fireEvent.change(input, { target: { value: 'Discard me' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(props.onRenamePage).not.toHaveBeenCalled();
    expect(screen.getByRole('tab', { name: 'Page One' })).toHaveFocus();
  });

  it('offers a keyboard alternative to dragging without leaking keys to the canvas', () => {
    const props = createProps();
    const onCanvasKey = vi.fn();
    render(<div onKeyDown={onCanvasKey}><FlowTabs {...props} /></div>);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Page One' }), { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(props.onReorderPage).toHaveBeenCalledWith('page-1', 'page-2');
    expect(props.onSwitchPage).not.toHaveBeenCalled();
    expect(onCanvasKey).not.toHaveBeenCalled();
  });

});
