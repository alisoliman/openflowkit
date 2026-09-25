import { fireEvent, render, screen } from '@testing-library/react';
import { useRef, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { useModalDialog } from './useModalDialog';

function Dialog({ onClose }: { onClose: () => void }) {
  const initialFocusRef = useRef<HTMLButtonElement>(null);
  const ref = useModalDialog({ onClose, initialFocusRef });
  return <div ref={ref} role="dialog" aria-modal="true" aria-label="Example">
    <button ref={initialFocusRef} onClick={onClose}>Close</button>
    <input aria-label="Name" />
    <button>Save</button>
  </div>;
}

describe('useModalDialog', () => {
  it('keeps Tab in the dialog and returns focus and scroll state when it closes', () => {
    document.body.style.overflow = 'auto';
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button onClick={() => setOpen(true)}>Open</button>{open && <Dialog onClose={() => setOpen(false)} />}</>;
    }
    render(<Harness />);
    const opener = screen.getByText('Open');
    opener.focus();
    fireEvent.click(opener);
    const close = screen.getByText('Close');
    const save = screen.getByText('Save');
    expect(close).toHaveFocus();
    expect(document.body.style.overflow).toBe('hidden');
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(save).toHaveFocus();
    fireEvent.keyDown(save, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(document.body.style.overflow).toBe('auto');
    document.body.style.overflow = '';
  });

  it('allows a child widget to consume Escape without closing the dialog', () => {
    const onClose = vi.fn();
    render(<Dialog onClose={onClose} />);
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event.preventDefault();
    screen.getByRole('textbox').dispatchEvent(event);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('returns to page content when the opening menu item has been removed', () => {
    function Harness() {
      const [open, setOpen] = useState(false);
      return <main id="main-content" tabIndex={-1}>
        {!open && <button onClick={() => setOpen(true)}>Open from menu</button>}
        {open && <Dialog onClose={() => setOpen(false)} />}
      </main>;
    }
    render(<Harness />);
    const opener = screen.getByText('Open from menu');
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(screen.getByText('Close'), { key: 'Escape' });
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('closes only the topmost dialog and retains the scroll lock for the parent', () => {
    const parentClose = vi.fn();
    const childClose = vi.fn();
    const parent = render(<Dialog onClose={parentClose} />);
    const child = render(<Dialog onClose={childClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(childClose).toHaveBeenCalledOnce();
    expect(parentClose).not.toHaveBeenCalled();
    child.unmount();
    expect(document.body.style.overflow).toBe('hidden');
    parent.unmount();
    expect(document.body.style.overflow).not.toBe('hidden');
  });
});
