import { useEffect } from 'react';
import { APP_EVENT_NAMES } from '@/lib/legacyBranding';
import { useFlowStore } from '@/store';

export type MindmapTopicActionType = 'child' | 'sibling';
export type MindmapTopicSide = 'left' | 'right' | null;

const MINDMAP_TOPIC_ACTION_REQUEST_EVENT = APP_EVENT_NAMES.mindmapTopicActionRequest;

interface MindmapTopicActionRequestDetail {
  nodeId: string;
  action: MindmapTopicActionType;
  side?: MindmapTopicSide;
}

export function requestMindmapTopicAction(
  nodeId: string,
  action: MindmapTopicActionType,
  side?: MindmapTopicSide
): void {
  window.dispatchEvent(
    new CustomEvent<MindmapTopicActionRequestDetail>(MINDMAP_TOPIC_ACTION_REQUEST_EVENT, {
      detail: {
        nodeId,
        action,
        side,
      },
    })
  );
}

export function useMindmapTopicActionRequest(
  onRequest: (detail: MindmapTopicActionRequestDetail) => void
): void {
  useEffect(() => {
    const handleRequest = (event: Event): void => {
      const customEvent = event as CustomEvent<MindmapTopicActionRequestDetail>;
      // Topic buttons stay on screen during a Flowpilot turn, which owns the page until it ends.
      if (!customEvent.detail?.nodeId || !customEvent.detail.action || useFlowStore.getState().agentTurn) {
        return;
      }
      onRequest(customEvent.detail);
    };

    window.addEventListener(MINDMAP_TOPIC_ACTION_REQUEST_EVENT, handleRequest as EventListener);
    return () => {
      window.removeEventListener(MINDMAP_TOPIC_ACTION_REQUEST_EVENT, handleRequest as EventListener);
    };
  }, [onRequest]);
}
