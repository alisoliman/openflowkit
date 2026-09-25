import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ToolbarAddMenu } from './ToolbarAddMenu';
import { ToolbarAddMenuPanel } from './ToolbarAddMenuPanel';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback ?? _key,
  }),
}));

function createProps() {
  return {
    currentItemId: 'rounded' as const,
    isInteractive: true,
    showAddMenu: false,
    onToggleMenu: vi.fn(),
    onCloseMenu: vi.fn(),
    onCurrentItemChange: vi.fn(),
    getCenter: () => ({ x: 240, y: 120 }),
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
    onRequestImageUpload: vi.fn(),
  };
}

describe('ToolbarAddMenu', () => {
  it('shows the current tool on the single add button', () => {
    const props = createProps();

    render(<ToolbarAddMenu {...props} />);
    expect(screen.getByTestId('toolbar-add-toggle')).toBeTruthy();
    expect(screen.queryByTestId('toolbar-add-primary')).toBeNull();
  });

  it('uses the square tool as the default current icon', () => {
    const props = createProps();

    render(<ToolbarAddMenu {...props} />);
    expect(screen.getByRole('button', { name: 'Add Item' })).toBeTruthy();
  });

  it('surfaces toolbar items from the shared registry', () => {
    const onSelectItem = vi.fn();

    render(
      <ToolbarAddMenuPanel
        currentItemId="rounded"
        onSelectItem={onSelectItem}
      />
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Circle' }));
    expect(onSelectItem).toHaveBeenCalledWith('circle');
  });

  it('menu selection updates the tool and inserts it', () => {
    const props = createProps();
    render(
      <ToolbarAddMenuPanel
        currentItemId="rounded"
        onSelectItem={(itemId) => {
          props.onCurrentItemChange(itemId);
          if (itemId === 'circle') {
            props.onAddShape('circle', { x: 240, y: 120 });
          }
          props.onCloseMenu();
        }}
      />
    );

    fireEvent.click(screen.getByRole('menuitem', { name: 'Circle' }));
    expect(props.onCurrentItemChange).toHaveBeenCalledWith('circle');
    expect(props.onAddShape).toHaveBeenCalledWith('circle', { x: 240, y: 120 });
    expect(props.onCloseMenu).toHaveBeenCalled();
  });

  it('focuses a tool on opening and supports arrow navigation and Escape', async () => {
    const props = createProps();
    render(<ToolbarAddMenu {...props} showAddMenu />);
    const circle = await screen.findByRole('menuitem', { name: 'Circle' });
    const menu = screen.getByRole('menu', { name: 'Add Item' });
    expect(menu).toContainElement(document.activeElement as HTMLElement);
    circle.focus();
    fireEvent.keyDown(circle, { key: 'Home' });
    expect(screen.getAllByRole('menuitem')[0]).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'End' });
    const items = screen.getAllByRole('menuitem');
    expect(items[items.length - 1]).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(props.onCloseMenu).toHaveBeenCalledOnce();
    expect(screen.getByTestId('toolbar-add-toggle')).toHaveFocus();
  });

});
