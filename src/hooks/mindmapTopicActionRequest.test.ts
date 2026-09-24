import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useFlowStore } from '@/store';
import {
  requestMindmapTopicAction,
  useMindmapTopicActionRequest,
} from './mindmapTopicActionRequest';
import { useMindmapNodeOperations } from './node-operations/useMindmapNodeOperations';

describe('mindmapTopicActionRequest', () => {
  beforeEach(() => {
    const nodes = [
      {
        id: 'root',
        type: 'mindmap',
        position: { x: 0, y: 0 },
        data: { label: 'Root', mindmapDepth: 0 },
      },
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

  it('leaves the page alone while a Flowpilot turn edits it', () => {
    renderHook(() => {
      const { handleAddMindmapChild } = useMindmapNodeOperations(
        useFlowStore.getState().recordHistoryV2
      );
      useMindmapTopicActionRequest(({ nodeId, side }) => {
        handleAddMindmapChild(nodeId, side ?? null);
      });
    });
    act(() => {
      useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-1' });
    });
    const { nodes, edges, tabs } = useFlowStore.getState();

    act(() => {
      requestMindmapTopicAction('root', 'child', 'right');
    });

    expect(useFlowStore.getState().nodes).toBe(nodes);
    expect(useFlowStore.getState().edges).toBe(edges);
    expect(useFlowStore.getState().tabs[0].history).toBe(tabs[0].history);

    act(() => {
      useFlowStore.getState().setAgentTurn(null);
    });
    act(() => {
      requestMindmapTopicAction('root', 'child', 'right');
    });

    expect(useFlowStore.getState().nodes).toHaveLength(2);
    expect(useFlowStore.getState().edges).toHaveLength(1);
    expect(useFlowStore.getState().tabs[0].history.past).toHaveLength(1);
  });
});
