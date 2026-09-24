import { useEffect } from 'react';
import { APP_EVENT_NAMES } from '@/lib/legacyBranding';

const EDGE_LABEL_EDIT_REQUEST_EVENT = APP_EVENT_NAMES.edgeLabelEditRequest;

interface EdgeLabelEditRequestDetail {
  edgeId: string;
}

export function requestEdgeLabelEdit(edgeId: string): void {
  window.dispatchEvent(
    new CustomEvent<EdgeLabelEditRequestDetail>(EDGE_LABEL_EDIT_REQUEST_EVENT, {
      detail: { edgeId },
    })
  );
}

export function useEdgeLabelEditRequest(edgeId: string, onRequest: () => void): void {
  useEffect(() => {
    const handleRequest = (event: Event): void => {
      if ((event as CustomEvent<EdgeLabelEditRequestDetail>).detail?.edgeId === edgeId) {
        onRequest();
      }
    };

    window.addEventListener(EDGE_LABEL_EDIT_REQUEST_EVENT, handleRequest);
    return () => {
      window.removeEventListener(EDGE_LABEL_EDIT_REQUEST_EVENT, handleRequest);
    };
  }, [edgeId, onRequest]);
}
