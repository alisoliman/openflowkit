import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '@/lib/types';
import { composeDiagramForDisplay } from '@/services/composeDiagramForDisplay';
import { useFlowEditorCallbacks } from './useFlowEditorCallbacks';

const nodes: FlowNode[] = [
  { id: 'client', type: 'process', data: { label: 'Client' }, position: { x: 30, y: 40 }, measured: { width: 160, height: 80 } },
  { id: 'api', type: 'process', data: { label: 'API' }, position: { x: 400, y: 250 }, measured: { width: 160, height: 80 } },
];
const storeActions = vi.hoisted(() => ({ setNodes: vi.fn(), setEdges: vi.fn() }));
const lock = vi.hoisted(() => ({ agentTurn: null as null | { turnId: string; pageId: string } }));

vi.mock('@/store', () => ({
  useFlowStore: { getState: () => ({ nodes, edges: [], tabs: [], activeTabId: 'diagram', ...storeActions, ...lock }) },
}));
vi.mock('@/lib/nodeEnricher', () => ({ enrichNodesWithIcons: async (input: FlowNode[]) => input }));
vi.mock('@/services/composeDiagramForDisplay', () => ({
  composeDiagramForDisplay: vi.fn(async (input, edges) => ({ nodes: input, edges })),
}));
vi.mock('@/services/elkLayout', () => ({ clearLayoutCache: vi.fn() }));

function params(): Parameters<typeof useFlowEditorCallbacks>[0] {
  return {
    addPage: vi.fn(() => 'page'), closePage: vi.fn(), reorderPage: vi.fn(), updatePage: vi.fn(),
    navigate: vi.fn(), pagesLength: 1, cannotCloseLastTabMessage: 'Cannot close last page',
    setNodes: vi.fn(), setEdges: vi.fn(), restoreSnapshot: vi.fn(), recordHistory: vi.fn(),
    fitView: vi.fn(), screenToFlowPosition: vi.fn((position) => position), addToast: vi.fn(),
  };
}

beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); lock.agentTurn = null; });
afterEach(() => vi.useRealTimers());

describe('applying prepared Flowpilot edits', () => {
  it('commits a prepared graph synchronously with exactly one history record and no later re-layout', async () => {
    const callbacks = params();
    const { result } = renderHook(() => useFlowEditorCallbacks(callbacks));
    act(() => result.current.handlePreparedGraphApply(nodes, []));
    expect(callbacks.recordHistory).toHaveBeenCalledOnce();
    expect(storeActions.setNodes).toHaveBeenCalledOnce();
    expect(storeActions.setEdges).toHaveBeenCalledOnce();
    expect(callbacks.setNodes).not.toHaveBeenCalled();
    expect(callbacks.setEdges).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    expect(composeDiagramForDisplay).not.toHaveBeenCalled();
  });
  it('does not re-layout the position-preserving AI result after nodes are measured', async () => {
    const callbacks = params();
    const { result } = renderHook(() => useFlowEditorCallbacks(callbacks));
    await act(async () => {
      await result.current.handleCommandBarApply(nodes, [], { preservePositions: true });
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(composeDiagramForDisplay).not.toHaveBeenCalled();
    expect(callbacks.setNodes).toHaveBeenCalledOnce();
    expect(callbacks.setNodes).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'client', position: { x: 30, y: 40 } }),
      expect.objectContaining({ id: 'api', position: { x: 400, y: 250 } }),
    ]);
  });

  it('retains measured-layout stabilization for ordinary imports and fresh diagrams', async () => {
    const { result } = renderHook(() => useFlowEditorCallbacks(params()));
    await act(async () => {
      await result.current.handleCommandBarApply(nodes, []);
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(composeDiagramForDisplay).toHaveBeenCalledOnce();
  });

  it('invalidates a pending import layout before applying a prepared edit', async () => {
    const { result } = renderHook(() => useFlowEditorCallbacks(params()));
    await act(async () => {
      await result.current.handleCommandBarApply(nodes, []);
      await result.current.handleCommandBarApply(nodes, [], { preservePositions: true });
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(composeDiagramForDisplay).not.toHaveBeenCalled();
  });
});

describe('code and DSL imports during a Flowpilot turn', () => {
  it('drops the import and says why, as the code panel and its live sync apply through here', async () => {
    lock.agentTurn = { turnId: 'turn-1', pageId: 'diagram' };
    const callbacks = params();
    const { result } = renderHook(() => useFlowEditorCallbacks(callbacks));
    await act(async () => {
      await result.current.handleCommandBarApply(nodes, []);
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(callbacks.recordHistory).not.toHaveBeenCalled();
    expect(storeActions.setNodes).not.toHaveBeenCalled();
    expect(storeActions.setEdges).not.toHaveBeenCalled();
    expect(callbacks.setNodes).not.toHaveBeenCalled();
    expect(composeDiagramForDisplay).not.toHaveBeenCalled();
    expect(callbacks.addToast).toHaveBeenCalledWith(expect.stringContaining('Flowpilot is editing this page'), 'warning');
  });

  it('skips the delayed re-layout of an import when a turn starts before it runs', async () => {
    const callbacks = params();
    const { result } = renderHook(() => useFlowEditorCallbacks(callbacks));
    await act(async () => {
      await result.current.handleCommandBarApply(nodes, []);
    });
    lock.agentTurn = { turnId: 'turn-1', pageId: 'diagram' };
    await act(async () => { await vi.advanceTimersByTimeAsync(250); });
    expect(composeDiagramForDisplay).not.toHaveBeenCalled();
    // Only the import itself, not the re-layout.
    expect(callbacks.setNodes).toHaveBeenCalledOnce();
    expect(callbacks.addToast).not.toHaveBeenCalled();
  });
});
