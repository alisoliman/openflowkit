import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/i18n/config';
import { disconnectHostedCopilot, startHostedCopilotConnection } from '@/services/copilot/client';
import { HostedCopilotConnection } from './HostedCopilotConnection';

vi.mock('@/services/copilot/client', async (original) => ({
  ...await original<typeof import('@/services/copilot/client')>(),
  startHostedCopilotConnection: vi.fn(),
  disconnectHostedCopilot: vi.fn(),
}));

beforeEach(async () => { vi.resetAllMocks(); await i18n.changeLanguage('en'); });

describe('hosted connection actions', () => {
  it('reports sign-in failures inline and restores a usable retry action', async () => {
    vi.mocked(startHostedCopilotConnection).mockRejectedValue(new Error('GitHub sign-in is busy. Please retry.'));
    render(<HostedCopilotConnection connection={{ state: 'ready', status: {
      runtime: 'github-copilot-sdk', mode: 'hosted', authenticated: false, signedIn: false, models: [],
    } }} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Connect GitHub' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub sign-in is busy');
    expect(screen.getByRole('button', { name: 'Connect GitHub' })).toBeEnabled();
  });

  it('disconnects without deleting diagrams or changing provider credentials', async () => {
    vi.mocked(disconnectHostedCopilot).mockResolvedValue(undefined);
    const refresh = vi.fn();
    render(<HostedCopilotConnection connection={{ state: 'ready', status: {
      runtime: 'github-copilot-sdk', mode: 'hosted', authenticated: true, signedIn: true,
      login: 'test-user', models: [],
    } }} onRefresh={refresh} />);
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(disconnectHostedCopilot).toHaveBeenCalledOnce();
  });
});
