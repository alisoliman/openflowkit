import React, { useEffect } from 'react';
import ReactFlow, { Background } from '@/lib/reactflowCompat';
import type {
  OnConnect,
  OnConnectEnd,
  OnConnectStart,
  OnEdgesChange,
  OnNodesChange,
  OnReconnect,
  OnSelectionChangeFunc,
} from '@/lib/reactflowCompat';
import type { FlowEdge, FlowNode } from '@/lib/types';
import CustomConnectionLine from '@/components/CustomConnectionLine';
import { NavigationControls } from '@/components/NavigationControls';
import { FlowCanvasOverlays } from './FlowCanvasOverlays';
import { StreamingOverlay } from './StreamingOverlay';
import { flowCanvasEdgeTypes, flowCanvasNodeTypes } from './flowCanvasTypes';
import { FLOATING_BADGE_CLASS } from '@/lib/designTokens';
import type { ConnectMenuState } from './useFlowCanvasMenus';
import type { UseFlowCanvasContextActionsResult } from './useFlowCanvasContextActions';
import type { NodeData } from '@/lib/types';
import type { DomainLibraryItem } from '@/services/domainLibrary';
import type { ConnectedEdgePreset } from '@/hooks/edge-operations/utils';
import type { FlowCanvasReactFlowConfig } from './useFlowCanvasReactFlowConfig';
import type { AlignmentGuides, SelectionDragPreview } from './alignmentGuides';
import type { ContextMenuState } from './useFlowCanvasMenus';

// A file dropped during a turn adds nothing, but it must not reach the browser, which would open it in the tab.
function refuseDrop(event: React.DragEvent): void {
  event.preventDefault();
  event.dataTransfer.dropEffect = 'none';
}

interface FlowCanvasSurfaceProps {
  containerClassName: string;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  onPointerDownCapture?: React.PointerEventHandler<HTMLDivElement>;
  onPasteCapture: React.ClipboardEventHandler<HTMLDivElement>;
  onDoubleClickCapture: React.MouseEventHandler<HTMLDivElement>;
  selectionAnnouncement: string;
  nodes: FlowNode[];
  edges: FlowEdge[];
  onNodesChange: OnNodesChange;
  onEdgesChange: OnEdgesChange;
  onConnect: OnConnect;
  onReconnect: OnReconnect;
  onSelectionChange: OnSelectionChangeFunc;
  onNodeDragStart: (event: React.MouseEvent, node: FlowNode) => void;
  onNodeDrag: (event: React.MouseEvent, node: FlowNode, draggedNodes?: FlowNode[]) => void;
  onNodeDragStop: (event: React.MouseEvent, node: FlowNode) => void;
  onMoveStart: () => void;
  onMoveEnd: () => void;
  onNodeDoubleClick: (event: React.MouseEvent, node: FlowNode) => void;
  onNodeClick?: () => void;
  onEdgeClick?: () => void;
  onNodeContextMenu: (event: React.MouseEvent, node: FlowNode) => void;
  onSelectionContextMenu: (event: React.MouseEvent, nodes: FlowNode[]) => void;
  onPaneContextMenu: (event: React.MouseEvent) => void;
  onEdgeContextMenu: (event: React.MouseEvent, edge: FlowEdge) => void;
  onPaneClick: (event: React.MouseEvent) => void;
  onConnectStart: OnConnectStart;
  onConnectEnd: OnConnectEnd;
  onDragOver: React.DragEventHandler<HTMLDivElement>;
  onDrop: React.DragEventHandler<HTMLDivElement>;
  fitView: boolean;
  /** A Flowpilot turn is editing the page: nothing on the canvas reacts, but it still pans and zooms. */
  isAgentEditing: boolean;
  reactFlowConfig: FlowCanvasReactFlowConfig;
  snapToGrid: boolean;
  effectiveShowGrid: boolean;
  alignmentGuidesEnabled: boolean;
  alignmentGuides: AlignmentGuides;
  selectionDragPreview: SelectionDragPreview;
  connectMenu: ConnectMenuState | null;
  setConnectMenu: (menu: ConnectMenuState | null) => void;
  screenToFlowPosition: (position: { x: number; y: number }) => { x: number; y: number };
  handleAddAndConnect: (
    type: string,
    position: { x: number; y: number },
    sourceId?: string,
    sourceHandle?: string,
    shape?: NodeData['shape'],
    edgePreset?: ConnectedEdgePreset
  ) => void;
  handleAddDomainLibraryItemAndConnect: (
    item: DomainLibraryItem,
    position: { x: number; y: number },
    sourceId?: string,
    sourceHandle?: string
  ) => void;
  contextMenu: ContextMenuState;
  onCloseContextMenu: () => void;
  copySelection: () => void;
  contextActions: UseFlowCanvasContextActionsResult;
}

export function FlowCanvasSurface({
  containerClassName,
  wrapperRef,
  onPointerDownCapture,
  onPasteCapture,
  onDoubleClickCapture,
  selectionAnnouncement,
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  onConnect,
  onReconnect,
  onSelectionChange,
  onNodeDragStart,
  onNodeDrag,
  onNodeDragStop,
  onMoveStart,
  onMoveEnd,
  onNodeDoubleClick,
  onNodeClick,
  onEdgeClick,
  onNodeContextMenu,
  onSelectionContextMenu,
  onPaneContextMenu,
  onEdgeContextMenu,
  onPaneClick,
  onConnectStart,
  onConnectEnd,
  onDragOver,
  onDrop,
  fitView,
  isAgentEditing,
  reactFlowConfig,
  snapToGrid,
  effectiveShowGrid,
  alignmentGuidesEnabled,
  alignmentGuides,
  selectionDragPreview,
  connectMenu,
  setConnectMenu,
  screenToFlowPosition,
  handleAddAndConnect,
  handleAddDomainLibraryItemAndConnect,
  contextMenu,
  onCloseContextMenu,
  copySelection,
  contextActions,
}: FlowCanvasSurfaceProps): React.ReactElement {
  const selectedNodeCount = nodes.filter((node) => node.selected).length;
  const selectedEdgeCount = edges.filter((edge) => edge.selected).length;
  const selectedItemCount = selectedNodeCount + selectedEdgeCount;
  const editHandlers = isAgentEditing
    ? { onDragOver: refuseDrop, onDrop: refuseDrop }
    : {
        onNodeDoubleClick,
        onNodeClick,
        onEdgeClick,
        onNodeContextMenu,
        onSelectionContextMenu,
        onPaneContextMenu,
        onEdgeContextMenu,
        onPaneClick,
        onDragOver,
        onDrop,
      };

  // Buttons inside nodes and edge labels (quick create, collapse, field editors) stay mounted
  // during a turn, so the viewport also leaves the tab order. The pane underneath still pans and zooms.
  useEffect(() => {
    wrapperRef.current
      ?.querySelector('.react-flow__viewport')
      ?.toggleAttribute('inert', isAgentEditing);
  }, [isAgentEditing, wrapperRef]);

  return (
    <div
      className={containerClassName}
      ref={wrapperRef}
      onPointerDownCapture={onPointerDownCapture}
      onPasteCapture={isAgentEditing ? undefined : onPasteCapture}
      onDoubleClickCapture={isAgentEditing ? undefined : onDoubleClickCapture}
    >
      {selectedItemCount > 1 ? (
        <div className="pointer-events-none absolute right-5 top-5 z-30">
          <div
            className={`${FLOATING_BADGE_CLASS} px-3 py-1.5 text-[11px] font-semibold text-[var(--brand-text)] backdrop-blur-md animate-in fade-in zoom-in-95 duration-200`}
          >
            {selectedItemCount} selected
            <span className="ml-1 text-[var(--brand-secondary)]">
              ({selectedNodeCount} node{selectedNodeCount === 1 ? '' : 's'}, {selectedEdgeCount}{' '}
              edge{selectedEdgeCount === 1 ? '' : 's'})
            </span>
          </div>
        </div>
      ) : null}
      <div className="sr-only" aria-live="polite" aria-atomic="true">
        {selectionAnnouncement}
      </div>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onReconnect={onReconnect}
        onSelectionChange={onSelectionChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        onMoveStart={onMoveStart}
        onMoveEnd={onMoveEnd}
        {...editHandlers}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        nodesDraggable={!isAgentEditing}
        nodesConnectable={!isAgentEditing}
        edgesReconnectable={!isAgentEditing}
        elementsSelectable={!isAgentEditing}
        // The app's shortcut handler deletes the selection, one undo step for Delete and Backspace.
        deleteKeyCode={null}
        // Arrow keys still move a selection or a node that sets its own draggable.
        disableKeyboardA11y={isAgentEditing}
        nodeTypes={flowCanvasNodeTypes}
        edgeTypes={flowCanvasEdgeTypes}
        fitView={fitView}
        className={reactFlowConfig.className}
        minZoom={0.1}
        onlyRenderVisibleElements={reactFlowConfig.onlyRenderVisibleElements}
        connectionMode={reactFlowConfig.connectionMode}
        isValidConnection={reactFlowConfig.isValidConnection}
        selectionOnDrag={reactFlowConfig.selectionOnDrag}
        selectNodesOnDrag={reactFlowConfig.selectNodesOnDrag}
        selectionKeyCode={reactFlowConfig.selectionKeyCode}
        panOnDrag={reactFlowConfig.panOnDrag}
        panActivationKeyCode={reactFlowConfig.panActivationKeyCode}
        selectionMode={reactFlowConfig.selectionMode}
        multiSelectionKeyCode={reactFlowConfig.multiSelectionKeyCode}
        zoomActivationKeyCode={reactFlowConfig.zoomActivationKeyCode}
        zoomOnScroll={reactFlowConfig.zoomOnScroll}
        zoomOnPinch={reactFlowConfig.zoomOnPinch}
        panOnScroll={reactFlowConfig.panOnScroll}
        panOnScrollMode={reactFlowConfig.panOnScrollMode}
        preventScrolling={reactFlowConfig.preventScrolling}
        zoomOnDoubleClick={reactFlowConfig.zoomOnDoubleClick}
        defaultEdgeOptions={reactFlowConfig.defaultEdgeOptions}
        connectionLineComponent={CustomConnectionLine}
        snapToGrid={snapToGrid}
      >
        {effectiveShowGrid ? (
          <Background
            variant={reactFlowConfig.background.variant}
            gap={reactFlowConfig.background.gap}
            size={reactFlowConfig.background.size}
            color={reactFlowConfig.background.color}
          />
        ) : null}
        <NavigationControls />
      </ReactFlow>
      <StreamingOverlay />
      {/* A context or connect menu left open when the turn started must not edit either. */}
      <div className="contents" inert={isAgentEditing}>
        <FlowCanvasOverlays
          alignmentGuidesEnabled={alignmentGuidesEnabled}
          alignmentGuides={alignmentGuides}
          overlayNodes={nodes}
          selectionDragPreview={selectionDragPreview}
          connectMenu={connectMenu}
          setConnectMenu={setConnectMenu}
          screenToFlowPosition={screenToFlowPosition}
          handleAddAndConnect={handleAddAndConnect}
          handleAddDomainLibraryItemAndConnect={handleAddDomainLibraryItemAndConnect}
          contextMenu={contextMenu}
          onCloseContextMenu={onCloseContextMenu}
          copySelection={copySelection}
          contextActions={contextActions}
        />
      </div>
    </div>
  );
}
