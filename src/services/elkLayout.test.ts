import { describe, expect, it, vi } from 'vitest';
import {
  SECTION_CONTENT_PADDING_TOP,
  SECTION_RENDER_MIN_HEIGHT,
  SECTION_RENDER_MIN_WIDTH,
  SECTION_TITLE_OFFSET,
} from '@/hooks/node-operations/sectionBounds';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { attachMermaidImportedNodeMetadata } from '@/services/mermaid/importProvenance';
import { getElkInstance } from './elk-layout/runtime';
import {
  applyElkLayoutToNodes,
  buildResolvedLayoutConfiguration,
  clearLayoutCache,
  getDeterministicSeedOptions,
  getElkLayout,
  normalizeElkEdgeBoundaryFanout,
  normalizeLayoutInputsForDeterminism,
  normalizeParentedElkPositions,
  resolveAutomaticLayoutAlgorithm,
  resolveLayoutedEdgeHandles,
  resolveLayoutPresetOptions,
  shouldUseLightweightLayoutPostProcessing,
} from './elkLayout';

function createNode(id: string, parentId?: string): FlowNode {
  return {
    id,
    type: 'process',
    position: { x: 0, y: 0 },
    data: { label: id },
    parentId,
  } as FlowNode;
}

function createEdge(id: string, source: string, target: string): FlowEdge {
  return { id, source, target } as FlowEdge;
}

function createPositionMap(
  entries: Array<[string, { x: number; y: number; width?: number; height?: number }]>
) {
  return new Map(entries);
}

describe('normalizeLayoutInputsForDeterminism', () => {
  it('sorts top-level nodes, child nodes, and edges deterministically', () => {
    const nodes = [
      createNode('z'),
      createNode('a'),
      createNode('c-child', 'group-1'),
      createNode('group-1'),
      createNode('b-child', 'group-1'),
    ];
    const edges = [
      createEdge('e2', 'z', 'a'),
      createEdge('e1', 'a', 'z'),
      createEdge('e3', 'a', 'z'),
    ];

    const normalized = normalizeLayoutInputsForDeterminism(nodes, edges);
    const childIds = (normalized.childrenByParent.get('group-1') || []).map((node) => node.id);

    expect(normalized.topLevelNodes.map((node) => node.id)).toEqual(['a', 'z', 'group-1']);
    expect(childIds).toEqual(['b-child', 'c-child']);
    expect(normalized.sortedEdges.map((edge) => edge.id)).toEqual(['e1', 'e3', 'e2']);
  });

  it('returns empty child list for parents without children', () => {
    const normalized = normalizeLayoutInputsForDeterminism([createNode('a')], []);
    expect(normalized.childrenByParent.get('a')).toBeUndefined();
    expect(normalized.topLevelNodes).toHaveLength(1);
    expect(normalized.sortedEdges).toHaveLength(0);
  });

  it('uses deterministic component tie-break ordering for top-level nodes and edges', () => {
    const nodes = [createNode('z1'), createNode('b1'), createNode('a1'), createNode('c1')];
    const edges = [createEdge('edge-bc', 'b1', 'c1'), createEdge('edge-za', 'z1', 'a1')];

    const normalized = normalizeLayoutInputsForDeterminism(nodes, edges);

    expect(normalized.topLevelNodes.map((node) => node.id)).toEqual(['a1', 'z1', 'b1', 'c1']);
    expect(normalized.sortedEdges.map((edge) => edge.id)).toEqual(['edge-za', 'edge-bc']);
  });

  it('keeps grouped diagram child ordering deterministic across interleaved input order', () => {
    const nodes = [
      createNode('group-b'),
      createNode('a-child-2', 'group-a'),
      createNode('group-a'),
      createNode('b-child-2', 'group-b'),
      createNode('a-child-1', 'group-a'),
      createNode('b-child-1', 'group-b'),
    ];
    const edges = [
      createEdge('edge-b', 'b-child-1', 'b-child-2'),
      createEdge('edge-a', 'a-child-1', 'a-child-2'),
    ];

    const normalized = normalizeLayoutInputsForDeterminism(nodes, edges);

    expect(normalized.topLevelNodes.map((node) => node.id)).toEqual(['group-a', 'group-b']);
    expect((normalized.childrenByParent.get('group-a') || []).map((node) => node.id)).toEqual([
      'a-child-1',
      'a-child-2',
    ]);
    expect((normalized.childrenByParent.get('group-b') || []).map((node) => node.id)).toEqual([
      'b-child-1',
      'b-child-2',
    ]);
  });
});

describe('getDeterministicSeedOptions', () => {
  it('adds deterministic seed for algorithms that support randomized layouts', () => {
    expect(getDeterministicSeedOptions('force')).toEqual({ 'elk.randomSeed': '1337' });
    expect(getDeterministicSeedOptions('stress')).toEqual({ 'elk.randomSeed': '1337' });
    expect(getDeterministicSeedOptions('radial')).toEqual({ 'elk.randomSeed': '1337' });
  });

  it('falls back to deterministic-input-only path for non-seeded algorithms', () => {
    expect(getDeterministicSeedOptions('layered')).toEqual({});
    expect(getDeterministicSeedOptions('mrtree')).toEqual({});
  });
});

describe('resolveLayoutPresetOptions', () => {
  it('keeps explicit options when no preset is provided', () => {
    expect(
      resolveLayoutPresetOptions({ algorithm: 'mrtree', direction: 'BT', spacing: 'compact' })
    ).toEqual({
      algorithm: 'mrtree',
      direction: 'BT',
      spacing: 'compact',
    });
  });

  it('maps hierarchical preset to layered defaults', () => {
    expect(resolveLayoutPresetOptions({ preset: 'hierarchical' })).toEqual({
      algorithm: 'layered',
      direction: 'TB',
      spacing: 'normal',
    });
  });

  it('maps orthogonal compact and spacious presets deterministically', () => {
    expect(resolveLayoutPresetOptions({ preset: 'orthogonal-compact' })).toEqual({
      algorithm: 'layered',
      direction: 'LR',
      spacing: 'compact',
    });
    expect(resolveLayoutPresetOptions({ preset: 'orthogonal-spacious' })).toEqual({
      algorithm: 'layered',
      direction: 'LR',
      spacing: 'loose',
    });
  });
});

describe('buildResolvedLayoutConfiguration', () => {
  it('keeps orthogonal presets direction-consistent and spacing-distinct', () => {
    const compact = buildResolvedLayoutConfiguration({ preset: 'orthogonal-compact' });
    const spacious = buildResolvedLayoutConfiguration({ preset: 'orthogonal-spacious' });

    expect(compact.direction).toBe('LR');
    expect(spacious.direction).toBe('LR');
    expect(compact.layoutOptions['elk.direction']).toBe('RIGHT');
    expect(spacious.layoutOptions['elk.direction']).toBe('RIGHT');

    expect(Number(compact.dims.nodeNode)).toBeLessThan(Number(spacious.dims.nodeNode));
    expect(Number(compact.dims.nodeLayer)).toBeLessThan(Number(spacious.dims.nodeLayer));
    expect(Number(compact.dims.component)).toBeLessThan(Number(spacious.dims.component));
    expect(compact.layoutOptions['elk.layered.nodePlacement.favorStraightEdges']).toBe('true');
    expect(compact.layoutOptions['elk.layered.mergeEdges']).toBe('true');
    expect(compact.layoutOptions['elk.layered.unnecessaryBendpoints']).toBe('true');
    expect(Number(compact.dims.nodeNode)).toBe(40);
  });

  it('applies more spacious layered heuristics for architecture diagrams', () => {
    const standard = buildResolvedLayoutConfiguration({
      algorithm: 'layered',
      direction: 'LR',
      spacing: 'normal',
    });
    const architecture = buildResolvedLayoutConfiguration({
      algorithm: 'layered',
      direction: 'LR',
      spacing: 'normal',
      diagramType: 'architecture',
    });

    // Architecture enforces a minimum spacing floor, so it is >= normal, not strictly greater.
    expect(Number(architecture.dims.nodeNode)).toBeGreaterThanOrEqual(Number(standard.dims.nodeNode));
    expect(Number(architecture.dims.nodeLayer)).toBeGreaterThanOrEqual(Number(standard.dims.nodeLayer));
    expect(Number(architecture.dims.component)).toBeGreaterThanOrEqual(Number(standard.dims.component));
    expect(architecture.layoutOptions['elk.layered.nodePlacement.strategy']).toBe('BRANDES_KOEPF');
    expect(architecture.layoutOptions['elk.spacing.edgeNode']).toBe('24');
    expect(architecture.layoutOptions['elk.spacing.edgeEdge']).toBe('18');
    expect(architecture.layoutOptions['elk.layered.spacing.edgeEdgeBetweenLayers']).toBe('42');
    expect(architecture.layoutOptions['elk.layered.nodePlacement.bk.fixedAlignment']).toBe(
      'BALANCED'
    );
  });

  it('enables compound hierarchy handling and shared root padding', () => {
    const config = buildResolvedLayoutConfiguration({
      algorithm: 'layered',
      direction: 'TB',
      spacing: 'normal',
    });

    expect(config.layoutOptions['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN');
    expect(config.layoutOptions['elk.padding']).toBe('[top=16,left=20,bottom=32,right=20]');
  });
});

describe('normalizeParentedElkPositions', () => {
  it('converts child positions from absolute ELK coordinates to parent-relative flow coordinates', () => {
    const nodes = [
      {
        id: 'section-1',
        type: 'section',
        position: { x: 0, y: 0 },
        data: { label: 'Section' },
        style: { width: 500, height: 400 },
      } as FlowNode,
      createNode('child-1', 'section-1'),
      createNode('child-2'),
    ];

    const absolutePositionMap = createPositionMap([
      ['section-1', { x: 120, y: 80, width: 560, height: 420 }],
      ['child-1', { x: 200, y: 150, width: 120, height: 60 }],
      ['child-2', { x: 700, y: 500, width: 120, height: 60 }],
    ]);

    const normalized = normalizeParentedElkPositions(nodes, absolutePositionMap);

    expect(normalized.get('section-1')).toEqual({ x: 120, y: 80, width: 560, height: 420 });
    expect(normalized.get('child-1')).toEqual({ x: 80, y: 70, width: 120, height: 60 });
    expect(normalized.get('child-2')).toEqual({ x: 700, y: 500, width: 120, height: 60 });
  });
});

describe('applyElkLayoutToNodes', () => {
  it('updates section size while preserving parent-relative child coordinates', () => {
    const section = {
      id: 'section-1',
      type: 'section',
      position: { x: 0, y: 0 },
      data: { label: 'Section' },
      style: { width: 500, height: 400 },
    } as FlowNode;
    const child = {
      ...createNode('child-1', 'section-1'),
      position: { x: 0, y: 0 },
      style: { width: 120, height: 60 },
    } as FlowNode;

    const laidOutNodes = applyElkLayoutToNodes(
      [section, child],
      createPositionMap([
        ['section-1', { x: 120, y: 80, width: 560, height: 420 }],
        ['child-1', { x: 200, y: 150, width: 120, height: 60 }],
      ])
    );

    expect(laidOutNodes.find((node) => node.id === 'section-1')?.position).toEqual({
      x: 120,
      y: 80,
    });
    expect(laidOutNodes.find((node) => node.id === 'section-1')?.style).toMatchObject({
      width: 560,
      height: 420,
    });
    expect(laidOutNodes.find((node) => node.id === 'child-1')?.position).toEqual({ x: 80, y: 70 });
  });
});

describe('normalizeElkEdgeBoundaryFanout', () => {
  it('spreads dense same-side source fan-out along the node boundary', () => {
    const nodes = [
      {
        id: 'source',
        type: 'process',
        position: { x: 0, y: 0 },
        width: 200,
        height: 120,
        data: { label: 'Source' },
      } as FlowNode,
      {
        id: 'a',
        type: 'process',
        position: { x: 300, y: 0 },
        width: 120,
        height: 80,
        data: { label: 'A' },
      } as FlowNode,
      {
        id: 'b',
        type: 'process',
        position: { x: 300, y: 100 },
        width: 120,
        height: 80,
        data: { label: 'B' },
      } as FlowNode,
      {
        id: 'c',
        type: 'process',
        position: { x: 300, y: 200 },
        width: 120,
        height: 80,
        data: { label: 'C' },
      } as FlowNode,
    ];
    const edges = [
      { id: 'e1', source: 'source', target: 'a', sourceHandle: 'right' },
      { id: 'e2', source: 'source', target: 'b', sourceHandle: 'right' },
      { id: 'e3', source: 'source', target: 'c', sourceHandle: 'right' },
    ] as FlowEdge[];
    const edgePointsMap = new Map<string, { x: number; y: number }[]>([
      [
        'e1',
        [
          { x: 200, y: 60 },
          { x: 260, y: 60 },
        ],
      ],
      [
        'e2',
        [
          { x: 200, y: 60 },
          { x: 260, y: 60 },
        ],
      ],
      [
        'e3',
        [
          { x: 200, y: 60 },
          { x: 260, y: 60 },
        ],
      ],
    ]);
    const positionMap = createPositionMap([
      ['source', { x: 0, y: 0, width: 200, height: 120 }],
      ['a', { x: 300, y: 0, width: 120, height: 80 }],
      ['b', { x: 300, y: 100, width: 120, height: 80 }],
      ['c', { x: 300, y: 200, width: 120, height: 80 }],
    ]);

    const normalized = normalizeElkEdgeBoundaryFanout(edges, nodes, positionMap, edgePointsMap);

    expect(normalized.get('e1')?.[0].y).toBeLessThan(60);
    expect(normalized.get('e2')).toBeUndefined();
    expect(normalized.get('e3')?.[0].y).toBeGreaterThan(60);
    expect(normalized.get('e1')).toHaveLength(4);
    expect(normalized.get('e1')?.[1].y).toBe(normalized.get('e1')?.[0].y);
    expect(normalized.get('e1')?.[2].y).toBe(60);
    expect(normalized.get('e1')?.[3]).toEqual({ x: 260, y: 60 });
    expect(normalized.get('e3')?.[1].y).toBe(normalized.get('e3')?.[0].y);
    expect(normalized.get('e3')?.[2].y).toBe(60);
    expect(normalized.get('e3')?.[3]).toEqual({ x: 260, y: 60 });
  });

  it('spreads dense bottom-side source fan-out horizontally', () => {
    const nodes = [
      {
        id: 'source',
        type: 'process',
        position: { x: 0, y: 0 },
        width: 200,
        height: 120,
        data: { label: 'Source' },
      } as FlowNode,
      {
        id: 'a',
        type: 'process',
        position: { x: -80, y: 240 },
        width: 120,
        height: 80,
        data: { label: 'A' },
      } as FlowNode,
      {
        id: 'b',
        type: 'process',
        position: { x: 40, y: 240 },
        width: 120,
        height: 80,
        data: { label: 'B' },
      } as FlowNode,
      {
        id: 'c',
        type: 'process',
        position: { x: 160, y: 240 },
        width: 120,
        height: 80,
        data: { label: 'C' },
      } as FlowNode,
    ];
    const edges = [
      { id: 'e1', source: 'source', target: 'a', sourceHandle: 'bottom' },
      { id: 'e2', source: 'source', target: 'b', sourceHandle: 'bottom' },
      { id: 'e3', source: 'source', target: 'c', sourceHandle: 'bottom' },
    ] as FlowEdge[];
    const edgePointsMap = new Map<string, { x: number; y: number }[]>([
      [
        'e1',
        [
          { x: 100, y: 120 },
          { x: 100, y: 180 },
        ],
      ],
      [
        'e2',
        [
          { x: 100, y: 120 },
          { x: 100, y: 180 },
        ],
      ],
      [
        'e3',
        [
          { x: 100, y: 120 },
          { x: 100, y: 180 },
        ],
      ],
    ]);
    const positionMap = createPositionMap([
      ['source', { x: 0, y: 0, width: 200, height: 120 }],
      ['a', { x: -80, y: 240, width: 120, height: 80 }],
      ['b', { x: 40, y: 240, width: 120, height: 80 }],
      ['c', { x: 160, y: 240, width: 120, height: 80 }],
    ]);

    const normalized = normalizeElkEdgeBoundaryFanout(edges, nodes, positionMap, edgePointsMap);

    expect(normalized.get('e1')?.[0].x).toBeLessThan(100);
    expect(normalized.get('e2')).toBeUndefined();
    expect(normalized.get('e3')?.[0].x).toBeGreaterThan(100);
    expect(normalized.get('e1')).toHaveLength(4);
    expect(normalized.get('e1')?.[1].x).toBe(normalized.get('e1')?.[0].x);
    expect(normalized.get('e1')?.[2].x).toBe(100);
    expect(normalized.get('e1')?.[3]).toEqual({ x: 100, y: 180 });
    expect(normalized.get('e3')?.[1].x).toBe(normalized.get('e3')?.[0].x);
    expect(normalized.get('e3')?.[2].x).toBe(100);
    expect(normalized.get('e3')?.[3]).toEqual({ x: 100, y: 180 });
  });

  it('clamps fan-out spacing to the available node boundary span for dense groups', () => {
    const nodes = [
      {
        id: 'source',
        type: 'process',
        position: { x: 0, y: 0 },
        width: 180,
        height: 60,
        data: { label: 'Source' },
      } as FlowNode,
      ...Array.from(
        { length: 5 },
        (_, index) =>
          ({
            id: `target-${index}`,
            type: 'process',
            position: { x: 280, y: index * 40 },
            width: 120,
            height: 80,
            data: { label: `Target ${index}` },
          }) as FlowNode
      ),
    ];
    const edges = Array.from({ length: 5 }, (_, index) => ({
      id: `e${index}`,
      source: 'source',
      target: `target-${index}`,
      sourceHandle: 'right',
    })) as FlowEdge[];
    const edgePointsMap = new Map(
      edges.map((edge) => [
        edge.id,
        [
          { x: 180, y: 30 },
          { x: 240, y: 30 },
        ],
      ])
    );
    const positionMapEntries: Array<
      [string, { x: number; y: number; width?: number; height?: number }]
    > = [
      ['source', { x: 0, y: 0, width: 180, height: 60 }],
      ...Array.from(
        { length: 5 },
        (_, index) =>
          [`target-${index}`, { x: 280, y: index * 40, width: 120, height: 80 }] as [
            string,
            { x: number; y: number; width?: number; height?: number },
          ]
      ),
    ];
    const positionMap = createPositionMap(positionMapEntries);

    const normalized = normalizeElkEdgeBoundaryFanout(edges, nodes, positionMap, edgePointsMap);
    const top = normalized.get('e0')?.[0];
    const bottom = normalized.get('e4')?.[0];

    expect(top).toBeDefined();
    expect(bottom).toBeDefined();
    expect(top!.y).toBeGreaterThanOrEqual(14);
    expect(bottom!.y).toBeLessThanOrEqual(46);
  });
});

describe('resolveLayoutedEdgeHandles', () => {
  it('reassigns handles from layouted geometry instead of preserving stale sides', () => {
    const nodes = [
      {
        id: 'source',
        type: 'process',
        position: { x: 0, y: 0 },
        width: 200,
        height: 120,
        data: { label: 'Source' },
      } as FlowNode,
      {
        id: 'target',
        type: 'process',
        position: { x: 0, y: 260 },
        width: 120,
        height: 80,
        data: { label: 'Target' },
      } as FlowNode,
    ];
    const edges = [
      {
        id: 'e1',
        source: 'source',
        target: 'target',
        sourceHandle: 'right',
        targetHandle: 'left',
      } as FlowEdge,
    ];

    const rerouted = resolveLayoutedEdgeHandles(nodes, edges);

    expect(rerouted[0].sourceHandle).toBe('bottom');
    expect(rerouted[0].targetHandle).toBe('top');
  });

  it('keeps sibling layouted edges on the same canonical side pair', () => {
    const nodes = [
      {
        id: 'source',
        type: 'process',
        position: { x: 0, y: 0 },
        width: 200,
        height: 120,
        data: { label: 'Source' },
      } as FlowNode,
      {
        id: 'a',
        type: 'process',
        position: { x: 280, y: 0 },
        width: 120,
        height: 80,
        data: { label: 'A' },
      } as FlowNode,
      {
        id: 'b',
        type: 'process',
        position: { x: 280, y: 120 },
        width: 120,
        height: 80,
        data: { label: 'B' },
      } as FlowNode,
      {
        id: 'c',
        type: 'process',
        position: { x: 280, y: 240 },
        width: 120,
        height: 80,
        data: { label: 'C' },
      } as FlowNode,
    ];
    const edges = [
      { id: 'e1', source: 'source', target: 'a' } as FlowEdge,
      { id: 'e2', source: 'source', target: 'b' } as FlowEdge,
      { id: 'e3', source: 'source', target: 'c' } as FlowEdge,
    ];

    const rerouted = resolveLayoutedEdgeHandles(nodes, edges);

    expect(rerouted.every((edge) => edge.sourceHandle === 'right')).toBe(true);
    expect(rerouted.every((edge) => edge.targetHandle === 'left')).toBe(true);
  });
});

describe('resolveAutomaticLayoutAlgorithm', () => {
  it('prefers tree layout for high-branching acyclic graphs', () => {
    const nodes = ['root', 'a', 'b', 'c', 'd', 'e'].map((id) => createNode(id));
    const edges = ['a', 'b', 'c', 'd', 'e'].map((id, index) => createEdge(`e${index}`, 'root', id));

    expect(resolveAutomaticLayoutAlgorithm(nodes, edges, { diagramType: 'flowchart' })).toBe(
      'mrtree'
    );
  });

  it('switches cyclic graphs away from layered layout automatically', () => {
    const nodes = ['a', 'b', 'c'].map((id) => createNode(id));
    const edges = [
      createEdge('e1', 'a', 'b'),
      createEdge('e2', 'b', 'c'),
      createEdge('e3', 'c', 'a'),
    ];

    expect(resolveAutomaticLayoutAlgorithm(nodes, edges, { diagramType: 'flowchart' })).toBe(
      'force'
    );
  });

  it('keeps architecture imports on layered layout', () => {
    const nodes = [createNode('edge'), createNode('api')];
    const edges = [createEdge('e1', 'edge', 'api')];

    expect(resolveAutomaticLayoutAlgorithm(nodes, edges, { diagramType: 'architecture' })).toBe(
      'layered'
    );
  });
});

describe('shouldUseLightweightLayoutPostProcessing', () => {
  it('keeps smaller standard diagrams on the full post-processing path', () => {
    expect(shouldUseLightweightLayoutPostProcessing(20, 24, 'flowchart')).toBe(false);
  });

  it('switches larger diagrams to the lightweight post-processing path', () => {
    expect(shouldUseLightweightLayoutPostProcessing(48, 20, 'flowchart')).toBe(true);
    expect(shouldUseLightweightLayoutPostProcessing(16, 72, 'flowchart')).toBe(true);
  });

  it('switches architecture diagrams to lightweight post-processing for large graphs', () => {
    expect(shouldUseLightweightLayoutPostProcessing(40, 20, 'architecture')).toBe(true);
    expect(shouldUseLightweightLayoutPostProcessing(12, 60, 'infrastructure')).toBe(true);
    expect(shouldUseLightweightLayoutPostProcessing(24, 20, 'architecture')).toBe(false);
  });
});

describe('getElkLayout', () => {
  it('lays out sections with ELK, keeping children inside them in flow order', async () => {
    clearLayoutCache();
    const nodes = [
      createNode('users'),
      { ...createNode('vnet'), type: 'section' } as FlowNode,
      createNode('gateway', 'vnet'),
      createNode('cluster', 'vnet'),
      createNode('db'),
    ];
    const edges = [
      createEdge('e1', 'users', 'gateway'),
      createEdge('e2', 'gateway', 'cluster'),
      createEdge('e3', 'cluster', 'db'),
    ];

    const { nodes: laidOut } = await getElkLayout(nodes, edges, { direction: 'LR' });
    const byId = new Map(laidOut.map((node) => [node.id, node]));
    const section = byId.get('vnet')!;
    const gateway = byId.get('gateway')!.position;
    const cluster = byId.get('cluster')!.position;

    expect(byId.get('users')!.position.x).toBeLessThan(section.position.x);
    expect(gateway.x).toBeGreaterThan(0);
    expect(gateway.y).toBeGreaterThan(0);
    expect(cluster.x).toBeGreaterThan(gateway.x);
    expect(cluster.x).toBeLessThan(Number(section.style?.width));
    expect(section.position.x + Number(section.style?.width)).toBeLessThan(byId.get('db')!.position.x);
  });

  it('sizes sections at least as big as SectionNode draws them, nested ones too', async () => {
    for (const options of [{ direction: 'TB' }, { direction: 'LR' }, { algorithm: 'mrtree' }] as const) {
      clearLayoutCache();
      const nodes = [
        { ...createNode('outer'), type: 'section' } as FlowNode,
        { ...createNode('inner', 'outer'), type: 'section' } as FlowNode,
        createNode('api', 'inner'),
      ];

      const { nodes: laidOut } = await getElkLayout(nodes, [], options);

      for (const id of ['outer', 'inner']) {
        const style = laidOut.find((node) => node.id === id)!.style;
        expect(Number(style?.width)).toBeGreaterThanOrEqual(SECTION_RENDER_MIN_WIDTH);
        expect(Number(style?.height)).toBeGreaterThanOrEqual(SECTION_RENDER_MIN_HEIGHT);
      }
    }
  });

  it('keeps a nested section title below the title of the section holding it', async () => {
    for (const options of [{ direction: 'TB' }, { direction: 'LR' }, { algorithm: 'mrtree' }] as const) {
      clearLayoutCache();
      const nodes = [
        { ...createNode('outer'), type: 'section' } as FlowNode,
        { ...createNode('inner', 'outer'), type: 'section' } as FlowNode,
        createNode('api', 'inner'),
      ];

      const { nodes: laidOut } = await getElkLayout(nodes, [], options);
      const y = (id: string) => laidOut.find((node) => node.id === id)!.position.y;

      // SectionNode draws the inner title SECTION_TITLE_OFFSET above its border.
      expect(y('inner')).toBe(SECTION_CONTENT_PADDING_TOP + SECTION_TITLE_OFFSET);
      expect(y('api')).toBe(SECTION_CONTENT_PADDING_TOP);
    }
  });

  it('lays out unconnected nodes in a section along the diagram, whatever the algorithm', async () => {
    for (const [options, axis] of [
      [{ direction: 'TB' }, 'y'],
      [{ algorithm: 'mrtree', direction: 'TB' }, 'y'],
      [{ direction: 'LR' }, 'x'],
    ] as const) {
      clearLayoutCache();
      const nodes = [
        { ...createNode('team'), type: 'section' } as FlowNode,
        createNode('ann', 'team'),
        createNode('bob', 'team'),
        createNode('cat', 'team'),
      ];

      const { nodes: laidOut } = await getElkLayout(nodes, [], options);
      const people = laidOut.filter((node) => node.parentId === 'team');

      // Side by side in a top-down diagram, stacked in a left-to-right one, like siblings outside sections.
      expect(new Set(people.map((node) => node.position[axis])).size, JSON.stringify(options)).toBe(1);
    }
  });

  it('leaves a Mermaid-imported section the size of its contents', async () => {
    clearLayoutCache();
    const subgraph = attachMermaidImportedNodeMetadata(
      { ...createNode('subgraph'), type: 'section' } as FlowNode,
      { role: 'container', source: 'official-flowchart', fidelity: 'renderer-backed' }
    );

    const { nodes: laidOut } = await getElkLayout([subgraph, createNode('api', 'subgraph')], []);

    expect(Number(laidOut.find((node) => node.id === 'subgraph')!.style?.height)).toBeLessThan(
      SECTION_RENDER_MIN_HEIGHT
    );
  });

  it('gives a section the user resized its laid-out size, clear of the node after it', async () => {
    const layout = vi.spyOn(await getElkInstance(), 'layout');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const run of ['elk', 'fallback']) {
      clearLayoutCache();
      if (run === 'fallback') layout.mockRejectedValueOnce(new Error('boom'));
      const resized = { width: 1000, height: 800 };
      const nodes = [
        {
          ...createNode('vpc'),
          type: 'section',
          ...resized,
          measured: resized,
          style: resized,
        } as FlowNode,
        createNode('api', 'vpc'),
        createNode('web'),
      ];

      const { nodes: laidOut } = await getElkLayout(nodes, [createEdge('e1', 'api', 'web')], {
        direction: 'TB',
      });
      const section = laidOut.find((node) => node.id === 'vpc')!;
      const size = { width: section.style?.width, height: section.style?.height };

      // React Flow draws a section the user resized at its width and height, not its style size.
      expect({ width: section.width, height: section.height }, run).toEqual(size);
      expect(section.measured, run).toEqual(size);
      expect(laidOut.find((node) => node.id === 'web')!.position.y, run).toBeGreaterThanOrEqual(
        section.position.y + section.height!
      );
    }
    layout.mockRestore();
    errors.mockRestore();
  });

  it('spaces nodes inside a section like the rest of the diagram', async () => {
    clearLayoutCache();
    const nodes = [
      createNode('web'),
      createNode('api'),
      { ...createNode('vnet'), type: 'section' } as FlowNode,
      createNode('gateway', 'vnet'),
      createNode('cluster', 'vnet'),
    ];
    const edges = [createEdge('e1', 'web', 'api'), createEdge('e2', 'gateway', 'cluster')];

    const { nodes: laidOut } = await getElkLayout(nodes, edges, { direction: 'LR' });
    const x = (id: string) => laidOut.find((node) => node.id === id)!.position.x;

    expect(x('cluster') - x('gateway')).toBe(x('api') - x('web'));
  });

  it('lays out the whole hierarchy at once even when no edge leaves a section', async () => {
    clearLayoutCache();
    const layout = vi.spyOn(await getElkInstance(), 'layout');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nodes = [
      { ...createNode('vnet'), type: 'section' } as FlowNode,
      createNode('gateway', 'vnet'),
      createNode('cluster', 'vnet'),
    ];

    await getElkLayout(nodes, [createEdge('e1', 'gateway', 'cluster')]);

    expect(layout.mock.calls[0][0].layoutOptions?.['elk.hierarchyHandling']).toBe('INCLUDE_CHILDREN');
    expect(errors).not.toHaveBeenCalled();
    layout.mockRestore();
    errors.mockRestore();
  });

  it('packs unconnected nodes into rows rather than one long row', async () => {
    clearLayoutCache();
    const nodes = Array.from({ length: 12 }, (_, index) => createNode(`n${index}`));

    const { nodes: laidOut } = await getElkLayout(nodes, [], { direction: 'TB' });

    expect(new Set(laidOut.map((node) => node.position.y)).size).toBeGreaterThan(1);
  });

  it('places a section after the node leading into it, whatever the algorithm', async () => {
    for (const algorithm of ['layered', 'mrtree', 'force'] as const) {
      clearLayoutCache();
      const nodes = [
        createNode('users'),
        { ...createNode('vnet'), type: 'section' } as FlowNode,
        createNode('gateway', 'vnet'),
        createNode('cluster', 'vnet'),
      ];
      const edges = [createEdge('e1', 'users', 'gateway'), createEdge('e2', 'gateway', 'cluster')];

      const { nodes: laidOut } = await getElkLayout(nodes, edges, { algorithm, direction: 'TB' });
      const byId = new Map(laidOut.map((node) => [node.id, node]));

      expect(byId.get('vnet')!.position.y, algorithm).toBeGreaterThan(byId.get('users')!.position.y);
      expect(byId.get('cluster')!.position.y, algorithm).toBeGreaterThan(byId.get('gateway')!.position.y);
    }
  });

  it('lays out an edge from a section to its own child with ELK, whatever the algorithm', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const algorithm of ['layered', 'mrtree'] as const) {
      clearLayoutCache();
      const nodes = [{ ...createNode('vnet'), type: 'section' } as FlowNode, createNode('gateway', 'vnet')];

      await getElkLayout(nodes, [createEdge('e1', 'vnet', 'gateway')], { algorithm });
    }

    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('lays out graphs with self-loops without falling back or overlapping nodes, and keeps the loops', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const graphs = [
      {
        nodes: [createNode('n0'), createNode('n1'), createNode('n2'), createNode('n3')],
        edges: [createEdge('e1', 'n3', 'n2'), createEdge('loop', 'n1', 'n1')],
      },
      {
        nodes: [
          createNode('n0'),
          createNode('n1'),
          { ...createNode('n2'), type: 'section' } as FlowNode,
          createNode('n3', 'n2'),
          createNode('n4', 'n2'),
        ],
        edges: [createEdge('loop', 'n0', 'n0'), createEdge('inner-loop', 'n4', 'n4'), createEdge('e1', 'n1', 'n3')],
      },
    ];
    for (const { nodes, edges } of graphs) {
      clearLayoutCache();

      const { nodes: laidOut, edges: laidOutEdges } = await getElkLayout(nodes, edges, {
        direction: 'TB',
        diagramType: 'architecture',
      });
      const rect = (node: FlowNode) => ({
        ...node.position,
        width: Number(node.style?.width ?? node.width ?? 150),
        height: Number(node.style?.height ?? node.height ?? 50),
      });
      const topLevel = laidOut.filter((node) => !node.parentId).map(rect);

      expect(errors).not.toHaveBeenCalled();
      expect(laidOutEdges.map((edge) => edge.id).sort()).toEqual(edges.map((edge) => edge.id).sort());
      for (const [index, a] of topLevel.entries()) {
        for (const b of topLevel.slice(index + 1)) {
          const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
          expect(overlap, JSON.stringify([a, b])).toBe(false);
        }
      }
    }
    errors.mockRestore();
  });

  it('falls back to a layout that keeps children inside sections sized to draw when ELK fails', async () => {
    clearLayoutCache();
    const layout = vi.spyOn(await getElkInstance(), 'layout').mockRejectedValueOnce(new Error('boom'));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const nodes = [
      createNode('users'),
      { ...createNode('vnet'), type: 'section' } as FlowNode,
      createNode('gateway', 'vnet'),
      createNode('cluster', 'vnet'),
    ];
    const edges = [createEdge('e1', 'users', 'gateway'), createEdge('e2', 'gateway', 'cluster')];

    const { nodes: laidOut, edges: laidOutEdges } = await getElkLayout(nodes, edges);
    const byId = new Map(laidOut.map((node) => [node.id, node]));
    const section = byId.get('vnet')!;
    const width = Number(section.style?.width);
    const height = Number(section.style?.height);

    expect(layout).toHaveBeenCalledOnce();
    expect(width).toBeGreaterThanOrEqual(SECTION_RENDER_MIN_WIDTH);
    expect(height).toBeGreaterThanOrEqual(SECTION_RENDER_MIN_HEIGHT);
    for (const id of ['gateway', 'cluster']) {
      const { position } = byId.get(id)!;
      expect(position.x, id).toBeGreaterThanOrEqual(0);
      expect(position.y, id).toBeGreaterThanOrEqual(SECTION_CONTENT_PADDING_TOP);
      expect(position.x, id).toBeLessThan(width);
      expect(position.y, id).toBeLessThan(height);
    }
    expect(byId.get('gateway')!.position).not.toEqual(byId.get('cluster')!.position);
    expect(byId.get('users')!.position).not.toEqual(section.position);
    for (const edge of laidOutEdges) {
      expect(edge.sourceHandle, edge.id).toBeTruthy();
      expect(edge.targetHandle, edge.id).toBeTruthy();
    }
    layout.mockRestore();
    errors.mockRestore();
  });

  it('falls back to a layout that keeps a nested section title below the title holding it', async () => {
    const layout = vi.spyOn(await getElkInstance(), 'layout');
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const direction of ['TB', 'LR'] as const) {
      clearLayoutCache();
      layout.mockRejectedValueOnce(new Error('boom'));
      const nodes = [
        { ...createNode('outer'), type: 'section' } as FlowNode,
        { ...createNode('inner', 'outer'), type: 'section' } as FlowNode,
        createNode('web', 'outer'),
        createNode('api', 'inner'),
      ];

      const { nodes: laidOut } = await getElkLayout(nodes, [], { direction });
      const y = (id: string) => laidOut.find((node) => node.id === id)!.position.y;

      // SectionNode draws the inner title SECTION_TITLE_OFFSET above its border.
      expect(y('inner'), direction).toBeGreaterThanOrEqual(
        SECTION_CONTENT_PADDING_TOP + SECTION_TITLE_OFFSET
      );
      expect(y('api'), direction).toBe(SECTION_CONTENT_PADDING_TOP);
    }
    expect(layout).toHaveBeenCalledTimes(2);
    layout.mockRestore();
    errors.mockRestore();
  });
});
