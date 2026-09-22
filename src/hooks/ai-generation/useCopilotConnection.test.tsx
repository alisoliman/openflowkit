import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCopilotStatus } from '@/services/copilot/client';
import { useCopilotConnection } from './useCopilotConnection';

vi.mock('@/services/copilot/client', () => ({ getCopilotStatus: vi.fn() }));

beforeEach(() => {
  vi.mocked(getCopilotStatus).mockResolvedValue({
    runtime: 'github-copilot-sdk', authenticated: true, models: [],
  });
});
afterEach(() => vi.clearAllMocks());

describe('Copilot connection lifecycle', () => {
  it('does not start a runtime probe for alternative providers', () => {
    renderHook(() => useCopilotConnection(false));
    expect(getCopilotStatus).not.toHaveBeenCalled();
  });

  it('refreshes after terminal login when the user returns to the browser', async () => {
    vi.mocked(getCopilotStatus).mockResolvedValueOnce({
      runtime: 'github-copilot-sdk', authenticated: false, models: [],
    });
    const { result } = renderHook(() => useCopilotConnection(true));
    await waitFor(() => expect(result.current.connection).toMatchObject({ state: 'ready', status: { authenticated: false } }));
    act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(result.current.connection).toMatchObject({ state: 'ready', status: { authenticated: true } }));
  });

  it('surfaces unavailable runtimes and supports an explicit retry', async () => {
    vi.mocked(getCopilotStatus).mockRejectedValueOnce(new Error('Start the local app'));
    const { result } = renderHook(() => useCopilotConnection(true));
    await waitFor(() => expect(result.current.connection).toEqual({ state: 'unavailable', message: 'Start the local app' }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.connection.state).toBe('ready'));
  });

  it('cancels in-flight discovery when the provider changes or the component unmounts', () => {
    vi.mocked(getCopilotStatus).mockReturnValue(new Promise(() => undefined));
    const { rerender, unmount } = renderHook(({ enabled }) => useCopilotConnection(enabled), { initialProps: { enabled: true } });
    const firstSignal = vi.mocked(getCopilotStatus).mock.calls[0][0];
    rerender({ enabled: false });
    expect(firstSignal?.aborted).toBe(true);
    rerender({ enabled: true });
    const secondSignal = vi.mocked(getCopilotStatus).mock.calls[1][0];
    unmount();
    expect(secondSignal?.aborted).toBe(true);
  });
});
