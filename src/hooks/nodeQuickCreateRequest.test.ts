import { act, renderHook } from '@testing-library/react';
import { ReactFlowProvider } from '@/lib/reactflowCompat';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useFlowStore } from '@/store';
import { requestNodeQuickCreate, useNodeQuickCreateRequest } from './nodeQuickCreateRequest';
import { useEdgeOperations } from './useEdgeOperations';

describe('nodeQuickCreateRequest', () => {
  beforeEach(() => {
    const nodes = [
      { id: 'node-1', type: 'process', position: { x: 0, y: 0 }, data: { label: 'One' } },
    ];
    act(() => {
      useFlowStore.setState({
        nodes,
        edges: [],
        tabs: [{ id: 'tab-1', name: 'Tab 1', nodes, edges: [], history: { past: [], future: [] } }],
        activeTabId: 'tab-1',
        agentTurn: null,
      });
    });
  });

  it('dispatches quick create requests to listeners', () => {
    const onRequest = vi.fn();
    renderHook(() => useNodeQuickCreateRequest(onRequest));

    requestNodeQuickCreate('node-1', 'right');

    expect(onRequest).toHaveBeenCalledWith('node-1', 'right');
  });

  it('leaves the page alone while a Flowpilot turn edits it', () => {
    renderHook(
      () => {
        const { createConnectedNodeInDirection } = useEdgeOperations(
          useFlowStore.getState().recordHistoryV2
        );
        useNodeQuickCreateRequest(createConnectedNodeInDirection);
      },
      { wrapper: ReactFlowProvider }
    );
    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    });
    const { nodes, edges, tabs } = useFlowStore.getState();

    act(() => {
      requestNodeQuickCreate('node-1', 'right');
    });

    expect(useFlowStore.getState().nodes).toBe(nodes);
    expect(useFlowStore.getState().edges).toBe(edges);
    expect(useFlowStore.getState().tabs[0].history).toBe(tabs[0].history);

    act(() => {
      useFlowStore.getState().setAgentTurn(null);
    });
    act(() => {
      requestNodeQuickCreate('node-1', 'right');
    });

    expect(useFlowStore.getState().nodes).toHaveLength(2);
    expect(useFlowStore.getState().edges).toHaveLength(1);
    expect(useFlowStore.getState().tabs[0].history.past).toHaveLength(1);
  });
});
