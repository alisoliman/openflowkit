import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowEdge } from '@/lib/types';
import { useFlowStore } from '@/store';
import { useEdgeInteractions } from './useEdgeInteractions';

const flow = vi.hoisted(() => ({ edges: [] as FlowEdge[] }));

vi.mock('@/lib/reactflowCompat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reactflowCompat')>()),
  useReactFlow: () => ({
    getEdges: () => flow.edges,
    setEdges: (update: (edges: FlowEdge[]) => FlowEdge[]) => {
      flow.edges = update(flow.edges);
    },
  }),
}));

const selectedEdge = {
  id: 'e1',
  source: 'web',
  target: 'api',
  sourceHandle: 'right',
  targetHandle: 'left',
  selected: true,
} as FlowEdge;

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key }));
}

describe('useEdgeInteractions', () => {
  afterEach(() => {
    useFlowStore.getState().setAgentTurn(null);
  });

  it('reverses and toggles the selected edge from the keyboard', () => {
    flow.edges = [selectedEdge];
    const { unmount } = renderHook(() => useEdgeInteractions());

    press('r');
    expect(flow.edges[0]).toMatchObject({ source: 'api', target: 'web', sourceHandle: 'left', targetHandle: 'right' });

    press('b');
    expect(flow.edges[0].markerStart).toBeDefined();
    unmount();
  });

  it('leaves edges alone while Flowpilot runs a turn', () => {
    flow.edges = [selectedEdge];
    useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'diagram' });
    const { unmount } = renderHook(() => useEdgeInteractions());

    press('r');
    press('b');

    expect(flow.edges).toEqual([selectedEdge]);
    unmount();
  });
});
