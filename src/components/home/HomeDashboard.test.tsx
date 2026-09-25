import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HomeDashboard, type HomeFlowCard } from './HomeDashboard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_, name: string) =>
        String(values?.[name] ?? name)
      ),
  }),
}));

const flows: HomeFlowCard[] = [
  {
    id: 'alpha',
    name: 'Alpha architecture',
    nodeCount: 4,
    edgeCount: 3,
    updatedAt: '2026-09-22T12:00:00Z',
    preview: null,
  },
  {
    id: 'release',
    name: 'Release process',
    nodeCount: 6,
    edgeCount: 5,
    updatedAt: '2026-09-24T12:00:00Z',
    preview: null,
  },
];

function renderDashboard(overrides: Partial<React.ComponentProps<typeof HomeDashboard>> = {}) {
  const actions = {
    onCreateNew: vi.fn(),
    onOpenTemplates: vi.fn(),
    onPromptWithAI: vi.fn(),
    onImportJSON: vi.fn(),
    onOpenFlow: vi.fn(),
    onRenameFlow: vi.fn(),
    onDuplicateFlow: vi.fn(),
    onDeleteFlow: vi.fn(),
  };
  render(<HomeDashboard flows={flows} {...actions} {...overrides} />);
  return actions;
}

describe('HomeDashboard workspace discovery', () => {
  it('keeps AI, templates, and import available when diagrams exist', () => {
    const actions = renderDashboard();
    fireEvent.click(screen.getByTestId('home-generate-with-ai'));
    fireEvent.click(screen.getByTestId('home-open-templates'));
    fireEvent.click(screen.getByTestId('home-import-file'));
    expect(actions.onPromptWithAI).toHaveBeenCalledOnce();
    expect(actions.onOpenTemplates).toHaveBeenCalledOnce();
    expect(actions.onImportJSON).toHaveBeenCalledOnce();
  });

  it('sorts by last edited and allows an alphabetical sort without mutating the source', () => {
    renderDashboard();
    const names = () =>
      screen.getAllByRole('article').map((card) => within(card).getByRole('heading').textContent);
    expect(names()).toEqual(['Release process', 'Alpha architecture']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Sort diagrams' }), {
      target: { value: 'name' },
    });
    expect(names()).toEqual(['Alpha architecture', 'Release process']);
    expect(flows[0].id).toBe('alpha');
  });

  it('searches case-insensitively and restores results and search focus after a no-results state', () => {
    renderDashboard();
    const search = screen.getByRole('textbox', { name: 'Search diagrams…' });
    fireEvent.change(search, { target: { value: ' RELEASE ' } });
    expect(screen.getByRole('button', { name: 'Open Release process' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Open Alpha architecture' })).toBeNull();
    fireEvent.change(search, { target: { value: 'missing' } });
    const emptyState = screen.getByRole('status');
    expect(within(emptyState).getByText('No matching diagrams')).toBeTruthy();
    fireEvent.click(within(emptyState).getByRole('button', { name: 'Clear search' }));
    expect(screen.getAllByRole('article')).toHaveLength(2);
    expect(document.activeElement).toBe(search);
  });

  it('exposes each document as a native button and keeps document actions separate from opening', () => {
    const actions = renderDashboard();
    const card = screen
      .getByRole('button', { name: 'Open Alpha architecture' })
      .closest('article')!;
    fireEvent.click(within(card).getByRole('button', { name: 'Rename' }));
    expect(actions.onRenameFlow).toHaveBeenCalledWith('alpha');
    expect(actions.onOpenFlow).not.toHaveBeenCalled();
    fireEvent.click(within(card).getByRole('button', { name: 'Open Alpha architecture' }));
    expect(actions.onOpenFlow).toHaveBeenCalledWith('alpha');
  });
});
