import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeTemplatesView } from './HomeTemplatesView';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values?.[name] ?? name)
      ),
  }),
}));

describe('Home template discovery', () => {
  it('finds templates by editable details and recovers from search/category combinations with no matches', () => {
    render(<HomeTemplatesView onUseTemplate={vi.fn()} />);
    const search = screen.getByRole('textbox', { name: /Search templates/i });
    fireEvent.change(search, { target: { value: 'canary environment' } });
    expect(screen.getByRole('button', { name: /Production Release Train/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /AWS Event-Driven SaaS Platform/i })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: /^AWS/i }));
    expect(screen.getByText('No matching templates')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reset filters' }));
    expect(screen.getByRole('button', { name: /AWS Event-Driven SaaS Platform/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Product Discovery Workshop Map/i })).toBeTruthy();
    expect(document.activeElement).toBe(search);
  });

  it('traps the preview keyboard focus, dismisses on Escape, and restores the selected card', () => {
    render(<HomeTemplatesView onUseTemplate={vi.fn()} />);
    const template = screen.getByRole('button', { name: /AWS Event-Driven SaaS Platform/i });
    template.focus();
    fireEvent.click(template);
    const dialog = screen.getByRole('dialog', { name: 'AWS Event-Driven SaaS Platform' });
    const close = within(dialog).getByRole('button', { name: 'Close template preview' });
    expect(document.activeElement).toBe(close);
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(
      within(dialog).getByRole('button', { name: 'Use Template' })
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(template);
  });
});
