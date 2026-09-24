import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '@/lib/types';
import { buildEdgeLineStyleUpdates, resolveEdgeLineStyle } from './edgeLineStyle';

function createEdge(overrides: Partial<FlowEdge> = {}): FlowEdge {
  return {
    id: 'edge-1',
    source: 'a',
    target: 'b',
    data: { dashPattern: 'dashed' },
    ...overrides,
  };
}

describe('edgeLineStyle', () => {
  it('writes the edge type and a curve that outranks the diagram-wide one', () => {
    const edge = createEdge();

    expect(buildEdgeLineStyleUpdates(edge, 'bezier')).toMatchObject({
      type: 'bezier',
      data: { dashPattern: 'dashed', curve: 'basis' },
    });
    expect(buildEdgeLineStyleUpdates(edge, 'smoothstep')).toMatchObject({
      type: 'smoothstep',
      data: { dashPattern: 'dashed', curve: 'smoothstep' },
    });
    expect(buildEdgeLineStyleUpdates(edge, 'step')).toMatchObject({
      type: 'step',
      data: { dashPattern: 'dashed', curve: 'step' },
    });
    expect(buildEdgeLineStyleUpdates(edge, 'straight')).toMatchObject({
      type: 'straight',
      data: { dashPattern: 'dashed', curve: 'linear' },
    });
  });

  it('drops a stored layout route so the style draws from the live endpoints', () => {
    const laidOut = createEdge({
      data: { routingMode: 'elk', elkPoints: [{ x: 1, y: 1 }], importRoutePath: 'M0,0 L1,1' },
    });
    expect(buildEdgeLineStyleUpdates(laidOut, 'step').data).toMatchObject({
      routingMode: 'auto',
      elkPoints: undefined,
      importRoutePath: undefined,
      curve: 'step',
    });

    // A route the user bent by hand stays.
    const bent = createEdge({ data: { routingMode: 'manual', waypoints: [{ x: 5, y: 5 }] } });
    expect(buildEdgeLineStyleUpdates(bent, 'step').data).toEqual({
      routingMode: 'manual',
      waypoints: [{ x: 5, y: 5 }],
      curve: 'step',
    });
  });

  it('resolves the drawn style as the renderer does', () => {
    expect(resolveEdgeLineStyle(createEdge({ type: 'smoothstep', data: { curve: 'step' } }), 'basis')).toBe('step');
    // The template default: a smoothstep type drawn with the diagram's bezier curve.
    expect(resolveEdgeLineStyle(createEdge({ type: 'smoothstep' }), 'basis')).toBe('bezier');
    expect(resolveEdgeLineStyle(createEdge({ type: 'bezier' }), 'linear')).toBe('straight');
    expect(resolveEdgeLineStyle(createEdge({ type: 'step' }), undefined)).toBe('step');
    expect(resolveEdgeLineStyle(createEdge({ type: undefined }), undefined)).toBe('bezier');
    // Under the rounded diagram curve, step and straight typed edges still draw as their type.
    expect(resolveEdgeLineStyle(createEdge({ type: 'step' }), 'smoothstep')).toBe('step');
    expect(resolveEdgeLineStyle(createEdge({ type: 'straight' }), 'smoothstep')).toBe('straight');
    expect(resolveEdgeLineStyle(createEdge({ type: 'bezier' }), 'smoothstep')).toBe('smoothstep');
  });

  it('round-trips every style it writes', () => {
    for (const styleId of ['bezier', 'smoothstep', 'step', 'straight']) {
      const edge = createEdge(buildEdgeLineStyleUpdates(createEdge(), styleId));
      expect(resolveEdgeLineStyle(edge, 'basis')).toBe(styleId);
      expect(resolveEdgeLineStyle(edge, 'smoothstep')).toBe(styleId);
    }
  });
});
