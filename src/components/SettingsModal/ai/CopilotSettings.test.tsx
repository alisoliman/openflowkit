import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n/config';
import { CopilotSettings } from './CopilotSettings';

beforeEach(async () => { await i18n.changeLanguage('en'); });

describe('Copilot settings', () => {
  it('offers browser GitHub sign-in instead of CLI instructions on hosted deployments', () => {
    render(<CopilotSettings
      connection={{ state: 'ready', status: {
        runtime: 'github-copilot-sdk', mode: 'hosted', authenticated: false, signedIn: false, models: [],
      } }}
      onRefresh={vi.fn()} model="auto" onModelChange={vi.fn()}
    />);
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeEnabled();
    expect(screen.queryByText('gh copilot login')).not.toBeInTheDocument();
    expect(screen.getByText(/seven days/)).toBeInTheDocument();
    expect(screen.getByText(/encrypted on the server/)).toBeInTheDocument();
    expect(document.querySelector('input[type="password"]')).toBeNull();
  });

  it('lets users disconnect a GitHub account even when Copilot access is denied', () => {
    render(<CopilotSettings
      connection={{ state: 'ready', status: {
        runtime: 'github-copilot-sdk', mode: 'hosted', authenticated: false, signedIn: true,
        login: 'test-user', models: [], issue: 'Copilot is disabled by your organization.',
      } }}
      onRefresh={vi.fn()} model="auto" onModelChange={vi.fn()}
    />);
    expect(screen.getByRole('status')).toHaveTextContent('GitHub connected as test-user');
    expect(screen.getByRole('status')).toHaveTextContent('Copilot is disabled');
    expect(screen.getByRole('button', { name: 'Disconnect GitHub' })).toBeEnabled();
    expect(screen.getByRole('combobox')).toBeDisabled();
  });

  it('shows CLI setup rather than a browser credential field when signed out', () => {
    const refresh = vi.fn();
    render(<CopilotSettings
      connection={{ state: 'ready', status: { runtime: 'github-copilot-sdk', authenticated: false, models: [] } }}
      onRefresh={refresh}
      model="auto"
      onModelChange={vi.fn()}
    />);
    expect(screen.getByText('gh copilot login')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Copilot is not connected');
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeDisabled();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Check connection' }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('shows account-provided models and changes selection without a hard-coded catalog', () => {
    const change = vi.fn();
    render(<CopilotSettings
      connection={{ state: 'ready', status: {
        runtime: 'github-copilot-sdk', authenticated: true, login: 'test-user',
        models: [{ id: 'account-model', name: 'Account model', vision: true, multiplier: 0.5 }],
      } }}
      onRefresh={vi.fn()}
      model="auto"
      onModelChange={change}
    />);
    expect(screen.getByRole('status')).toHaveTextContent('Connected as test-user');
    expect(screen.getByRole('option', { name: 'Account model (0.5x)' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Model' }), { target: { value: 'account-model' } });
    expect(change).toHaveBeenCalledExactlyOnceWith('account-model');
  });

  it('exposes loading and recovery states accessibly', () => {
    const { rerender } = render(<CopilotSettings
      connection={{ state: 'checking' }} onRefresh={vi.fn()} model="auto" onModelChange={vi.fn()}
    />);
    expect(screen.getByRole('status')).toHaveTextContent('Checking Copilot connection');
    expect(screen.getByRole('button', { name: 'Check connection' })).toBeDisabled();
    rerender(<CopilotSettings
      connection={{ state: 'unavailable', message: 'Start the local runtime.' }}
      onRefresh={vi.fn()} model="auto" onModelChange={vi.fn()}
    />);
    expect(screen.getByRole('status')).toHaveTextContent('Start the local runtime.');
    expect(screen.getByRole('button', { name: 'Check connection' })).toBeEnabled();
  });

  it('keeps a stale model visible so the user can explicitly replace it', () => {
    render(<CopilotSettings
      connection={{ state: 'ready', status: { runtime: 'github-copilot-sdk', authenticated: true, models: [] } }}
      onRefresh={vi.fn()} model="removed-model" onModelChange={vi.fn()}
    />);
    expect(screen.getByRole('combobox')).toHaveValue('removed-model');
    expect(screen.getByRole('option', { name: 'removed-model (unavailable)' })).toBeDisabled();
  });
});
