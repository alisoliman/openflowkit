import { useCallback, useEffect, useState } from 'react';
import { getCopilotStatus, type CopilotConnectionState } from '@/services/copilot/client';
import { COPILOT_SETUP_MESSAGE } from '@/services/copilot/protocol';

export function useCopilotConnection(enabled: boolean) {
  const [connection, setConnection] = useState<CopilotConnectionState>({ state: 'checking' });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => {
    setConnection({ state: 'checking' });
    setAttempt((previous) => previous + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let disposed = false;
    const timeout = setTimeout(() => controller.abort(new Error(COPILOT_SETUP_MESSAGE)), 30_000);
    void getCopilotStatus(controller.signal).then((status) => {
      if (!disposed) setConnection({ state: 'ready', status });
    }).catch((error: unknown) => {
      if (!disposed) {
        setConnection({
          state: 'unavailable',
          message: error instanceof Error && error.name !== 'TimeoutError' ? error.message : COPILOT_SETUP_MESSAGE,
        });
      }
    }).finally(() => {
      clearTimeout(timeout);
    });
    return () => {
      disposed = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [enabled, attempt]);

  useEffect(() => {
    if (!enabled) return;
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [enabled, refresh]);

  return { connection, refresh };
}
