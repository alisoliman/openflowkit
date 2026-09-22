import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n/config';
import { useFlowStore } from '@/store';
import { loadPersistedAISettings } from '@/store/aiSettingsPersistence';
import { FlowpilotControls } from './FlowpilotControls';

vi.mock('@/hooks/ai-generation/useCopilotConnection', () => ({
  useCopilotConnection: () => ({ connection: { state: 'ready', status: {
    runtime: 'github-copilot-sdk', authenticated: true,
    models: [{ id: 'account-model', name: 'Account model', multiplier: 0.5 }],
  } } }),
}));

beforeEach(async () => {
  await i18n.changeLanguage('en');
  localStorage.clear();
  sessionStorage.clear();
  useFlowStore.getState().setAISettings({ provider: 'copilot', model: 'auto', storageMode: 'local', autoApply: false });
});

describe('Flowpilot runtime controls', () => {
  it('selects an account model and persists it for subsequent requests', () => {
    render(<FlowpilotControls isGenerating={false} />);
    fireEvent.change(screen.getByRole('combobox', { name: 'Copilot model' }), { target: { value: 'account-model' } });
    expect(useFlowStore.getState().aiSettings.model).toBe('account-model');
    expect(loadPersistedAISettings().model).toBe('account-model');
    expect(screen.getByRole('option', { name: 'Account model (0.5x)' })).toBeInTheDocument();
  });

  it('requires an explicit opt-in to automatic edits and explains undo', () => {
    render(<FlowpilotControls isGenerating={false} />);
    const toggle = screen.getByRole('checkbox', { name: 'Apply edits automatically' });
    expect(toggle).not.toBeChecked();
    fireEvent.click(toggle);
    expect(useFlowStore.getState().aiSettings.autoApply).toBe(true);
    expect(loadPersistedAISettings().autoApply).toBe(true);
    expect(screen.getByText('Completed edits apply immediately. Undo is available after each edit.')).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(loadPersistedAISettings().autoApply).toBe(false);
  });

  it('locks model, execution mode, and undo while a request is running', () => {
    render(<FlowpilotControls isGenerating canUndo onUndo={vi.fn()} />);
    expect(screen.getByRole('combobox', { name: 'Copilot model' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Apply edits automatically' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Undo AI edit' })).toBeDisabled();
  });

  it('exposes the harness undo action when it is safe to use', () => {
    const undo = vi.fn();
    render(<FlowpilotControls isGenerating={false} canUndo onUndo={undo} />);
    fireEvent.click(screen.getByRole('button', { name: 'Undo AI edit' }));
    expect(undo).toHaveBeenCalledOnce();
  });
});
