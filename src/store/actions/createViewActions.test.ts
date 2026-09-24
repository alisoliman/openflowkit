import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '@/lib/types';
import type { FlowState } from '../types';
import { createViewActions } from './createViewActions';

function applyGlobalEdgeOptions(
  edges: FlowEdge[],
  options: Parameters<FlowState['setGlobalEdgeOptions']>[0]
): FlowState {
  let state = {
    nodes: [],
    edges,
    tabs: [{ id: 'tab-1', name: 'Tab 1', nodes: [], edges, history: { past: [], future: [] } }],
    activeTabId: 'tab-1',
    globalEdgeOptions: { type: 'bezier', curve: 'basis', animated: false, strokeWidth: 1.5 },
  } as unknown as FlowState;
  const set = (partial: Partial<FlowState> | ((current: FlowState) => Partial<FlowState>)): void => {
    state = { ...state, ...(typeof partial === 'function' ? partial(state) : partial) };
  };
  createViewActions(set).setGlobalEdgeOptions(options);
  return state;
}

describe('setGlobalEdgeOptions', () => {
  const restyledEdge: FlowEdge = {
    id: 'e1',
    source: 'a',
    target: 'b',
    type: 'step',
    data: { curve: 'step', dashPattern: 'dotted' },
  };

  it('drops per-edge curves when the diagram-wide line style changes', () => {
    const state = applyGlobalEdgeOptions([restyledEdge], { type: 'straight', curve: 'linear' });

    expect(state.globalEdgeOptions.curve).toBe('linear');
    expect(state.edges[0].type).toBe('straight');
    expect(state.edges[0].data).toEqual({ curve: undefined, dashPattern: 'dotted' });
    expect(state.tabs[0].edges).toBe(state.edges);
  });

  it('keeps per-edge curves when another diagram-wide option changes', () => {
    const state = applyGlobalEdgeOptions([restyledEdge], { animated: true });

    expect(state.edges[0].animated).toBe(true);
    expect(state.edges[0].data).toEqual({ curve: 'step', dashPattern: 'dotted' });
  });
});
