import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { APP_EVENT_NAMES } from '@/lib/legacyBranding';
import { useFlowCanvasMenusAndActions } from './useFlowCanvasMenusAndActions';

describe('useFlowCanvasMenusAndActions', () => {
    it('clears pane selection and closes the context menu on pane click', () => {
        const onPaneSelectionClear = vi.fn();
        const hook = renderHook(() =>
            useFlowCanvasMenusAndActions({
                onPaneSelectionClear,
                screenToFlowPosition: (position) => position,
                copySelection: vi.fn(),
                pasteSelection: vi.fn(),
                duplicateNode: vi.fn(),
                deleteNode: vi.fn(),
                deleteEdge: vi.fn(),
                reverseEdge: vi.fn(),
                deleteSelection: vi.fn(),
                updateNodeZIndex: vi.fn(),
                updateNodeType: vi.fn(),
                updateNodeData: vi.fn(),
                fitSectionToContents: vi.fn(),
                releaseFromSection: vi.fn(),
                bringContentsIntoSection: vi.fn(),
                handleAlignNodes: vi.fn(),
                handleDistributeNodes: vi.fn(),
                handleGroupNodes: vi.fn(),
                handleWrapInSection: vi.fn(),
                nodes: [],
                edges: [],
            })
        );

        act(() => {
            hook.result.current.onPaneContextMenu({
                preventDefault: vi.fn(),
                clientX: 10,
                clientY: 20,
            } as unknown as React.MouseEvent);
        });

        expect(hook.result.current.contextMenu.isOpen).toBe(true);

        act(() => {
            hook.result.current.onPaneClick();
        });

        expect(onPaneSelectionClear).toHaveBeenCalledTimes(1);
        expect(hook.result.current.contextMenu.isOpen).toBe(false);
    });

    it('exposes section-specific context actions for section nodes', () => {
        const updateNodeData = vi.fn();
        const fitSectionToContents = vi.fn();
        const bringContentsIntoSection = vi.fn();

        const hook = renderHook(() =>
            useFlowCanvasMenusAndActions({
                onPaneSelectionClear: vi.fn(),
                screenToFlowPosition: (position) => position,
                copySelection: vi.fn(),
                pasteSelection: vi.fn(),
                duplicateNode: vi.fn(),
                deleteNode: vi.fn(),
                deleteEdge: vi.fn(),
                reverseEdge: vi.fn(),
                deleteSelection: vi.fn(),
                updateNodeZIndex: vi.fn(),
                updateNodeType: vi.fn(),
                updateNodeData,
                fitSectionToContents,
                releaseFromSection: vi.fn(),
                bringContentsIntoSection,
                handleAlignNodes: vi.fn(),
                handleDistributeNodes: vi.fn(),
                handleGroupNodes: vi.fn(),
                handleWrapInSection: vi.fn(),
                nodes: [
                    {
                        id: 'section-1',
                        type: 'section',
                        position: { x: 0, y: 0 },
                        data: { label: 'Frame', sectionLocked: false, sectionHidden: false },
                    } as never,
                ],
                edges: [],
            })
        );

        act(() => {
            hook.result.current.onNodeContextMenu({
                preventDefault: vi.fn(),
                clientX: 10,
                clientY: 20,
            } as unknown as React.MouseEvent, {
                id: 'section-1',
                type: 'section',
                position: { x: 0, y: 0 },
                data: { label: 'Frame', sectionLocked: false, sectionHidden: false },
            } as never);
        });

        act(() => {
            hook.result.current.contextActions.onFitSectionToContents();
        });
        expect(fitSectionToContents).toHaveBeenCalledWith('section-1');

        act(() => {
            hook.result.current.onNodeContextMenu({
                preventDefault: vi.fn(),
                clientX: 10,
                clientY: 20,
            } as unknown as React.MouseEvent, {
                id: 'section-1',
                type: 'section',
                position: { x: 0, y: 0 },
                data: { label: 'Frame', sectionLocked: false, sectionHidden: false },
            } as never);
            hook.result.current.contextActions.onBringContentsIntoSection();
        });
        expect(bringContentsIntoSection).toHaveBeenCalledWith('section-1');

        act(() => {
            hook.result.current.onNodeContextMenu({
                preventDefault: vi.fn(),
                clientX: 10,
                clientY: 20,
            } as unknown as React.MouseEvent, {
                id: 'section-1',
                type: 'section',
                position: { x: 0, y: 0 },
                data: { label: 'Frame', sectionLocked: false, sectionHidden: false },
            } as never);
            hook.result.current.contextActions.onToggleSectionLock();
        });
        expect(updateNodeData).toHaveBeenCalledWith('section-1', { sectionLocked: true });
    });

    function renderMenus(overrides: Partial<Parameters<typeof useFlowCanvasMenusAndActions>[0]> = {}) {
        return renderHook(() =>
            useFlowCanvasMenusAndActions({
                onPaneSelectionClear: vi.fn(),
                screenToFlowPosition: (position) => position,
                copySelection: vi.fn(),
                pasteSelection: vi.fn(),
                duplicateNode: vi.fn(),
                deleteNode: vi.fn(),
                deleteEdge: vi.fn(),
                reverseEdge: vi.fn(),
                deleteSelection: vi.fn(),
                updateNodeZIndex: vi.fn(),
                updateNodeType: vi.fn(),
                updateNodeData: vi.fn(),
                fitSectionToContents: vi.fn(),
                releaseFromSection: vi.fn(),
                bringContentsIntoSection: vi.fn(),
                handleAlignNodes: vi.fn(),
                handleDistributeNodes: vi.fn(),
                handleGroupNodes: vi.fn(),
                handleWrapInSection: vi.fn(),
                nodes: [],
                edges: [],
                ...overrides,
            })
        );
    }

    const menuEvent = { preventDefault: vi.fn(), clientX: 10, clientY: 20 } as unknown as React.MouseEvent;

    it('reverses the edge and opens its label editor from the edge menu', () => {
        const reverseEdge = vi.fn();
        const duplicateNode = vi.fn();
        const onLabelEditRequest = vi.fn();
        window.addEventListener(APP_EVENT_NAMES.edgeLabelEditRequest, onLabelEditRequest);
        const edge = { id: 'edge-1', source: 'a', target: 'b' };
        const hook = renderMenus({ reverseEdge, duplicateNode, edges: [edge] });
        const openEdgeMenu = (): void => {
            hook.result.current.onEdgeContextMenu(menuEvent, edge);
        };

        act(openEdgeMenu);
        expect(hook.result.current.contextActions).toMatchObject({ canReverseEdge: true, canEditEdgeLabel: true });
        act(() => {
            hook.result.current.contextActions.onReverseEdge();
        });
        expect(reverseEdge).toHaveBeenCalledWith('edge-1');
        expect(duplicateNode).not.toHaveBeenCalled();
        expect(hook.result.current.contextMenu.isOpen).toBe(false);

        act(openEdgeMenu);
        act(() => {
            hook.result.current.contextActions.onEditLabel();
        });
        expect(onLabelEditRequest).toHaveBeenCalledWith(
            expect.objectContaining({ detail: { edgeId: 'edge-1' } })
        );
        window.removeEventListener(APP_EVENT_NAMES.edgeLabelEditRequest, onLabelEditRequest);
    });

    it('offers no reverse for a mindmap branch and no label editor for a sequence message', () => {
        const branch = { id: 'branch', source: 'root', target: 'topic' };
        const message = { id: 'message', source: 'client', target: 'api', type: 'sequence_message' };
        const hook = renderMenus({
            nodes: [
                { id: 'root', type: 'mindmap', position: { x: 0, y: 0 }, data: {} },
                { id: 'topic', type: 'mindmap', position: { x: 0, y: 0 }, data: {} },
            ],
            edges: [branch, message],
        });

        act(() => {
            hook.result.current.onEdgeContextMenu(menuEvent, branch);
        });
        expect(hook.result.current.contextActions).toMatchObject({ canReverseEdge: false, canEditEdgeLabel: true });

        act(() => {
            hook.result.current.onEdgeContextMenu(menuEvent, message);
        });
        expect(hook.result.current.contextActions).toMatchObject({ canReverseEdge: true, canEditEdgeLabel: false });
    });

    it('deletes a multi-selection as one step', () => {
        const deleteSelection = vi.fn();
        const deleteNode = vi.fn();
        const hook = renderMenus({ deleteSelection, deleteNode });

        act(() => {
            hook.result.current.onSelectionContextMenu(menuEvent, []);
        });
        act(() => {
            hook.result.current.contextActions.onDelete();
        });

        expect(deleteSelection).toHaveBeenCalledTimes(1);
        expect(deleteNode).not.toHaveBeenCalled();
    });
});
