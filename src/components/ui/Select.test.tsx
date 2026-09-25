import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Select } from './Select';

describe('Select', () => {
  it('closes when clicking outside', async () => {
    const onChange = vi.fn();

    render(
      <div>
        <Select
          value="production"
          onChange={onChange}
          options={[
            { value: 'production', label: 'Production' },
            { value: 'staging', label: 'Staging' },
          ]}
        />
        <button type="button">Outside</button>
      </div>
    );

    const trigger = screen.getByRole('combobox', { name: 'Production' });

    fireEvent.click(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => {
      expect(trigger.getAttribute('aria-expanded')).toBe('false');
    });
  });

  it('renders options when opened and allows selecting one', async () => {
    const onChange = vi.fn();

    render(
      <Select
        value="production"
        onChange={onChange}
        options={[
          { value: 'production', label: 'Production' },
          { value: 'staging', label: 'Staging' },
        ]}
      />
    );

    fireEvent.click(screen.getByRole('combobox', { name: 'Production' }));

    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getByRole('option', { name: 'Staging' })).toBeTruthy();

    fireEvent.click(within(listbox).getByRole('option', { name: 'Staging' }));

    expect(onChange).toHaveBeenCalledWith('staging');
  });

  it('supports keyboard navigation, typeahead, selection and Escape without losing focus', () => {
    const onChange = vi.fn();
    render(<Select aria-label="Environment" value="production" onChange={onChange} options={[
      { value: 'production', label: 'Production' }, { value: 'staging', label: 'Staging' }, { value: 'test', label: 'Test' },
    ]} />);
    const trigger = screen.getByRole('combobox', { name: 'Environment' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'End' });
    expect(trigger.getAttribute('aria-activedescendant')).toBe(screen.getByRole('option', { name: 'Test' }).id);
    fireEvent.keyDown(trigger, { key: 's' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith('staging');
    expect(trigger).toHaveFocus();
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    fireEvent.keyDown(trigger, { key: 'ArrowDown' });
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});
