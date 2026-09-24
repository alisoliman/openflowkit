import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FlowCanvasSurface } from './FlowCanvasSurface';

const reactFlowProps = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock('@/lib/reactflowCompat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reactflowCompat')>();
  return {
    ...actual,
    default: ({ children, ...props }: { children?: React.ReactNode }) => {
      reactFlowProps.current = props;
      return (
        <div data-testid="reactflow-mock">
          <div className="react-flow__viewport" data-testid="viewport-mock" />
          {children}
        </div>
      );
    },
    Background: () => <div data-testid="background-mock" />,
  };
});

vi.mock('@/components/NavigationControls', () => ({
  NavigationControls: () => <div data-testid="navigation-controls-mock" />,
}));

vi.mock('./FlowCanvasOverlays', () => ({
  FlowCanvasOverlays: () => <div data-testid="flow-canvas-overlays-mock" />,
}));

vi.mock('./flowCanvasTypes', () => ({
  flowCanvasEdgeTypes: {},
  flowCanvasNodeTypes: {},
}));

type SurfaceProps = React.ComponentProps<typeof FlowCanvasSurface>;

function renderSurface(overrides: Partial<SurfaceProps> = {}) {
  const props: SurfaceProps = {
    containerClassName: 'relative',
    wrapperRef: { current: null },
    onPasteCapture: vi.fn(),
    onDoubleClickCapture: vi.fn(),
    selectionAnnouncement: '2 nodes and 1 edge selected.',
    nodes: [
      {
        id: 'node-1',
        type: 'process',
        position: { x: 0, y: 0 },
        selected: true,
        data: { label: 'One' },
      },
      {
        id: 'node-2',
        type: 'process',
        position: { x: 20, y: 20 },
        selected: true,
        data: { label: 'Two' },
      },
    ] as never,
    edges: [
      {
        id: 'edge-1',
        source: 'node-1',
        target: 'node-2',
        selected: true,
      },
    ] as never,
    onNodesChange: vi.fn(),
    onEdgesChange: vi.fn(),
    onConnect: vi.fn(),
    onReconnect: vi.fn(),
    onSelectionChange: vi.fn(),
    onNodeDragStart: vi.fn(),
    onNodeDrag: vi.fn(),
    onNodeDragStop: vi.fn(),
    onMoveStart: vi.fn(),
    onMoveEnd: vi.fn(),
    onNodeDoubleClick: vi.fn(),
    onNodeClick: vi.fn(),
    onEdgeClick: vi.fn(),
    onNodeContextMenu: vi.fn(),
    onSelectionContextMenu: vi.fn(),
    onPaneContextMenu: vi.fn(),
    onEdgeContextMenu: vi.fn(),
    onPaneClick: vi.fn(),
    onConnectStart: vi.fn(),
    onConnectEnd: vi.fn(),
    onDragOver: vi.fn(),
    onDrop: vi.fn(),
    fitView: true,
    isAgentEditing: false,
    reactFlowConfig: {
      className: 'flow',
      onlyRenderVisibleElements: true,
      connectionMode: 'loose',
      isValidConnection: () => true,
      selectionOnDrag: true,
      selectNodesOnDrag: true,
      selectionKeyCode: null,
      panOnDrag: true,
      panActivationKeyCode: null,
      selectionMode: 'partial',
      multiSelectionKeyCode: null,
      zoomActivationKeyCode: null,
      zoomOnScroll: true,
      zoomOnPinch: true,
      panOnScroll: false,
      panOnScrollMode: 'free',
      preventScrolling: true,
      zoomOnDoubleClick: false,
      defaultEdgeOptions: {},
      background: { variant: 'dots', gap: 16, size: 1, color: '#ccc' },
    } as never,
    snapToGrid: false,
    effectiveShowGrid: false,
    alignmentGuidesEnabled: false,
    alignmentGuides: { verticalFlowX: null, horizontalFlowY: null },
    selectionDragPreview: null,
    connectMenu: null,
    setConnectMenu: vi.fn(),
    screenToFlowPosition: (position) => position,
    handleAddAndConnect: vi.fn(),
    handleAddDomainLibraryItemAndConnect: vi.fn(),
    contextMenu: null as never,
    onCloseContextMenu: vi.fn(),
    copySelection: vi.fn(),
    contextActions: {} as never,
    ...overrides,
  };
  const { rerender } = render(<FlowCanvasSurface {...props} />);
  return { ...props, rerender: (next: Partial<SurfaceProps>) => rerender(<FlowCanvasSurface {...props} {...next} />) };
}

const EDIT_HANDLERS = [
  'onNodeDoubleClick',
  'onNodeClick',
  'onEdgeClick',
  'onNodeContextMenu',
  'onSelectionContextMenu',
  'onPaneContextMenu',
  'onEdgeContextMenu',
  'onPaneClick',
] as const;
const DROP_HANDLERS = ['onDragOver', 'onDrop'] as const;

describe('FlowCanvasSurface', () => {
  it('shows a multi-select badge when more than one item is selected', () => {
    renderSurface();

    expect(screen.getByText('3 selected')).toBeInTheDocument();
    expect(screen.getByText('(2 nodes, 1 edge)')).toBeInTheDocument();
  });

  it('lets the user edit the canvas when no Flowpilot turn is running', () => {
    const props = renderSurface();

    for (const handler of [...EDIT_HANDLERS, ...DROP_HANDLERS]) {
      expect(reactFlowProps.current[handler]).toBe(props[handler]);
    }
    expect(reactFlowProps.current).toMatchObject({
      nodesDraggable: true,
      nodesConnectable: true,
      edgesReconnectable: true,
      elementsSelectable: true,
      // Deletion keys belong to the app's shortcut handler, which records one undo step.
      deleteKeyCode: null,
      disableKeyboardA11y: false,
    });
    expect(screen.getByTestId('viewport-mock')).not.toHaveAttribute('inert');
    fireEvent.paste(screen.getByTestId('reactflow-mock'));
    expect(props.onPasteCapture).toHaveBeenCalledTimes(1);
  });

  it('leaves only pan and zoom while a Flowpilot turn edits the page', () => {
    const props = renderSurface({ isAgentEditing: true });

    for (const handler of EDIT_HANDLERS) {
      expect(reactFlowProps.current[handler]).toBeUndefined();
    }
    expect(reactFlowProps.current).toMatchObject({
      nodesDraggable: false,
      nodesConnectable: false,
      edgesReconnectable: false,
      elementsSelectable: false,
      deleteKeyCode: null,
      disableKeyboardA11y: true,
      panOnDrag: true,
      zoomOnScroll: true,
      onMoveStart: props.onMoveStart,
      onMoveEnd: props.onMoveEnd,
    });
    fireEvent.paste(screen.getByTestId('reactflow-mock'));
    fireEvent.doubleClick(screen.getByTestId('reactflow-mock'));
    expect(props.onPasteCapture).not.toHaveBeenCalled();
    expect(props.onDoubleClickCapture).not.toHaveBeenCalled();
  });

  it('refuses a file dropped during a turn, so the browser does not open it in the tab', () => {
    const props = renderSurface({ isAgentEditing: true });

    for (const handler of DROP_HANDLERS) {
      const event = { preventDefault: vi.fn(), dataTransfer: { dropEffect: 'copy' } };
      (reactFlowProps.current[handler] as (event: unknown) => void)(event);
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect(event.dataTransfer.dropEffect).toBe('none');
      expect(props[handler]).not.toHaveBeenCalled();
    }
  });

  it('takes the controls inside nodes and edge labels out of reach for the length of a turn', () => {
    const surface = renderSurface({ isAgentEditing: true });

    expect(screen.getByTestId('viewport-mock')).toHaveAttribute('inert');

    surface.rerender({ isAgentEditing: false });

    expect(screen.getByTestId('viewport-mock')).not.toHaveAttribute('inert');
  });
});
