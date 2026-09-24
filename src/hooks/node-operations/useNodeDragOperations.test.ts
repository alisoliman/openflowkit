import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useFlowStore } from '../../store';
import { useNodeDragOperations } from './useNodeDragOperations';
import { requestNodeLabelEdit } from '../nodeLabelEditRequest';
import type { FlowNode } from '@/lib/types';

vi.mock('../../store', () => ({
    useFlowStore: Object.assign(vi.fn(), {
        getState: vi.fn(),
    }),
}));

vi.mock('../nodeLabelEditRequest', () => ({
    requestNodeLabelEdit: vi.fn(),
}));

const mockSetNodes = vi.fn();
const mockSetEdges = vi.fn();
const mockSetSelectedNodeId = vi.fn();
const mockSetHoveredSectionId = vi.fn();
const mockState = {
    nodes: [],
    edges: [],
    viewSettings: { smartRoutingEnabled: false },
    setEdges: mockSetEdges,
    setHoveredSectionId: mockSetHoveredSectionId,
};

beforeEach(() => {
    vi.mocked(useFlowStore).mockReturnValue({
        setNodes: mockSetNodes,
        setEdges: mockSetEdges,
        setSelectedNodeId: mockSetSelectedNodeId,
        setHoveredSectionId: mockSetHoveredSectionId,
    } as never);
    vi.mocked(useFlowStore.getState).mockReturnValue(mockState as never);
    vi.clearAllMocks();
    vi.mocked(useFlowStore).mockReturnValue({
        setNodes: mockSetNodes,
        setEdges: mockSetEdges,
        setSelectedNodeId: mockSetSelectedNodeId,
        setHoveredSectionId: mockSetHoveredSectionId,
    } as never);
    vi.mocked(useFlowStore.getState).mockReturnValue(mockState as never);
});

const makeMouseEvent = (altKey = false) => ({ altKey } as React.MouseEvent);
const makeNode = (id = 'node-1'): FlowNode => ({ id, type: 'process', position: { x: 0, y: 0 }, data: {} } as FlowNode);

describe('useNodeDragOperations', () => {
    const recordHistory = vi.fn();

    it('onNodeDoubleClick calls setSelectedNodeId and requestNodeLabelEdit', () => {
        const { result } = renderHook(() => useNodeDragOperations(recordHistory));
        const node = makeNode();
        result.current.onNodeDoubleClick(makeMouseEvent(), node);
        expect(mockSetSelectedNodeId).toHaveBeenCalledWith('node-1');
        expect(vi.mocked(requestNodeLabelEdit)).toHaveBeenCalledWith('node-1');
    });

    it('onNodeDragStart calls recordHistory', () => {
        const { result } = renderHook(() => useNodeDragOperations(recordHistory));
        result.current.onNodeDragStart(makeMouseEvent(), makeNode());
        expect(recordHistory).toHaveBeenCalled();
    });

    it('onNodeDragStart with altKey=false does NOT call setNodes', () => {
        const { result } = renderHook(() => useNodeDragOperations(recordHistory));
        result.current.onNodeDragStart(makeMouseEvent(false), makeNode());
        expect(mockSetNodes).not.toHaveBeenCalled();
    });

    it('onNodeDragStop releases stale ELK routes on edges of the nodes inside a dragged section', () => {
        const elkRoute = { routingMode: 'elk', elkPoints: [{ x: 100, y: 40 }] };
        const section = { id: 'section', type: 'section', position: { x: 400, y: 0 }, data: {} } as FlowNode;
        const inner = { ...makeNode('inner'), parentId: 'section' } as FlowNode;
        const nested = { ...makeNode('nested'), parentId: 'inner' } as FlowNode;
        const outside = makeNode('outside');
        const other = makeNode('other');
        vi.mocked(useFlowStore.getState).mockReturnValue({
            ...mockState,
            nodes: [section, inner, nested, outside, other],
            edges: [
                { id: 'e-inner', source: 'outside', target: 'inner', data: elkRoute },
                { id: 'e-nested', source: 'nested', target: 'outside', data: elkRoute },
                { id: 'e-other', source: 'outside', target: 'other', data: elkRoute },
            ],
        } as never);
        const { result } = renderHook(() => useNodeDragOperations(recordHistory));

        result.current.onNodeDragStop(makeMouseEvent(), section);

        const [released] = mockSetEdges.mock.calls.at(-1) ?? [];
        expect(released.map((edge: { data: { elkPoints?: unknown } }) => edge.data.elkPoints)).toEqual([
            undefined,
            undefined,
            elkRoute.elkPoints,
        ]);
    });

    it('onNodeDragStart with altKey=true creates a duplicate node (calls setNodes)', () => {
        const { result } = renderHook(() => useNodeDragOperations(recordHistory));
        result.current.onNodeDragStart(makeMouseEvent(true), makeNode());
        expect(mockSetNodes).toHaveBeenCalled();
    });
});
