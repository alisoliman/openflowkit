import React from 'react';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { APP_STORAGE_KEYS } from '@/lib/legacyBranding';
import { useFlowStore } from '@/store';
import { EdgeRouteSection } from '@/components/properties/edge/EdgeRouteSection';
import { useClipboardOperations } from './useClipboardOperations';

afterEach(() => {
  localStorage.removeItem(APP_STORAGE_KEYS.clipboard);
  useFlowStore.setState({ nodes: [], edges: [], selectedNodeId: null, agentTurn: null });
});

describe('clipboard route geometry', () => {
  it.each([
    { position: undefined, offset: { x: 50, y: 50 } },
    { position: { x: 900, y: 400 }, offset: { x: 1000, y: 360 } },
  ])('moves pasted bends and preserves Reset at paste position $position', ({ position, offset }) => {
    const nodes: FlowNode[] = [
      { id: 'a', position: { x: -100, y: 40 }, selected: true, data: { label: 'A' } },
      { id: 'b', position: { x: 200, y: 240 }, selected: true, data: { label: 'B' } },
    ];
    const edge: FlowEdge = {
      id: 'ab', source: 'a', target: 'b', selected: true,
      data: {
        routingMode: 'manual', waypoint: { x: 40, y: 60 },
        waypoints: [{ x: 80, y: 100 }, { x: 160, y: 200 }],
        elkPoints: [{ x: 20, y: 40 }, { x: 200, y: 240 }],
        importRoutePoints: [{ x: 20, y: 40 }, { x: 200, y: 240 }],
        importRoutePath: 'M 20 40 L 200 240',
      },
    };
    useFlowStore.setState({ nodes, edges: [edge], agentTurn: null });
    const recordHistory = vi.fn();
    const { result } = renderHook(() => useClipboardOperations(recordHistory));
    act(() => result.current.copySelection());
    act(() => result.current.pasteSelection(position));

    const state = useFlowStore.getState();
    const pasted = state.edges.find((item) => item.id !== 'ab')!;
    const moved = (point: { x: number; y: number }) => ({ x: point.x + offset.x, y: point.y + offset.y });
    expect(state.nodes.find((item) => item.id === pasted.source)?.position).toEqual(moved(nodes[0].position));
    expect(pasted.data?.waypoint).toEqual(moved(edge.data!.waypoint!));
    expect(pasted.data?.waypoints).toEqual(edge.data!.waypoints!.map(moved));
    expect(pasted.data?.elkPoints).toEqual(edge.data!.elkPoints!.map(moved));
    expect(recordHistory).toHaveBeenCalledTimes(1);
    expect(state.edges.find((item) => item.id === 'ab')?.data).toEqual(edge.data);

    const onChange = vi.fn();
    render(<EdgeRouteSection selectedEdge={pasted} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: /reset path/i }));
    const reset = onChange.mock.calls[0][1] as Partial<FlowEdge>;
    expect(reset.data?.routingMode).toBe('import-fixed');
    expect(reset.data?.waypoints).toBeUndefined();
    expect(reset.data?.waypoint).toBeUndefined();
    expect(reset.data?.importRoutePoints).toEqual(edge.data!.importRoutePoints!.map(moved));
    expect(reset.data?.importRoutePath).toBeUndefined();
  });
});
