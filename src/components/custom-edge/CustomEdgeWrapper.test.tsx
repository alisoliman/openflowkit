import React from 'react';
import { createPortal } from 'react-dom';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowEdge } from '@/lib/types';
import { useFlowStore } from '@/store';
import { requestEdgeLabelEdit } from '@/hooks/edgeLabelEditRequest';
import { CustomEdgeWrapper } from './CustomEdgeWrapper';

const flow = vi.hoisted(() => ({ edges: [] as FlowEdge[] }));

vi.mock('@/lib/reactflowCompat', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/reactflowCompat')>()),
  useReactFlow: () => ({
    getEdges: () => flow.edges,
    setEdges: (update: (edges: FlowEdge[]) => FlowEdge[]) => {
      flow.edges = update(flow.edges);
    },
    screenToFlowPosition: (position: { x: number; y: number }) => position,
  }),
  useViewport: () => ({ zoom: 1 }),
  EdgeLabelRenderer: ({ children }: { children: React.ReactNode }) => createPortal(children, document.body),
}));

type WrapperProps = React.ComponentProps<typeof CustomEdgeWrapper>;

function renderEdge(overrides: Partial<WrapperProps> = {}): ReturnType<typeof render> {
  const props: WrapperProps = {
    id: 'e1',
    path: 'M0,0 L100,0',
    sourceX: 0,
    sourceY: 0,
    targetX: 100,
    targetY: 0,
    labelX: 50,
    labelY: 0,
    label: 'Ship it',
    data: {},
    ...overrides,
  };
  return render(
    <svg>
      <CustomEdgeWrapper {...props} />
    </svg>
  );
}

describe('CustomEdgeWrapper', () => {
  const recordHistoryV2 = vi.fn();
  const originalRecordHistory = useFlowStore.getState().recordHistoryV2;

  beforeEach(() => {
    flow.edges = [{ id: 'e1', source: 'a', target: 'b', label: 'Ship it' }];
    recordHistoryV2.mockClear();
    useFlowStore.setState({ recordHistoryV2 });
  });

  afterEach(() => {
    useFlowStore.setState({ recordHistoryV2: originalRecordHistory });
  });

  it('draws a selection halo beneath a selected edge, but not during a cinematic export', () => {
    const { container, unmount } = renderEdge({ selected: true });
    expect(container.querySelector('.flow-edge-selection-halo')).not.toBeNull();
    unmount();

    expect(renderEdge().container.querySelector('.flow-edge-selection-halo')).toBeNull();
    expect(
      renderEdge({
        selected: true,
        cinematicExportState: { active: true, builtEdgeIds: new Set(['e1']) } as never,
      }).container.querySelector('.flow-edge-selection-halo')
    ).toBeNull();
  });

  it('shows route handles only for editable selected connections, and hides them during AI editing or export', () => {
    const { unmount } = renderEdge({ selected: true, routeEditable: true });
    expect(screen.getByRole('button', { name: 'Add bend 1' })).toBeTruthy();
    unmount();
    const hidden = renderEdge({ routeEditable: true });
    expect(screen.queryByRole('button', { name: 'Add bend 1' })).toBeNull();
    hidden.unmount();
    const cinematic = renderEdge({ selected: true, routeEditable: true, cinematicExportState: { active: true, builtEdgeIds: new Set(['e1']) } as never });
    expect(screen.queryByRole('button', { name: 'Add bend 1' })).toBeNull();
    cinematic.unmount();
    useFlowStore.setState({ agentTurn: { id: 'busy' } as never });
    const locked = renderEdge({ selected: true, routeEditable: true });
    expect(screen.queryByRole('button', { name: 'Add bend 1' })).toBeNull();
    locked.unmount();
    useFlowStore.setState({ agentTurn: null });
  });

  it('records one undo step for a changed inline label and none for an unchanged one', () => {
    renderEdge();

    fireEvent.doubleClick(screen.getByText('Ship it'));
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(recordHistoryV2).not.toHaveBeenCalled();

    fireEvent.doubleClick(screen.getByText('Ship it'));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Ship it now' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(recordHistoryV2).toHaveBeenCalledTimes(1);
    expect(flow.edges[0].label).toBe('Ship it now');
  });

  it('opens the inline label editor when the edge menu asks for it', () => {
    renderEdge();

    act(() => {
      requestEdgeLabelEdit('other-edge');
    });
    expect(screen.queryByRole('textbox')).toBeNull();

    act(() => {
      requestEdgeLabelEdit('e1');
    });
    expect(screen.getByRole('textbox')).toHaveValue('Ship it');
  });

  it('shows the requested label editor on an unlabeled edge that is neither selected nor hovered', () => {
    renderEdge({ label: undefined });
    expect(screen.queryByRole('textbox')).toBeNull();

    act(() => {
      requestEdgeLabelEdit('e1');
    });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'New label' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

    expect(flow.edges[0].label).toBe('New label');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('records one undo step per label drag', () => {
    const svgPrototype = SVGElement.prototype as unknown as {
      getTotalLength?: () => number;
      getPointAtLength?: (length: number) => { x: number; y: number };
    };
    svgPrototype.getTotalLength = () => 100;
    svgPrototype.getPointAtLength = (length) => ({ x: length, y: 0 });
    renderEdge();

    fireEvent.pointerDown(screen.getByText('Ship it'));
    fireEvent.pointerMove(window, { clientX: 20, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 70, clientY: 0 });
    fireEvent.pointerUp(window);

    expect(recordHistoryV2).toHaveBeenCalledTimes(1);
    expect(flow.edges[0].data?.labelPosition).toBeCloseTo(0.7);
    delete svgPrototype.getTotalLength;
    delete svgPrototype.getPointAtLength;
  });
});
