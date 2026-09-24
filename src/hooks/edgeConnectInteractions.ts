import type { Connection } from '@/lib/reactflowCompat';

export function isPaneTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.classList.contains('react-flow__pane') || target.closest('.react-flow__pane') !== null;
}

// Edge labels and their editors render in the label layer, outside the edge's own element.
export function isCanvasBackgroundTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (!isPaneTarget(target)) return false;
  return target.closest('.react-flow__node, .react-flow__edge, .react-flow__edgelabel-renderer') === null;
}

// React Flow reports dragging an edge's end as a connection too, starting from its reconnect anchor.
export function isEdgeReconnectTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('.react-flow__edgeupdater') !== null;
}

export function getPointerClientPosition(
  event: unknown
): { x: number; y: number } | null {
  if (!event || typeof event !== 'object') return null;

  const mouseEvent = event as { clientX?: unknown; clientY?: unknown };
  if (typeof mouseEvent.clientX === 'number' && typeof mouseEvent.clientY === 'number') {
    return { x: mouseEvent.clientX, y: mouseEvent.clientY };
  }

  const touchEvent = event as { changedTouches?: ArrayLike<{ clientX: number; clientY: number }> };
  const firstTouch = touchEvent.changedTouches?.[0];
  if (firstTouch) {
    return { x: firstTouch.clientX, y: firstTouch.clientY };
  }

  return null;
}

export function normalizeConnectionFromDragStart(
  connection: Connection,
  dragStartNodeId: string | null,
  dragStartHandleId: string | null
): Connection {
  if (!dragStartNodeId || !connection.source || !connection.target) {
    return connection;
  }

  if (connection.source === dragStartNodeId) {
    return {
      ...connection,
      sourceHandle: connection.sourceHandle ?? dragStartHandleId,
    };
  }

  if (connection.target === dragStartNodeId) {
    return {
      ...connection,
      source: connection.target,
      target: connection.source,
      sourceHandle: connection.targetHandle ?? dragStartHandleId,
      targetHandle: connection.sourceHandle,
    };
  }

  return {
    ...connection,
    sourceHandle: connection.sourceHandle ?? dragStartHandleId,
  };
}
