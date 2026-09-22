import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { parseDslOrThrow } from './graphComposer';
import { applyAIResultToCanvas, positionNewNodesSmartly, restoreExistingPositions } from './positionPreservingApply';

function node(id: string, x = 0, y = 0): FlowNode {
  return { id, type: 'process', position: { x, y }, data: { label: id } } as FlowNode;
}

describe('applyAIResultToCanvas', () => {
  it('preserves existing position for matched nodes', () => {
    const existing = [node('a', 100, 200)];
    const idMap = new Map([['ai-a', 'a']]);
    const { mergedNodes, newNodeIds } = applyAIResultToCanvas(
      [node('ai-a', 0, 0)],
      [],
      existing,
      idMap
    );

    expect(mergedNodes[0].id).toBe('a');
    expect(mergedNodes[0].position).toEqual({ x: 100, y: 200 });
    expect(newNodeIds.size).toBe(0);
  });

  it('marks unmatched nodes as new', () => {
    const { mergedNodes, newNodeIds } = applyAIResultToCanvas(
      [node('brand-new')],
      [],
      [],
      new Map()
    );

    expect(mergedNodes[0].id).toBe('brand-new');
    expect(newNodeIds.has('brand-new')).toBe(true);
  });

  it('handles a mix of matched and new nodes', () => {
    const existing = [node('keep-me', 50, 60)];
    const idMap = new Map([['ai-keep', 'keep-me'], ['ai-new', 'ai-new']]);
    const { mergedNodes, newNodeIds } = applyAIResultToCanvas(
      [node('ai-keep'), node('ai-new')],
      [],
      existing,
      idMap
    );

    expect(mergedNodes.find((n) => n.id === 'keep-me')?.position).toEqual({ x: 50, y: 60 });
    expect(newNodeIds.has('ai-new')).toBe(true);
    expect(newNodeIds.has('keep-me')).toBe(false);
  });

  it('removes omitted DSL attributes while retaining editor-only metadata and node positions', () => {
    const existing = node('api', 100, 200);
    existing.data = {
      label: 'API', subLabel: 'Remove this subtitle', archEnvironment: 'staging',
      pinned: true, imageAssetId: 'local-image',
    };
    const parsed = parseDslOrThrow('flow: Test\n[process] api: API');
    const { mergedNodes } = applyAIResultToCanvas(parsed.nodes, [], [existing], new Map([['api', 'api']]));

    expect(mergedNodes[0].data.subLabel).toBeUndefined();
    expect(mergedNodes[0].data.archEnvironment).toBeUndefined();
    expect(mergedNodes[0].data.pinned).toBe(true);
    expect(mergedNodes[0].data.imageAssetId).toBe('local-image');
    expect(mergedNodes[0].position).toEqual({ x: 100, y: 200 });
  });

  it('can turn a dashed conditional connection into a plain solid connection', () => {
    const existing: FlowEdge = {
      id: 'existing-edge', source: 'api', target: 'db', label: 'query',
      sourceHandle: 'bottom-source', targetHandle: 'top-target',
      style: { stroke: '#123456', strokeDasharray: '5 5' },
      data: { label: 'query', styleType: 'dashed', style: 'dashed', condition: 'timeout', labelOffsetX: 12 },
    };
    const parsed = parseDslOrThrow('flow: Test\n[process] api: API\n[process] db: DB\napi ->|query| db');
    const { mergedEdges } = applyAIResultToCanvas(parsed.nodes, parsed.edges, parsed.nodes, new Map(), [existing]);

    expect(mergedEdges[0].id).toBe('existing-edge');
    expect(mergedEdges[0].style?.strokeDasharray).toBeUndefined();
    expect(mergedEdges[0].data?.styleType).toBeUndefined();
    expect(mergedEdges[0].data?.style).toBeUndefined();
    expect(mergedEdges[0].data?.condition).toBeUndefined();
    expect(mergedEdges[0].style?.stroke).toBe('#123456');
    expect(mergedEdges[0].data?.labelOffsetX).toBe(12);
    expect(mergedEdges[0].sourceHandle).toBe('bottom-source');
    expect(mergedEdges[0].targetHandle).toBe('top-target');
  });
});

describe('positionNewNodesSmartly', () => {
  it('places a new node between two existing neighbors near their midpoint', () => {
    const a = node('a', 0, 0);
    const b = node('b', 0, 400);
    const newNode = node('new', 0, 0);
    const edges = [
      { id: 'e1', source: 'a', target: 'new', type: 'smoothstep', data: {} },
      { id: 'e2', source: 'new', target: 'b', type: 'smoothstep', data: {} },
    ];
    const existingById = new Map([['a', a], ['b', b]]);
    const result = positionNewNodesSmartly([a, b, newNode], edges, new Set(['new']), existingById);
    const placed = result.find((n) => n.id === 'new')!;
    // Should be near midpoint (0, 200) with perpendicular offset
    expect(placed.position.y).toBeGreaterThanOrEqual(150);
    expect(placed.position.y).toBeLessThanOrEqual(250);
  });

  it('places a new node offset from a single neighbor', () => {
    const a = node('a', 100, 100);
    const newNode = node('new', 0, 0);
    const edges = [
      { id: 'e1', source: 'a', target: 'new', type: 'smoothstep', data: {} },
    ];
    const existingById = new Map([['a', a]]);
    const result = positionNewNodesSmartly([a, newNode], edges, new Set(['new']), existingById);
    const placed = result.find((n) => n.id === 'new')!;
    const dist = Math.sqrt(
      (placed.position.x - 100) ** 2 + (placed.position.y - 100) ** 2
    );
    expect(dist).toBe(200);
  });

  it('places orphan nodes to the right of the bounding box', () => {
    const a = node('a', 100, 100);
    const orphan = node('orphan', 0, 0);
    const existingById = new Map([['a', a]]);
    const result = positionNewNodesSmartly([a, orphan], [], new Set(['orphan']), existingById);
    const placed = result.find((n) => n.id === 'orphan')!;
    expect(placed.position.x).toBe(180); // 100 + 80
  });
});

describe('restoreExistingPositions', () => {
  it('restores existing node positions after ELK, keeps ELK position for new nodes', () => {
    const existingById = new Map([['old', node('old', 99, 88)]]);
    const newNodeIds = new Set(['fresh']);

    const elkNodes = [
      node('old', 0, 0),   // ELK moved it — should be restored
      node('fresh', 5, 5), // new node — keep ELK position
    ];

    const result = restoreExistingPositions(elkNodes, newNodeIds, existingById);

    expect(result.find((n) => n.id === 'old')?.position).toEqual({ x: 99, y: 88 });
    expect(result.find((n) => n.id === 'fresh')?.position).toEqual({ x: 5, y: 5 });
  });
});
