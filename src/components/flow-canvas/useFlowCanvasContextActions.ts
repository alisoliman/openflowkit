import { useMemo } from 'react';
import type { Edge, Node } from '@/lib/reactflowCompat';
import type { ContextMenuProps } from '@/components/ContextMenu';
import { canReverseEdge } from '@/components/properties/edge/reverseEdge';
import { requestEdgeLabelEdit } from '@/hooks/edgeLabelEditRequest';

interface UseFlowCanvasContextActionsParams {
  contextMenu: ContextMenuProps & { isOpen: boolean };
  onCloseContextMenu: () => void;
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
  copySelection: () => void;
  pasteSelection: (position: { x: number; y: number }) => void;
  duplicateNode: (id: string) => void;
  deleteNode: (id: string) => void;
  deleteEdge: (id: string) => void;
  deleteSelection: () => void;
  reverseEdge: (id: string) => void;
  updateNodeZIndex: (id: string, action: 'front' | 'back') => void;
  updateNodeType: (id: string, type: string) => void;
  updateNodeData: (id: string, updates: Record<string, unknown>) => void;
  fitSectionToContents: (id: string) => void;
  releaseFromSection: (id: string) => void;
  bringContentsIntoSection: (id: string) => void;
  handleAlignNodes: (direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  handleDistributeNodes: (direction: 'horizontal' | 'vertical') => void;
  handleGroupNodes: () => void;
  handleWrapInSection: () => void;
  nodes: Node[];
  edges: Edge[];
}

export interface UseFlowCanvasContextActionsResult {
  selectedCount: number;
  canEditEdgeLabel: boolean;
  canReverseEdge: boolean;
  onPaste: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSendToBack: () => void;
  onChangeNodeType: (type: string) => void;
  onEditLabel: () => void;
  onReverseEdge: () => void;
  onFitSectionToContents: () => void;
  onBringContentsIntoSection: () => void;
  onReleaseFromSection: () => void;
  onToggleSectionLock: () => void;
  onToggleSectionHidden: () => void;
  onTogglePinPosition: () => void;
  isPinPositionToggleApplicable: boolean;
  isCurrentNodePinned: boolean;
  onAlignNodes: (direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistributeNodes: (direction: 'horizontal' | 'vertical') => void;
  onGroupSelected: () => void;
  onWrapInSection: () => void;
}

export function useFlowCanvasContextActions({
  contextMenu,
  onCloseContextMenu,
  screenToFlowPosition,
  pasteSelection,
  duplicateNode,
  deleteNode,
  deleteEdge,
  deleteSelection,
  reverseEdge,
  updateNodeZIndex,
  updateNodeType,
  updateNodeData,
  fitSectionToContents,
  releaseFromSection,
  bringContentsIntoSection,
  handleAlignNodes,
  handleDistributeNodes,
  handleGroupNodes,
  handleWrapInSection,
  nodes,
  edges,
}: UseFlowCanvasContextActionsParams): UseFlowCanvasContextActionsResult {
  const selectedCount = useMemo(() => nodes.filter((node) => node.selected).length, [nodes]);
  const contextNode = useMemo(
    () => nodes.find((node) => node.id === contextMenu.id) ?? null,
    [contextMenu.id, nodes]
  );
  const contextEdge = contextMenu.type === 'edge'
    ? edges.find((edge) => edge.id === contextMenu.id) ?? null
    : null;
  // Sequence messages draw their own label without the inline editor.
  const canEditEdgeLabel = Boolean(contextEdge) && contextEdge?.type !== 'sequence_message';
  const canReverseContextEdge = Boolean(contextEdge && canReverseEdge(contextEdge, nodes));

  function onPaste(): void {
    if (contextMenu.position) {
      pasteSelection(screenToFlowPosition(contextMenu.position));
    }
    onCloseContextMenu();
  }

  function onDuplicate(): void {
    if (contextMenu.id) {
      duplicateNode(contextMenu.id);
    }
    onCloseContextMenu();
  }

  function onDelete(): void {
    if (contextMenu.type === 'multi') {
      deleteSelection();
    } else if (contextMenu.id) {
      if (contextMenu.type === 'edge') {
        deleteEdge(contextMenu.id);
      } else {
        deleteNode(contextMenu.id);
      }
    }
    onCloseContextMenu();
  }

  function onSendToBack(): void {
    if (contextMenu.id) {
      updateNodeZIndex(contextMenu.id, 'back');
    }
    onCloseContextMenu();
  }

  function onChangeNodeType(type: string): void {
    if (contextMenu.id) {
      updateNodeType(contextMenu.id, type);
    }
    onCloseContextMenu();
  }

  function onAlignNodesAndClose(
    direction: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom'
  ): void {
    handleAlignNodes(direction);
    onCloseContextMenu();
  }

  function onDistributeNodesAndClose(direction: 'horizontal' | 'vertical'): void {
    handleDistributeNodes(direction);
    onCloseContextMenu();
  }

  function onGroupSelected(): void {
    handleGroupNodes();
    onCloseContextMenu();
  }

  function onWrapInSection(): void {
    handleWrapInSection();
    onCloseContextMenu();
  }

  function onEditLabel(): void {
    if (contextMenu.type === 'edge' && contextMenu.id) {
      requestEdgeLabelEdit(contextMenu.id);
    }
    onCloseContextMenu();
  }

  function onReverseEdge(): void {
    if (contextMenu.type === 'edge' && contextMenu.id) {
      reverseEdge(contextMenu.id);
    }
    onCloseContextMenu();
  }

  function onFitSectionToContents(): void {
    if (contextMenu.id) {
      fitSectionToContents(contextMenu.id);
    }
    onCloseContextMenu();
  }

  function onBringContentsIntoSection(): void {
    if (contextMenu.id) {
      bringContentsIntoSection(contextMenu.id);
    }
    onCloseContextMenu();
  }

  function onReleaseFromSection(): void {
    if (contextMenu.id) {
      releaseFromSection(contextMenu.id);
    }
    onCloseContextMenu();
  }

  function onToggleSectionLock(): void {
    if (contextMenu.id && contextNode?.type === 'section') {
      updateNodeData(contextMenu.id, {
        sectionLocked: contextNode.data?.sectionLocked !== true,
      });
    }
    onCloseContextMenu();
  }

  function onToggleSectionHidden(): void {
    if (contextMenu.id && contextNode?.type === 'section') {
      updateNodeData(contextMenu.id, {
        sectionHidden: contextNode.data?.sectionHidden !== true,
      });
    }
    onCloseContextMenu();
  }

  // Pin position: only meaningful for leaf nodes (sections derive bounds from
  // their children, so anchoring them would fight the layout engine).
  const isPinPositionToggleApplicable =
    Boolean(contextNode) && contextNode?.type !== 'section';
  const isCurrentNodePinned = contextNode?.data?.pinned === true;

  function onTogglePinPosition(): void {
    if (!contextMenu.id || !isPinPositionToggleApplicable) {
      onCloseContextMenu();
      return;
    }
    updateNodeData(contextMenu.id, { pinned: !isCurrentNodePinned });
    onCloseContextMenu();
  }

  return {
    selectedCount,
    canEditEdgeLabel,
    canReverseEdge: canReverseContextEdge,
    onPaste,
    onDuplicate,
    onDelete,
    onSendToBack,
    onChangeNodeType,
    onEditLabel,
    onReverseEdge,
    onFitSectionToContents,
    onBringContentsIntoSection,
    onReleaseFromSection,
    onToggleSectionLock,
    onToggleSectionHidden,
    onTogglePinPosition,
    isPinPositionToggleApplicable,
    isCurrentNodePinned,
    onAlignNodes: onAlignNodesAndClose,
    onDistributeNodes: onDistributeNodesAndClose,
    onGroupSelected,
    onWrapInSection,
  };
}
