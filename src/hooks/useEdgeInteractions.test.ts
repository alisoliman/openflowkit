import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { useFlowStore } from '@/store';
import { useEdgeInteractions } from './useEdgeInteractions';

const flow = vi.hoisted(() => ({ edges: [] as FlowEdge[], nodes: [] as FlowNode[] }));

vi.mock('@/lib/reactflowCompat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reactflowCompat')>()),
  useReactFlow: () => ({
    getEdges: () => flow.edges,
    getNodes: () => flow.nodes,
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

  it('records an undo step before each keyboard edit', () => {
    flow.edges = [selectedEdge];
    const recordHistoryV2 = vi.fn();
    const original = useFlowStore.getState().recordHistoryV2;
    useFlowStore.setState({ recordHistoryV2 });
    const { unmount } = renderHook(() => useEdgeInteractions());

    press('r');
    press('b');

    expect(recordHistoryV2).toHaveBeenCalledTimes(2);
    useFlowStore.setState({ recordHistoryV2: original });
    unmount();
  });

  it('treats a held key as one edit', () => {
    flow.edges = [selectedEdge];
    const recordHistoryV2 = vi.fn();
    const original = useFlowStore.getState().recordHistoryV2;
    useFlowStore.setState({ recordHistoryV2 });
    const { unmount } = renderHook(() => useEdgeInteractions());

    press('r');
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', repeat: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', repeat: true }));

    expect(recordHistoryV2).toHaveBeenCalledTimes(1);
    expect(flow.edges[0]).toMatchObject({ source: 'api', target: 'web' });
    useFlowStore.setState({ recordHistoryV2: original });
    unmount();
  });

  it('does not reverse a mindmap branch', () => {
    flow.edges = [{ ...selectedEdge, source: 'root', target: 'topic' }];
    flow.nodes = [
      { id: 'root', type: 'mindmap', position: { x: 0, y: 0 }, data: { label: 'Root' } },
      { id: 'topic', type: 'mindmap', position: { x: 200, y: 0 }, data: { label: 'Topic' } },
    ];
    const { unmount } = renderHook(() => useEdgeInteractions());

    press('r');

    expect(flow.edges[0]).toMatchObject({ source: 'root', target: 'topic' });
    flow.nodes = [];
    unmount();
  });

  it('leaves modified keys such as Cmd+R to the browser', () => {
    flow.edges = [selectedEdge];
    const { unmount } = renderHook(() => useEdgeInteractions());

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'r', metaKey: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true }));

    expect(flow.edges).toEqual([selectedEdge]);
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
