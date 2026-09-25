import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { IconPicker } from './IconPicker';

describe('IconPicker', () => {
  it('names search and exposes the selected built-in icon', () => {
    const onSelectBuiltInIcon = vi.fn();
    const props = {
      onSelectBuiltInIcon,
      onSelectProviderIcon: vi.fn(),
      onCustomIconChange: vi.fn(),
    };
    const { rerender } = render(<IconPicker {...props} selectedIcon="none" />);

    expect(screen.getByRole('button', { name: 'No Icon', pressed: true })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search icons...' }), { target: { value: 'Database' } });
    fireEvent.click(screen.getByRole('button', { name: 'Database', pressed: false }));
    expect(onSelectBuiltInIcon).toHaveBeenCalledWith('Database');

    rerender(<IconPicker {...props} selectedIcon="Database" />);
    expect(screen.getByRole('button', { name: 'Database', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'No Icon', pressed: false })).toBeTruthy();
  });
});
