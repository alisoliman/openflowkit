import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { FLOW_TEMPLATES } from '@/services/templates';
import { buildInsertedTemplateData } from './helpers';

describe('buildInsertedTemplateData route geometry', () => {
  it('moves manual bends and cached route points with an inserted template without changing its source', () => {
    const nodes: FlowNode[] = [
      { id: 'a', position: { x: -10, y: 20 }, data: { label: 'A' } },
      { id: 'b', position: { x: 250, y: 200 }, data: { label: 'B' } },
    ];
    const edge: FlowEdge = {
      id: 'ab', source: 'a', target: 'b', sourceHandle: 'right', targetHandle: 'left',
      data: {
        routingMode: 'manual', waypoint: { x: 80, y: 60 },
        waypoints: [{ x: 100, y: 80 }, { x: 120, y: 200 }],
        elkPoints: [{ x: 40, y: 20 }, { x: 250, y: 200 }],
        importRoutePoints: [{ x: 40, y: 20 }, { x: 250, y: 200 }],
        importRoutePath: 'M 40 20 L 250 200', labelPosition: 0.3,
      },
    };
    const before = structuredClone(edge);
    const result = buildInsertedTemplateData({ ...FLOW_TEMPLATES[0], nodes, edges: [edge] }, [
      { id: 'existing', position: { x: 100, y: 200 }, data: { label: 'Existing' }, width: 200, height: 100 },
    ]);

    expect(result.newNodes[0].position).toEqual({ x: 390, y: 220 });
    expect(result.newEdges[0]).toMatchObject({
      source: result.newNodes[0].id, target: result.newNodes[1].id,
      sourceHandle: 'right', targetHandle: 'left',
      data: {
        routingMode: 'manual', waypoint: { x: 480, y: 260 },
        waypoints: [{ x: 500, y: 280 }, { x: 520, y: 400 }],
        elkPoints: [{ x: 440, y: 220 }, { x: 650, y: 400 }],
        importRoutePoints: [{ x: 440, y: 220 }, { x: 650, y: 400 }],
        labelPosition: 0.3,
      },
    });
    expect(result.newEdges[0].data?.importRoutePath).toBeUndefined();
    expect(edge).toEqual(before);
  });

  it('retains a path-only import when no point representation is available', () => {
    const result = buildInsertedTemplateData({
      ...FLOW_TEMPLATES[0],
      edges: [{ id: 'path', source: 'a', target: 'b', data: { routingMode: 'manual', waypoint: { x: 10, y: 20 }, importRoutePath: 'M 1 2 C 3 4 5 6 7 8' } }],
    }, []);
    expect(result.newEdges[0].data?.importRoutePath).toBe('M 1 2 C 3 4 5 6 7 8');
  });
});
