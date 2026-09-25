import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tooltip } from './Tooltip';

const ForwardedButton = React.forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement>
>((props, ref) => <button ref={ref} {...props} />);
ForwardedButton.displayName = 'ForwardedButton';

afterEach(() => vi.useRealTimers());

describe('Tooltip accessible triggers', () => {
  it('associates a forwarded control with its description, preserves existing hints and ref, and dismisses before its dialog', () => {
    const ref = React.createRef<HTMLButtonElement>();
    const onFocus = vi.fn();
    const dialogEscape = vi.fn();
    window.addEventListener('keydown', dialogEscape);
    render(
      <>
        <span id="existing-hint">Uses local history</span>
        <Tooltip text="Restore the last change">
          <ForwardedButton ref={ref} aria-describedby="existing-hint" onFocus={onFocus}>
            Undo
          </ForwardedButton>
        </Tooltip>
      </>
    );
    const control = screen.getByRole('button', { name: 'Undo' });
    expect(ref.current).toBe(control);
    act(() => control.focus());
    const tooltip = screen.getByRole('tooltip');
    expect(control.getAttribute('aria-describedby')?.split(' ')).toEqual([
      'existing-hint',
      tooltip.id,
    ]);
    expect(onFocus).toHaveBeenCalledOnce();
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    expect(control.getAttribute('aria-describedby')).toBe('existing-hint');
    expect(document.activeElement).toBe(control);
    expect(dialogEscape).not.toHaveBeenCalled();
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(dialogEscape).toHaveBeenCalledOnce();
    window.removeEventListener('keydown', dialogEscape);
  });

  it('describes and opens from an enclosing button when the tooltip wraps an info icon', () => {
    render(
      <button>
        Edit current
        <Tooltip text="Modify your existing canvas">
          <svg aria-hidden="true" />
        </Tooltip>
      </button>
    );
    const control = screen.getByRole('button', { name: 'Edit current' });
    act(() => control.focus());
    expect(control.getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
    fireEvent.keyDown(control, { key: 'Escape' });
    expect(control.hasAttribute('aria-describedby')).toBe(false);
  });

  it('keeps pointer interaction with a portalled description from activating its enclosing action', () => {
    const onClick = vi.fn();
    const onPointerDown = vi.fn();
    const onMouseDown = vi.fn();
    render(
      <button onClick={onClick} onPointerDown={onPointerDown} onMouseDown={onMouseDown}>
        Create new
        <Tooltip text="Start fresh with a new diagram"><svg aria-hidden="true" /></Tooltip>
      </button>
    );
    const control = screen.getByRole('button', { name: 'Create new' });
    act(() => control.focus());
    const tooltip = screen.getByRole('tooltip');
    fireEvent.pointerDown(tooltip);
    fireEvent.mouseDown(tooltip);
    fireEvent.click(tooltip);
    expect(onPointerDown).not.toHaveBeenCalled();
    expect(onMouseDown).not.toHaveBeenCalled();
    expect(onClick).not.toHaveBeenCalled();
    expect(screen.getByRole('tooltip')).toBe(tooltip);

    fireEvent.click(control.querySelector('svg')!);
    expect(onClick).toHaveBeenCalledOnce();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('supplies a missing icon-button name without overwriting an explicit name or announcing it twice', () => {
    const { rerender } = render(
      <Tooltip text="Switch to dark mode">
        <button>
          <svg aria-hidden="true" />
        </button>
      </Tooltip>
    );
    const control = screen.getByRole('button', { name: 'Switch to dark mode' });
    act(() => control.focus());
    expect(control.hasAttribute('aria-describedby')).toBe(false);
    rerender(
      <Tooltip text="Switch to dark mode">
        <button aria-label="Appearance settings">
          <svg aria-hidden="true" />
        </button>
      </Tooltip>
    );
    expect(screen.getByRole('button', { name: 'Appearance settings' })).toBeTruthy();
  });

  it('remains readable while the pointer crosses onto the tooltip, then closes after leaving both', () => {
    vi.useFakeTimers();
    render(
      <Tooltip text="A longer explanation">
        <button>More information</button>
      </Tooltip>
    );
    const trigger = screen.getByRole('button').parentElement!;
    fireEvent.mouseEnter(trigger);
    const tooltip = screen.getByRole('tooltip');
    fireEvent.mouseLeave(trigger);
    fireEvent.mouseEnter(tooltip);
    act(() => vi.advanceTimersByTime(200));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    fireEvent.mouseLeave(tooltip);
    act(() => vi.advanceTimersByTime(150));
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('keeps keyboard descriptions open when the mouse leaves and removes them when focus moves away', () => {
    render(
      <>
        <Tooltip text="Change appearance">
          <button>Theme</button>
        </Tooltip>
        <button>Next control</button>
      </>
    );
    const control = screen.getByRole('button', { name: 'Theme' });
    act(() => control.focus());
    fireEvent.mouseLeave(control.parentElement!);
    expect(screen.getByRole('tooltip')).toBeTruthy();
    act(() => screen.getByRole('button', { name: 'Next control' }).focus());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });
});
