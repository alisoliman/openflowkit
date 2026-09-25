import React from 'react';
import { createPortal } from 'react-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowEdge } from '@/lib/types';
import { useFlowStore } from '@/store';
import { EdgeRouteControls } from './EdgeRouteControls';

const flow = vi.hoisted(() => ({ edges: [] as FlowEdge[] }));
vi.mock('@/lib/reactflowCompat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reactflowCompat')>()),
  useReactFlow: () => ({
    getEdges: () => flow.edges,
    setEdges: (update: (edges: FlowEdge[]) => FlowEdge[]) => {
      flow.edges = update(flow.edges);
      useFlowStore.getState().setEdges(flow.edges);
    },
    screenToFlowPosition: ({ x, y }: { x: number; y: number }) => ({ x: (x - 20) / 2, y: (y - 10) / 2 }),
  }),
  useViewport: () => ({ zoom: 2 }),
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => createPortal(children, document.body),
}));

function Controls({ orthogonal = false, path = 'M0,0 L100,0', targetY = 0 }: { orthogonal?: boolean; path?: string; targetY?: number }): React.ReactElement {
  return <svg><EdgeRouteControls id="e1" data={flow.edges[0].data} path={path} pathRef={{ current: null }} sourceX={0} sourceY={0} targetX={100} targetY={targetY} orthogonal={orthogonal} /></svg>;
}

describe('EdgeRouteControls', () => {
  const originalState = useFlowStore.getState();
  const originalHistory = useFlowStore.getState().recordHistoryV2;
  const recordHistory = vi.fn(() => originalHistory());
  beforeEach(() => {
    flow.edges = [{ id: 'e1', source: 'a', target: 'b', data: { routingMode: 'elk', elkPoints: [{ x: 0, y: 0 }, { x: 100, y: 0 }] } }];
    recordHistory.mockClear();
    useFlowStore.setState({
      recordHistoryV2: recordHistory,
      agentTurn: null,
      activeTabId: 'route-tab',
      nodes: [],
      edges: flow.edges,
      tabs: [{
        id: 'route-tab', name: 'Route test', nodes: [], edges: flow.edges,
        history: { past: [{ nodes: [], edges: [] }], future: [{ nodes: [], edges: flow.edges }] },
      }],
    });
  });
  afterEach(() => { useFlowStore.setState(originalState); });

  it('creates a bend in canvas coordinates and records one undo snapshot per drag', () => {
    render(<Controls />);
    const original = flow.edges[0].data;
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add bend 1' }), { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 40, clientY: 30 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 50 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(flow.edges[0].data?.waypoints).toEqual([{ x: 70, y: 20 }]);
    expect(flow.edges[0].data?.routingMode).toBe('manual');
    expect(flow.edges[0].data?.elkPoints).toEqual(original?.elkPoints);
    expect(original?.waypoints).toBeUndefined();
    expect(recordHistory).toHaveBeenCalledTimes(1);
  });

  it('does not create history for pointer jitter or another pointer', () => {
    render(<Controls />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add bend 1' }), { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 2, clientX: 100, clientY: 100 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 21, clientY: 11 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(recordHistory).not.toHaveBeenCalled();
    expect(flow.edges[0].data?.waypoints).toBeUndefined();
  });

  it.each(['escape', 'pointercancel', 'unmount'])('cancels a drag on %s and removes its global listeners', (cancel) => {
    const { unmount } = render(<Controls />);
    const original = flow.edges[0].data;
    const history = useFlowStore.getState().tabs[0].history;
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add bend 1' }), { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 50 });
    expect(useFlowStore.getState().tabs[0].history.future).toEqual([]);
    if (cancel === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    else if (cancel === 'pointercancel') fireEvent.pointerCancel(window, { pointerId: 1 });
    else unmount();
    expect(flow.edges[0].data).toEqual(original);
    expect(useFlowStore.getState().tabs[0].history).toBe(history);
    expect(useFlowStore.getState().canRedoV2()).toBe(true);
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 200, clientY: 100 });
    expect(flow.edges[0].data).toEqual(original);
  });

  it('supports clicking to add, keyboard movement, and removing a bend without deleting its edge', () => {
    const { rerender } = render(<Controls />);
    fireEvent.click(screen.getByRole('button', { name: 'Add bend 1' }));
    rerender(<Controls />);
    const bend = screen.getByRole('button', { name: 'Bend 1' });
    expect(bend).toHaveFocus();
    fireEvent.keyDown(bend, { key: 'ArrowDown', shiftKey: true });
    fireEvent.keyDown(bend, { key: 'ArrowDown', shiftKey: true, repeat: true });
    fireEvent.keyUp(bend, { key: 'ArrowDown' });
    expect(flow.edges[0].data?.waypoints).toEqual([{ x: 50, y: 20 }]);
    expect(recordHistory).toHaveBeenCalledTimes(2);
    fireEvent.keyDown(bend, { key: 'Delete' });
    rerender(<Controls />);
    const insert = screen.getByRole('button', { name: 'Add bend 1' });
    expect(insert).toHaveFocus();
    const backgroundDelete = vi.fn();
    window.addEventListener('keydown', backgroundDelete);
    fireEvent.keyDown(document.activeElement!, { key: 'Delete', repeat: true });
    expect(backgroundDelete).not.toHaveBeenCalled();
    window.removeEventListener('keydown', backgroundDelete);
    expect(flow.edges).toHaveLength(1);
    expect(flow.edges[0].data?.waypoints).toBeUndefined();
    expect(flow.edges[0].data?.routingMode).toBe('elk');
  });

  it('focuses the closest surviving bend and starts a new keyboard undo group after removal', () => {
    flow.edges[0].data = { waypoints: [{ x: 20, y: 10 }, { x: 60, y: 30 }] };
    const { rerender } = render(<Controls />);
    const last = screen.getByRole('button', { name: 'Bend 2' });
    act(() => last.focus());
    fireEvent.keyDown(last, { key: 'ArrowDown' });
    fireEvent.keyDown(last, { key: 'Delete' });
    rerender(<Controls />);
    const remaining = screen.getByRole('button', { name: 'Bend 1' });
    expect(remaining).toHaveFocus();
    fireEvent.keyDown(remaining, { key: 'ArrowRight' });
    expect(recordHistory).toHaveBeenCalledTimes(3);
    expect(flow.edges[0].data?.waypoints).toEqual([{ x: 21, y: 10 }]);
  });

  it('preserves later edge data and history if another action runs during a drag', () => {
    render(<Controls />);
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add bend 1' }), { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 50 });
    useFlowStore.getState().recordHistoryV2();
    const concurrentHistory = useFlowStore.getState().tabs[0].history;
    const concurrentData = { ...flow.edges[0].data, labelOffsetX: 22 };
    flow.edges = [{ ...flow.edges[0], data: concurrentData }];
    useFlowStore.getState().setEdges(flow.edges);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(flow.edges[0].data).toBe(concurrentData);
    expect(useFlowStore.getState().tabs[0].history).toBe(concurrentHistory);
  });

  it('does not write cancelled edge data into a newly active page', () => {
    const { unmount } = render(<Controls />);
    const originalHistory = useFlowStore.getState().tabs[0].history;
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Add bend 1' }), { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 50 });
    const otherData = { labelOffsetX: 100 };
    flow.edges = [{ ...flow.edges[0], data: otherData }];
    useFlowStore.setState((state) => ({
      activeTabId: 'other-tab',
      edges: flow.edges,
      tabs: [...state.tabs, { id: 'other-tab', name: 'Other page', nodes: [], edges: flow.edges, history: { past: [], future: [] } }],
    }));
    unmount();
    expect(flow.edges[0].data).toBe(otherData);
    expect(useFlowStore.getState().tabs.find(tab => tab.id === 'route-tab')!.history).toBe(originalHistory);
  });

  it('blocks mutations when an AI turn takes ownership', () => {
    render(<Controls />);
    useFlowStore.setState({ agentTurn: { id: 'busy' } as never });
    fireEvent.click(screen.getByRole('button', { name: 'Add bend 1' }));
    fireEvent.keyDown(screen.getByRole('button', { name: 'Add bend 1' }), { key: 'Enter' });
    expect(recordHistory).not.toHaveBeenCalled();
    expect(flow.edges[0].data?.waypoints).toBeUndefined();
  });

  it('moves a step segment only perpendicular to its direction, with no free bend controls', () => {
    render(<Controls orthogonal path="M0,0 L0,50 L100,50 L100,100" targetY={100} />);
    expect(screen.queryByRole('button', { name: 'Add bend 1' })).toBeNull();
    const handle = screen.getByRole('button', { name: 'Move horizontal segment 2' });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 60, clientY: 50 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    expect(flow.edges[0].data?.waypoints).toEqual([{ x: 0, y: 70 }, { x: 100, y: 70 }]);
    expect(recordHistory).toHaveBeenCalledTimes(1);
  });

  it('ignores parallel dragging and uses matching arrow keys to move a step segment', () => {
    render(<Controls orthogonal path="M0,0 L50,0 L50,100 L100,100" targetY={100} />);
    const handle = screen.getByRole('button', { name: 'Move vertical segment 2' });
    fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 20, clientY: 10 });
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 20, clientY: 100 });
    fireEvent.pointerUp(window, { pointerId: 1 });
    fireEvent.keyDown(handle, { key: 'ArrowDown' });
    expect(recordHistory).not.toHaveBeenCalled();
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true });
    fireEvent.keyDown(handle, { key: 'ArrowRight', shiftKey: true, repeat: true });
    fireEvent.keyUp(handle, { key: 'ArrowRight' });
    expect(flow.edges[0].data?.waypoints).toEqual([{ x: 70, y: 0 }, { x: 70, y: 100 }]);
    expect(recordHistory).toHaveBeenCalledTimes(1);
  });
});
