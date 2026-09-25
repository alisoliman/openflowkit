import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeFlowDeleteDialog, HomeFlowRenameDialog } from './HomeFlowDialogs';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values?.[name] ?? name)
      ),
  }),
}));

describe('Home document dialogs', () => {
  it('selects the existing name and prevents empty or unchanged submissions', () => {
    const onSubmit = vi.fn();
    render(
      <HomeFlowRenameDialog flowName="Checkout" isOpen onClose={vi.fn()} onSubmit={onSubmit} />
    );
    const input = screen.getByRole('textbox', { name: 'Flow name' }) as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('Checkout'.length);
    const save = screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: '   ' } });
    expect(save.disabled).toBe(true);
    fireEvent.change(input, { target: { value: 'Checkout v2' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(onSubmit).toHaveBeenCalledWith('Checkout v2');
  });

  it('starts deletion on Cancel, traps Tab, and returns focus to its trigger after dismissal', () => {
    function Harness() {
      const [open, setOpen] = React.useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Remove Checkout</button>
          <HomeFlowDeleteDialog
            flowName="Checkout"
            isOpen={open}
            onClose={() => setOpen(false)}
            onConfirm={vi.fn()}
          />
        </>
      );
    }
    render(<Harness />);
    const opener = screen.getByRole('button', { name: 'Remove Checkout' });
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: 'Delete flow' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Cancel' }));
    const remove = within(dialog).getByRole('button', { name: 'Delete' });
    remove.focus();
    fireEvent.keyDown(remove, { key: 'Tab' });
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
