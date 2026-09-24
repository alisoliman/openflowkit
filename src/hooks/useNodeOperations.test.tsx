import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ReactFlowProvider } from '@/lib/reactflowCompat';
import type { FlowNode } from '@/lib/types';
import { useFlowStore } from '@/store';
import { useNodeOperations } from './useNodeOperations';

function createNode(id: string, overrides: Partial<FlowNode> = {}): FlowNode {
  return { id, type: 'process', position: { x: 0, y: 0 }, data: { label: id }, ...overrides };
}

function renderNodeOperations(recordHistory = vi.fn()) {
  const { result } = renderHook(() => useNodeOperations(recordHistory), {
    wrapper: ({ children }: { children: React.ReactNode }) => <ReactFlowProvider>{children}</ReactFlowProvider>,
  });
  return { result, recordHistory };
}

describe('useNodeOperations', () => {
  beforeEach(() => {
    useFlowStore.setState({
      nodes: [createNode('a'), createNode('b'), createNode('c')],
      edges: [
        { id: 'a-b', source: 'a', target: 'b' },
        { id: 'b-c', source: 'b', target: 'c' },
        { id: 'c-a', source: 'c', target: 'a' },
      ],
      selectedNodeId: null,
      selectedEdgeId: null,
    });
  });

  it('removes the edges of a deleted node along with it', () => {
    const { result, recordHistory } = renderNodeOperations();

    act(() => {
      result.current.deleteNode('a');
    });

    expect(recordHistory).toHaveBeenCalledTimes(1);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['b', 'c']);
    expect(useFlowStore.getState().edges.map((edge) => edge.id)).toEqual(['b-c']);
  });

  it('deletes what is selected, flagged in React Flow or only inspected, as one undo step', () => {
    useFlowStore.setState((state) => ({
      // A node added from the toolbar is inspected without being flagged in React Flow.
      nodes: state.nodes.map((node) => (node.id === 'b' ? { ...node, selected: true } : node)),
      edges: state.edges.map((edge) => (edge.id === 'c-a' ? { ...edge, selected: true } : edge)),
      selectedNodeId: 'a',
    }));
    const { result, recordHistory } = renderNodeOperations();

    act(() => {
      result.current.deleteSelection();
    });

    expect(recordHistory).toHaveBeenCalledTimes(1);
    expect(useFlowStore.getState().nodes.map((node) => node.id)).toEqual(['c']);
    expect(useFlowStore.getState().edges).toEqual([]);
    expect(useFlowStore.getState().selectedNodeId).toBeNull();
  });

  it('records nothing when the selection no longer exists', () => {
    useFlowStore.setState({ selectedNodeId: 'gone', selectedEdgeId: 'gone-too' });
    const { result, recordHistory } = renderNodeOperations();

    act(() => {
      result.current.deleteSelection();
      result.current.deleteNode('gone');
    });

    expect(recordHistory).not.toHaveBeenCalled();
    expect(useFlowStore.getState().nodes).toHaveLength(3);
  });

  it('releases the children of a deleted section', () => {
    useFlowStore.setState({
      nodes: [
        createNode('frame', { type: 'section', position: { x: 100, y: 100 }, selected: true }),
        createNode('inside', { position: { x: 10, y: 20 }, parentId: 'frame' }),
      ],
      edges: [],
    });
    const { result } = renderNodeOperations();

    act(() => {
      result.current.deleteSelection();
    });

    const [inside] = useFlowStore.getState().nodes;
    expect(useFlowStore.getState().nodes).toHaveLength(1);
    expect(inside).toMatchObject({ id: 'inside', position: { x: 110, y: 120 } });
    expect(inside.parentId).toBeUndefined();
  });
});
