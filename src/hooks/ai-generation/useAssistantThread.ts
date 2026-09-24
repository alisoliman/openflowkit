import { useCallback, useEffect, useRef, useState } from 'react';
import { createLogger } from '@/lib/logger';
import { useToast } from '@/components/ui/ToastContext';
import type { AssistantThreadItem } from '@/services/flowpilot/types';
import { expirePendingPreviews, interruptUnfinishedAgentTurns } from '@/services/flowpilot/thread';
import { loadAssistantThreadHistory, saveAssistantThreadHistory } from './chatHistoryStorage';

interface ThreadState {
  documentId: string;
  items: AssistantThreadItem[];
  ready: boolean;
}

const logger = createLogger({ scope: 'AssistantThread' });

export function useAssistantThread(documentId: string) {
  const { addToast } = useToast();
  const [state, setState] = useState<ThreadState>({ documentId, items: [], ready: false });
  const current = useRef(state);

  const persist = useCallback((items: AssistantThreadItem[]) => {
    void saveAssistantThreadHistory(documentId, items).catch((error: unknown) => {
      logger.error('Could not save Flowpilot conversation.', { error });
      addToast('Could not save the Flowpilot conversation. Keep this tab open and try again.', 'error');
    });
  }, [addToast, documentId]);

  useEffect(() => {
    let disposed = false;
    void loadAssistantThreadHistory(documentId).then((items) => {
      if (disposed) return;
      const restored = interruptUnfinishedAgentTurns(expirePendingPreviews(items));
      const next = { documentId, items: restored, ready: true };
      current.current = next;
      setState(next);
      if (restored.some((item, index) => item !== items[index])) persist(restored);
    }).catch((error: unknown) => {
      if (disposed) return;
      logger.error('Could not restore Flowpilot conversation.', { error });
      addToast('Could not restore the Flowpilot conversation. Reload this tab to retry.', 'error');
    });
    return () => { disposed = true; };
  }, [addToast, documentId, persist]);

  const updateThread = useCallback((update: (items: AssistantThreadItem[]) => AssistantThreadItem[]) => {
    if (current.current.documentId !== documentId || !current.current.ready) {
      throw new Error('The Flowpilot conversation is still loading. Please try again in a moment.');
    }
    const next = { ...current.current, items: update(current.current.items) };
    current.current = next;
    setState(next);
    persist(next.items);
  }, [documentId, persist]);

  const appendThreadItem = useCallback((item: AssistantThreadItem) => {
    updateThread((items) => [...items, item]);
  }, [updateThread]);

  return {
    assistantThread: state.documentId === documentId ? state.items : [],
    threadReady: state.documentId === documentId && state.ready,
    updateThread,
    appendThreadItem,
  };
}
