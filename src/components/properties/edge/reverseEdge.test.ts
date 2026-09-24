import { describe, expect, it } from 'vitest';
import type { FlowEdge } from '@/lib/types';
import {
  attachMermaidImportedEdgeMetadata,
  readMermaidImportedEdgeMetadata,
} from '@/services/mermaid/importProvenance';
import { buildReversedEdgeUpdates, canReverseEdge } from './reverseEdge';

describe('buildReversedEdgeUpdates', () => {
  it('swaps the ends and walks stored route points the other way', () => {
    const edge: FlowEdge = {
      id: 'e1',
      source: 'a',
      target: 'b',
      sourceHandle: 'right',
      targetHandle: 'left',
      markerEnd: { type: 'arrowclosed' } as FlowEdge['markerEnd'],
      data: {
        routingMode: 'manual',
        waypoints: [{ x: 1, y: 1 }, { x: 2, y: 2 }],
        elkPoints: [{ x: 3, y: 3 }, { x: 4, y: 4 }],
        labelPosition: 0.25,
      },
    };

    expect(buildReversedEdgeUpdates(edge)).toEqual({
      source: 'b',
      target: 'a',
      sourceHandle: 'left',
      targetHandle: 'right',
      data: {
        routingMode: 'manual',
        waypoints: [{ x: 2, y: 2 }, { x: 1, y: 1 }],
        elkPoints: [{ x: 4, y: 4 }, { x: 3, y: 3 }],
        labelPosition: 0.75,
      },
    });
    // The input is left untouched.
    expect(edge.data?.waypoints?.[0]).toEqual({ x: 1, y: 1 });
  });

  it('drops an imported path string it cannot reverse', () => {
    const edge: FlowEdge = {
      id: 'e1',
      source: 'a',
      target: 'b',
      data: { routingMode: 'import-fixed', importRoutePath: 'M0,0 L10,10', importRoutePoints: [{ x: 0, y: 0 }, { x: 10, y: 10 }] },
    };

    expect(buildReversedEdgeUpdates(edge).data).toEqual({
      routingMode: 'import-fixed',
      importRoutePath: undefined,
      importRoutePoints: [{ x: 10, y: 10 }, { x: 0, y: 0 }],
    });
  });

  it('moves the arrowhead of an architecture edge to the other node', () => {
    const edge: FlowEdge = {
      id: 'e1',
      source: 'a',
      target: 'b',
      markerEnd: { type: 'arrowclosed', color: '#123456' } as FlowEdge['markerEnd'],
      data: { archDirection: '-->', archSourceSide: 'R', archTargetSide: 'L' },
    };

    const reversed = { ...edge, ...buildReversedEdgeUpdates(edge) };

    // The arrowhead sits at the target end, which is now node a.
    expect(reversed).toMatchObject({ source: 'b', target: 'a' });
    expect(reversed.markerEnd).toEqual(edge.markerEnd);
    expect(reversed.markerStart).toBeUndefined();
    expect(reversed.data).toMatchObject({ archDirection: '-->', archSourceSide: 'L', archTargetSide: 'R' });
  });

  it('swaps the handles a Mermaid import prefers', () => {
    const edge = attachMermaidImportedEdgeMetadata(
      { id: 'e1', source: 'a', target: 'b', data: {} },
      {
        source: 'official-flowchart',
        fidelity: 'renderer-backed',
        hasFixedRoute: false,
        preferredSourceHandle: 'bottom',
        preferredTargetHandle: 'top',
      }
    );

    const reversed = { ...edge, ...buildReversedEdgeUpdates(edge) };

    expect(readMermaidImportedEdgeMetadata(reversed)).toMatchObject({
      hasFixedRoute: false,
      preferredSourceHandle: 'top',
      preferredTargetHandle: 'bottom',
    });
  });

  it('refuses mindmap branches, whose source is the parent topic', () => {
    const nodes = [
      { id: 'root', type: 'mindmap' },
      { id: 'topic', type: 'mindmap' },
      { id: 'note', type: 'process' },
    ];

    expect(canReverseEdge({ source: 'root', target: 'topic' }, nodes)).toBe(false);
    expect(canReverseEdge({ source: 'topic', target: 'note' }, nodes)).toBe(true);
  });
});
