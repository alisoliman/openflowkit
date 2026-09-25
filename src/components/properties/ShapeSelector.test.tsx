import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ShapeSelector } from './ShapeSelector';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

describe('ShapeSelector', () => {
  it('names shapes and exposes the default and updated selection', () => {
    const onChange = vi.fn();
    const { rerender } = render(<ShapeSelector onChange={onChange} />);

    expect(screen.getByRole('group', { name: 'Shape' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rounded rectangle', pressed: true })).toHaveAttribute('type', 'button');
    expect(screen.getAllByRole('button', { pressed: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Cylinder', pressed: false }));
    expect(onChange).toHaveBeenCalledWith('cylinder');

    rerender(<ShapeSelector selectedShape="cylinder" onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Cylinder', pressed: true })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Rounded rectangle', pressed: false })).toBeTruthy();
  });
});
