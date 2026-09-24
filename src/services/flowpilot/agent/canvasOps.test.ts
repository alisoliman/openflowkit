import { describe, expect, it } from 'vitest';
import { resolveNodeSize } from '@/components/nodeHelpers';
import {
  SECTION_RENDER_MIN_HEIGHT,
  SECTION_RENDER_MIN_WIDTH,
  SECTION_TITLE_OFFSET,
} from '@/hooks/node-operations/sectionBounds';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { AGENT_NODE_TYPES, AGENT_TOOLS } from '@/services/copilot/agentTools';
import {
  DESTRUCTIVE_REMOVAL_THRESHOLD,
  applyCanvasEdits,
  tidyNodes,
  type CanvasEditOptions,
  type CanvasEditResult,
  type CanvasGraph,
} from './canvasOps';

type Rect = { x: number; y: number; width: number; height: number };

const LAMBDA = { archIconPackId: 'aws-official-starter-v1', archIconShapeId: 'compute-lambda' };

function node(id: string, x: number, y: number, extra: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    type: 'process',
    position: { x, y },
    data: { label: id.toUpperCase(), color: 'white', shape: 'rounded' },
    ...extra,
  };
}

function section(id: string, x: number, y: number, width: number, height: number): FlowNode {
  return {
    id,
    type: 'section',
    position: { x, y },
    style: { width, height },
    data: { label: id.toUpperCase(), color: 'blue' },
  };
}

function child(parentId: string, base: FlowNode): FlowNode {
  return { ...base, parentId };
}

function edge(source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge {
  return { id: `e-${source}-${target}`, source, target, ...extra };
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

function edit(graph: CanvasGraph, ops: unknown[], options?: CanvasEditOptions) {
  const parsed = AGENT_TOOLS.edit_canvas.parameters.parse({ ops });
  return applyCanvasEdits(graph, parsed.ops, options);
}

function editOk(graph: CanvasGraph, ops: unknown[], options?: CanvasEditOptions): CanvasEditResult {
  const result = edit(graph, ops, options);
  if (result.ok === false) throw new Error(result.error);
  return result;
}

function editError(graph: CanvasGraph, ops: unknown[]): string {
  const result = edit(graph, ops);
  if (result.ok === true) throw new Error('expected the edit to fail');
  return result.error;
}

function byId(result: CanvasGraph, id: string): FlowNode {
  const found = result.nodes.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing node ${id}`);
  return found;
}

function edgeById(result: CanvasGraph, id: string): FlowEdge {
  const found = result.edges.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`missing edge ${id}`);
  return found;
}

function absoluteRect(graph: CanvasGraph, id: string): Rect {
  const target = byId(graph, id);
  let { x, y } = target.position;
  for (let parent = graph.nodes.find((n) => n.id === target.parentId); parent; ) {
    x += parent.position.x;
    y += parent.position.y;
    const parentId = parent.parentId;
    parent = graph.nodes.find((n) => n.id === parentId);
  }
  return { x, y, ...resolveNodeSize(target) };
}

// What SectionNode draws: sections are at least the render minimum, with the title above the border.
function drawnRect(graph: CanvasGraph, id: string): Rect {
  const rect = absoluteRect(graph, id);
  if (byId(graph, id).type !== 'section') return rect;
  return {
    x: rect.x,
    y: rect.y - SECTION_TITLE_OFFSET,
    width: Math.max(rect.width, SECTION_RENDER_MIN_WIDTH),
    height: Math.max(rect.height, SECTION_RENDER_MIN_HEIGHT) + SECTION_TITLE_OFFSET,
  };
}

function overlaps(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

function contains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

function expectNoOverlaps(graph: CanvasGraph, ids: string[]): void {
  for (const [index, id] of ids.entries()) {
    for (const other of ids.slice(index + 1)) {
      expect(overlaps(drawnRect(graph, id), drawnRect(graph, other)), `${id} / ${other}`).toBe(
        false
      );
    }
  }
}

function expectParentsFirst(graph: CanvasGraph): void {
  const index = new Map(graph.nodes.map((n, position) => [n.id, position]));
  for (const n of graph.nodes) {
    if (n.parentId) expect(index.get(n.parentId), n.id).toBeLessThan(index.get(n.id));
  }
}

const threeNodes = (): CanvasGraph => ({
  nodes: [node('a', 0, 0), node('b', 300, 0), node('c', 600, 0)],
  edges: [edge('a', 'b'), edge('b', 'c')],
});

describe('applyCanvasEdits node families', () => {
  it.each(AGENT_NODE_TYPES)('adds a %s node with the app defaults', (type) => {
    const result = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'n1', type, label: 'Thing' },
    ]);
    const added = byId(result, 'n1');
    expect(added.type).toBe(type);
    expect(added.data.label).toBe('Thing');
    expect(result.addedNodeIds).toEqual(['n1']);
  });

  it('uses the node defaults of the canvas for each family', () => {
    const result = editOk(
      { nodes: [], edges: [] },
      [
        { op: 'add_node', id: 'start', type: 'start', label: 'Start' },
        { op: 'add_node', id: 'check', type: 'decision', label: 'Valid?' },
        { op: 'add_node', id: 'group', type: 'section', label: 'VPC' },
        { op: 'add_node', id: 'user', type: 'class', label: 'User' },
        { op: 'add_node', id: 'orders', type: 'er_entity', label: 'orders' },
        { op: 'add_node', id: 'step', type: 'journey', label: 'Browse' },
        { op: 'add_node', id: 'topic', type: 'mindmap', label: 'Idea' },
        { op: 'add_node', id: 'alice', type: 'sequence_participant', label: 'Alice' },
      ],
      { layerId: 'layer-2' }
    );
    expect(byId(result, 'start').data).toMatchObject({ color: 'emerald', shape: 'capsule' });
    expect(byId(result, 'check').data).toMatchObject({ color: 'amber', shape: 'diamond' });
    expect(byId(result, 'group')).toMatchObject({ style: { width: 200, height: 160 } });
    expect(byId(result, 'user').data).toMatchObject({ classAttributes: [], classMethods: [] });
    expect(byId(result, 'orders').data).toMatchObject({ erFields: [] });
    expect(byId(result, 'step').data).toMatchObject({ journeyTask: 'Browse', journeyScore: 3 });
    expect(byId(result, 'topic').data).toMatchObject({ mindmapDepth: 0, shape: 'rounded' });
    expect(byId(result, 'alice').data).toMatchObject({ seqParticipantKind: 'participant' });
    expect(result.nodes.every((added) => added.data.layerId === 'layer-2')).toBe(true);
  });

  it('applies the data fields each family supports', () => {
    const result = editOk({ nodes: [], edges: [] }, [
      {
        op: 'add_node',
        id: 'user',
        type: 'class',
        label: 'User',
        data: {
          classStereotype: 'entity',
          classAttributes: ['+id: string'],
          classMethods: ['+save()'],
        },
      },
      {
        op: 'add_node',
        id: 'orders',
        type: 'er_entity',
        label: 'orders',
        data: { erFields: [{ name: 'id', dataType: 'uuid', isPrimaryKey: true }] },
      },
      {
        op: 'add_node',
        id: 'step',
        type: 'journey',
        label: 'Checkout',
        data: { journeySection: 'Buy', journeyActor: 'Shopper', journeyScore: 2 },
      },
      {
        op: 'add_node',
        id: 'api',
        type: 'process',
        label: 'API',
        data: { subLabel: 'REST', color: 'violet', colorMode: 'filled', shape: 'hexagon' },
      },
    ]);
    expect(byId(result, 'user').data).toMatchObject({
      classStereotype: 'entity',
      classAttributes: ['+id: string'],
      classMethods: ['+save()'],
    });
    expect(byId(result, 'orders').data.erFields).toEqual([
      { name: 'id', dataType: 'uuid', isPrimaryKey: true, isForeignKey: false },
    ]);
    expect(byId(result, 'step').data).toMatchObject({
      journeySection: 'Buy',
      journeyActor: 'Shopper',
      subLabel: 'Shopper',
      journeyScore: 2,
    });
    expect(byId(result, 'api').data).toMatchObject({
      subLabel: 'REST',
      color: 'violet',
      colorMode: 'filled',
      shape: 'hexagon',
    });
  });

  it('rejects data fields the node type does not render', () => {
    const error = editError({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'user', type: 'class', label: 'User', data: { shape: 'diamond' } },
    ]);
    expect(error).toBe(
      'ops[0] (add_node): class nodes do not support data.shape; supported: color, colorMode, classStereotype, classAttributes, classMethods'
    );
    expect(
      editError({ nodes: [], edges: [] }, [
        {
          op: 'add_node',
          id: 'note',
          type: 'text',
          label: 'Hi',
          data: { erFields: [], icon: 'Box' },
        },
      ])
    ).toContain('text nodes do not support data.icon, data.erFields');
  });
});

describe('applyCanvasEdits icons', () => {
  it('resolves Lucide icon names and aliases', () => {
    const result = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'db', type: 'custom', label: 'DB', data: { icon: 'database' } },
      { op: 'add_node', id: 'login', type: 'process', label: 'Login', data: { icon: 'log-in' } },
    ]);
    expect(byId(result, 'db').data.icon).toBe('Database');
    expect(byId(result, 'login').data.icon).toBe('LogIn');
  });

  it('sets provider icons from the bundled catalog', () => {
    const result = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'fn', type: 'custom', label: 'Handler', data: LAMBDA },
    ]);
    expect(byId(result, 'fn').data).toMatchObject({
      ...LAMBDA,
      assetProvider: 'aws',
      assetPresentation: 'icon',
      icon: undefined,
    });
  });

  it('swaps between provider and Lucide icons without leaving stale fields', () => {
    const start = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'fn', type: 'custom', label: 'Handler', data: LAMBDA },
    ]);
    const result = editOk(start, [{ op: 'update_node', id: 'fn', data: { icon: 'Server' } }]);
    expect(byId(result, 'fn').data).toMatchObject({
      icon: 'Server',
      archIconPackId: undefined,
      archIconShapeId: undefined,
      assetProvider: undefined,
    });
  });

  it('rejects unknown and incomplete icon references', () => {
    const graph = { nodes: [], edges: [] };
    const add = (data: Record<string, string>) => [
      { op: 'add_node', id: 'fn', type: 'custom', label: 'Handler', data },
    ];
    expect(editError(graph, add({ icon: 'not-a-real-icon' }))).toContain(
      '"not-a-real-icon" is not a known Lucide icon'
    );
    expect(editError(graph, add({ archIconPackId: LAMBDA.archIconPackId }))).toContain(
      'set data.archIconPackId and data.archIconShapeId together'
    );
    expect(editError(graph, add({ ...LAMBDA, archIconShapeId: 'compute-not-real' }))).toContain(
      'unknown provider icon aws-official-starter-v1/compute-not-real'
    );
    expect(editError(graph, add({ ...LAMBDA, icon: 'Server' }))).toContain(
      'set either data.icon or a provider icon, not both'
    );
  });
});

describe('applyCanvasEdits ids', () => {
  it('renames taken ids, reports them in idMap and resolves later references to the new node', () => {
    const graph = { nodes: [node('api', 0, 0), node('api-2', 0, 200)], edges: [] };
    const result = editOk(graph, [
      { op: 'add_node', id: 'api', type: 'process', label: 'New API' },
      { op: 'add_node', id: 'db', type: 'process', label: 'DB' },
      { op: 'add_edge', source: 'api', target: 'db' },
      { op: 'update_node', id: 'api', label: 'Gateway' },
    ]);
    expect(result.idMap).toEqual({ api: 'api-3' });
    expect(result.addedNodeIds).toEqual(['api-3', 'db']);
    expect(byId(result, 'api-3').data.label).toBe('Gateway');
    expect(byId(result, 'api').data.label).toBe('API');
    expect(result.edges).toEqual([expect.objectContaining({ id: 'e-api-3-db', source: 'api-3' })]);
  });

  it('keeps edge ids unique and honours agent edge ids', () => {
    const graph = { nodes: [node('a', 0, 0), node('b', 300, 0)], edges: [edge('a', 'b')] };
    const result = editOk(graph, [
      { op: 'add_edge', source: 'a', target: 'b' },
      { op: 'add_edge', id: 'e-a-b', source: 'b', target: 'a' },
      { op: 'add_edge', id: 'retry', source: 'b', target: 'a', label: 'retry' },
      { op: 'update_edge', id: 'e-a-b', label: 'back' },
    ]);
    expect(result.addedEdgeIds).toEqual(['e-a-b-2', 'e-a-b-3', 'retry']);
    expect(result.idMap).toEqual({ 'e-a-b': 'e-a-b-3' });
    expect(edgeById(result, 'e-a-b-3')).toMatchObject({ source: 'b', target: 'a', label: 'back' });
    expect(edgeById(result, 'e-a-b').label).toBeUndefined();
    expect(edgeById(result, 'retry').label).toBe('retry');
  });

  it('rejects an id used twice in one call', () => {
    expect(
      editError({ nodes: [], edges: [] }, [
        { op: 'add_node', id: 'x', type: 'process', label: 'X' },
        { op: 'add_node', id: 'x', type: 'process', label: 'X again' },
      ])
    ).toBe('ops[1] (add_node): id "x" is already used earlier in this call');
  });
});

describe('applyCanvasEdits validation', () => {
  it('fails the whole batch on the first invalid op and leaves the input untouched', () => {
    const graph = deepFreeze(threeNodes());
    const snapshot = structuredClone(graph);
    const result = edit(graph, [
      { op: 'add_node', id: 'd', type: 'process', label: 'D' },
      { op: 'remove_node', id: 'a' },
      { op: 'update_node', id: 'missing', label: 'Nope' },
    ]);
    expect(result).toEqual({
      ok: false,
      error:
        'ops[2] (update_node): node "missing" does not exist; call get_canvas for the current ids',
    });
    expect(graph).toEqual(snapshot);
  });

  it('never mutates the input on success', () => {
    const graph = deepFreeze({
      nodes: [section('vpc', 0, 0, 400, 300), child('vpc', node('a', 40, 40)), node('b', 600, 0)],
      edges: [edge('a', 'b')],
    });
    const snapshot = structuredClone(graph);
    editOk(graph, [
      { op: 'add_node', id: 'c', type: 'process', label: 'C', parentId: 'vpc' },
      { op: 'update_node', id: 'b', label: 'Bee', parentId: 'vpc' },
      { op: 'group', id: 'g', label: 'Group', nodeIds: ['a', 'c'] },
      { op: 'update_edge', id: 'e-a-b', label: 'calls' },
      { op: 'remove_node', id: 'vpc' },
    ]);
    expect(graph).toEqual(snapshot);
  });

  it('rejects dangling edges and unknown edges', () => {
    const graph = threeNodes();
    expect(editError(graph, [{ op: 'add_edge', source: 'a', target: 'zzz' }])).toContain(
      'node "zzz" does not exist'
    );
    expect(
      editError(graph, [
        { op: 'remove_node', id: 'c' },
        { op: 'add_edge', source: 'a', target: 'c' },
      ])
    ).toContain('ops[1] (add_edge): node "c" does not exist');
    expect(editError(graph, [{ op: 'update_edge', id: 'e-x', label: 'x' }])).toContain(
      'edge "e-x" does not exist'
    );
    expect(
      editError(graph, [
        { op: 'remove_edge', id: 'e-a-b' },
        { op: 'remove_edge', id: 'e-a-b' },
      ])
    ).toContain('ops[1] (remove_edge): edge "e-a-b" does not exist');
  });

  it('only nests nodes in sections and never in themselves', () => {
    const graph = {
      nodes: [section('outer', 0, 0, 600, 400), child('outer', section('inner', 20, 40, 300, 200))],
      edges: [],
    };
    expect(
      editError({ ...graph, nodes: [...graph.nodes, node('a', 900, 0)] }, [
        { op: 'add_node', id: 'b', type: 'process', label: 'B', parentId: 'a' },
      ])
    ).toBe('ops[0] (add_node): "a" is a process node, not a section');
    expect(editError(graph, [{ op: 'update_node', id: 'outer', parentId: 'inner' }])).toContain(
      'a section cannot go inside itself or one of its own children'
    );
    expect(editError(graph, [{ op: 'update_node', id: 'outer', parentId: 'outer' }])).toContain(
      'a section cannot go inside itself'
    );
  });

  it('lets the agent rename, move or remove nodes it cannot author, but not restyle them', () => {
    const graph = {
      nodes: [
        section('vpc', 0, 0, 600, 400),
        node('svc', 800, 0, { type: 'architecture', data: { label: 'Svc', archProvider: 'aws' } }),
        node('pic', 800, 300, { type: 'image', data: { label: 'Logo', imageUrl: 'x.png' } }),
      ],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'update_node', id: 'svc', label: 'Service', parentId: 'vpc' },
      { op: 'remove_node', id: 'pic' },
    ]);
    expect(byId(result, 'svc')).toMatchObject({
      type: 'architecture',
      parentId: 'vpc',
      data: { label: 'Service', archProvider: 'aws' },
    });
    expect(editError(graph, [{ op: 'update_node', id: 'svc', data: { color: 'red' } }])).toBe(
      'ops[0] (update_node): architecture nodes can only be renamed, moved between sections or removed'
    );
    expect(editError(graph, [{ op: 'update_node', id: 'pic', type: 'process' }])).toContain(
      'image nodes can only be renamed'
    );
  });
});

describe('applyCanvasEdits updates', () => {
  it('merges data and keeps omitted fields', () => {
    const graph = {
      nodes: [
        node('a', 0, 0, { data: { label: 'A', subLabel: 'old', color: 'blue', icon: 'Box' } }),
      ],
      edges: [],
    };
    const result = editOk(graph, [{ op: 'update_node', id: 'a', data: { subLabel: 'new' } }]);
    expect(byId(result, 'a').data).toEqual({
      label: 'A',
      subLabel: 'new',
      color: 'blue',
      icon: 'Box',
    });
    expect(result.summary).toBe('Updated 1 node.');
  });

  it('changes node type in place, keeping content and resetting the look', () => {
    const graph = {
      nodes: [
        section('vpc', 0, 0, 600, 400),
        child(
          'vpc',
          node('a', 40, 60, {
            measured: { width: 150, height: 60 },
            data: {
              label: 'A',
              subLabel: 'detail',
              color: 'red',
              shape: 'rectangle',
              icon: 'Box',
              layerId: 'l1',
            },
          })
        ),
      ],
      edges: [],
    };
    const result = editOk(graph, [{ op: 'update_node', id: 'a', type: 'decision', label: 'OK?' }]);
    expect(byId(result, 'a')).toMatchObject({
      type: 'decision',
      parentId: 'vpc',
      position: { x: 40, y: 60 },
      data: {
        label: 'OK?',
        subLabel: 'detail',
        icon: 'Box',
        layerId: 'l1',
        color: 'amber',
        shape: 'diamond',
      },
    });
    expect(byId(result, 'a').measured).toBeUndefined();

    const asClass = editOk(graph, [{ op: 'update_node', id: 'a', type: 'class' }]);
    expect(byId(asClass, 'a').data).toEqual({
      label: 'A',
      color: 'slate',
      classStereotype: '',
      classAttributes: [],
      classMethods: [],
      layerId: 'l1',
    });
  });

  it('keeps the size, placement and text settings through a type change', () => {
    const graph = {
      nodes: [
        node('a', 0, 0, {
          width: 240,
          height: 120,
          zIndex: 3,
          hidden: true,
          data: {
            label: 'A',
            color: 'red',
            shape: 'rectangle',
            pinned: true,
            rotation: 90,
            fontSize: '18',
            fontFamily: 'mono',
            fontWeight: 'bold',
            fontStyle: 'italic',
            align: 'left',
            transparency: 0.5,
          },
        }),
      ],
      edges: [],
    };
    const result = editOk(graph, [{ op: 'update_node', id: 'a', type: 'decision' }]);
    expect(byId(result, 'a')).toMatchObject({
      type: 'decision',
      width: 240,
      height: 120,
      zIndex: 3,
      hidden: true,
      data: {
        color: 'amber',
        shape: 'diamond',
        pinned: true,
        rotation: 90,
        fontSize: '18',
        fontFamily: 'mono',
        fontWeight: 'bold',
        fontStyle: 'italic',
        align: 'left',
        transparency: 0.5,
      },
    });
  });

  it('refuses type changes to or from sections, mindmap topics and participants', () => {
    const graph = {
      nodes: [
        section('vpc', 0, 0, 400, 300),
        node('a', 600, 0),
        node('topic', 0, 400, { type: 'mindmap', data: { label: 'Topic', mindmapDepth: 0 } }),
        node('alice', 400, 400, { type: 'sequence_participant', data: { label: 'Alice' } }),
      ],
      edges: [],
    };
    const retype = (id: string, type: string) =>
      editError(graph, [{ op: 'update_node', id, type }]);
    expect(retype('vpc', 'process')).toContain(
      'section nodes cannot change type; remove the node and add a new one instead'
    );
    expect(retype('a', 'section')).toContain('section nodes cannot change type');
    expect(retype('topic', 'process')).toContain('mindmap nodes cannot change type');
    expect(retype('a', 'mindmap')).toContain('mindmap nodes cannot change type');
    expect(retype('alice', 'class')).toContain('sequence_participant nodes cannot change type');
    expect(retype('a', 'sequence_participant')).toContain(
      'sequence_participant nodes cannot change type'
    );
  });

  it('keeps the journey task in step with the label', () => {
    const start = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'step', type: 'journey', label: 'Browse' },
    ]);
    const result = editOk(start, [{ op: 'update_node', id: 'step', label: 'Search' }]);
    expect(byId(result, 'step').data).toMatchObject({ label: 'Search', journeyTask: 'Search' });
  });
});

describe('applyCanvasEdits removals', () => {
  it('removes connected edges with the node', () => {
    const result = editOk(threeNodes(), [{ op: 'remove_node', id: 'b' }]);
    expect(result.nodes.map((n) => n.id)).toEqual(['a', 'c']);
    expect(result.edges).toEqual([]);
    expect(result.summary).toBe('Removed 1 node and 2 edges.');
  });

  it('keeps the children of a removed section where they are', () => {
    const graph = {
      nodes: [
        section('outer', 100, 100, 800, 600),
        child('outer', section('inner', 50, 60, 400, 300)),
        child('inner', node('a', 30, 40)),
        node('b', 1200, 0),
      ],
      edges: [],
    };
    const before = absoluteRect(graph, 'a');
    const nested = editOk(graph, [{ op: 'remove_node', id: 'inner' }]);
    expect(byId(nested, 'a').parentId).toBe('outer');
    expect(absoluteRect(nested, 'a')).toEqual(before);

    const topLevel = editOk(graph, [
      { op: 'remove_node', id: 'inner' },
      { op: 'remove_node', id: 'outer' },
    ]);
    expect(byId(topLevel, 'a').parentId).toBeUndefined();
    expect(byId(topLevel, 'a').position).toEqual({ x: before.x, y: before.y });
  });

  it('accepts removing an edge that already went with its node', () => {
    const result = editOk(threeNodes(), [
      { op: 'remove_node', id: 'b' },
      { op: 'remove_edge', id: 'e-a-b' },
    ]);
    expect(result.edges).toEqual([]);
    expect(result.summary).toBe('Removed 1 node and 2 edges.');
    expect(editError(threeNodes(), [{ op: 'remove_edge', id: 'e-a-c' }])).toContain(
      'edge "e-a-c" does not exist'
    );
  });

  it('does not count nodes and edges added and removed in the same call', () => {
    const result = editOk(threeNodes(), [
      { op: 'add_node', id: 'd', type: 'process', label: 'D' },
      { op: 'add_edge', id: 'c-d', source: 'c', target: 'd' },
      { op: 'remove_node', id: 'd' },
    ]);
    expect(result.addedNodeIds).toEqual([]);
    expect(result.addedEdgeIds).toEqual([]);
    expect(result.summary).toBe('No changes.');
    expect(result.destructive.removedNodes).toEqual([]);
  });
});

describe('applyCanvasEdits sections and groups', () => {
  it('places a new child inside its section and grows the section without moving it', () => {
    const graph = {
      nodes: [
        section('vpc', 100, 100, 260, 200),
        child('vpc', node('a', 40, 60)),
        node('b', 900, 100),
      ],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'c', type: 'process', label: 'C', parentId: 'vpc' },
      { op: 'add_edge', source: 'a', target: 'c' },
    ]);
    const vpc = byId(result, 'vpc');
    expect(vpc.position).toEqual({ x: 100, y: 100 });
    expect(byId(result, 'c').parentId).toBe('vpc');
    expect(contains(absoluteRect(result, 'vpc'), absoluteRect(result, 'c'))).toBe(true);
    expect(vpc.style.width).toBeGreaterThan(260);
    expectNoOverlaps(result, ['a', 'b', 'c']);
    expectParentsFirst(result);
  });

  it('groups existing nodes into a section that wraps them where they are', () => {
    const graph = threeNodes();
    const result = editOk(graph, [
      { op: 'group', id: 'tier', label: 'Tier', nodeIds: ['a', 'b'] },
      { op: 'update_node', id: 'tier', data: { color: 'violet' } },
    ]);
    const tier = byId(result, 'tier');
    expect(tier.data).toMatchObject({ label: 'Tier', color: 'violet' });
    expect(byId(result, 'a').parentId).toBe('tier');
    expect(byId(result, 'b').parentId).toBe('tier');
    expect(byId(result, 'c').parentId).toBeUndefined();
    for (const id of ['a', 'b']) {
      expect(absoluteRect(result, id)).toEqual(absoluteRect(graph, id));
      expect(contains(absoluteRect(result, 'tier'), absoluteRect(result, id))).toBe(true);
    }
    expectParentsFirst(result);
    expect(result.summary).toBe('Added 1 node; updated 2 nodes.');
  });

  it('nests a group in the section its members share', () => {
    const graph = {
      nodes: [
        section('vpc', 0, 0, 800, 400),
        child('vpc', node('a', 40, 80)),
        child('vpc', node('b', 300, 80)),
        node('c', 1000, 0),
      ],
      edges: [],
    };
    const shared = editOk(graph, [{ op: 'group', id: 'g', label: 'G', nodeIds: ['a', 'b'] }]);
    expect(byId(shared, 'g').parentId).toBe('vpc');
    expect(contains(absoluteRect(shared, 'vpc'), absoluteRect(shared, 'g'))).toBe(true);
    expect(absoluteRect(shared, 'a')).toEqual(absoluteRect(graph, 'a'));

    const mixed = editOk(graph, [{ op: 'group', id: 'g', label: 'G', nodeIds: ['a', 'c'] }]);
    expect(byId(mixed, 'g').parentId).toBeUndefined();
    expect(absoluteRect(mixed, 'c')).toEqual(absoluteRect(graph, 'c'));
  });

  it('keeps a new section nested in an existing one clear of its border and title', () => {
    const vpc = section('vpc', 100, 100, 400, 300);
    const grouped = editOk(
      {
        nodes: [vpc, child('vpc', node('a', 20, 16)), child('vpc', node('b', 20, 136))],
        edges: [],
      },
      [{ op: 'group', id: 'g', label: 'G', nodeIds: ['a', 'b'] }]
    );
    const added = editOk({ nodes: [vpc], edges: [] }, [
      { op: 'add_node', id: 'g', type: 'section', label: 'G', parentId: 'vpc' },
      { op: 'add_node', id: 'a', type: 'process', label: 'A', parentId: 'g' },
    ]);

    for (const result of [grouped, added]) {
      // The new section starts at the content origin, with its title inside the border.
      expect(byId(result, 'g')).toMatchObject({
        parentId: 'vpc',
        position: { x: 20, y: 16 + SECTION_TITLE_OFFSET },
      });
      expect(byId(result, 'vpc').position).toEqual({ x: 100, y: 100 });
      expect(contains(absoluteRect(result, 'vpc'), drawnRect(result, 'g'))).toBe(true);
      expect(contains(absoluteRect(result, 'g'), absoluteRect(result, 'a'))).toBe(true);
    }
    // Members shift together, so their own layout is kept.
    expect(absoluteRect(grouped, 'b').y - absoluteRect(grouped, 'a').y).toBe(120);
    expect(absoluteRect(grouped, 'b').x).toBe(absoluteRect(grouped, 'a').x);
  });

  it('leaves members inside another member where they are', () => {
    const graph = {
      nodes: [section('vpc', 0, 0, 400, 300), child('vpc', node('a', 40, 60)), node('b', 600, 0)],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'group', id: 'g', label: 'G', nodeIds: ['vpc', 'a', 'b', 'b'] },
    ]);
    expect(byId(result, 'vpc').parentId).toBe('g');
    expect(byId(result, 'a').parentId).toBe('vpc');
    expect(byId(result, 'b').parentId).toBe('g');
    expect(result.nodes.map((n) => n.id)).toEqual(['g', 'vpc', 'a', 'b']);
  });

  it('builds nested sections around new nodes', () => {
    const result = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'web', type: 'process', label: 'Web' },
      { op: 'add_node', id: 'api', type: 'process', label: 'API' },
      { op: 'add_node', id: 'db', type: 'process', label: 'DB' },
      { op: 'add_edge', source: 'web', target: 'api' },
      { op: 'add_edge', source: 'api', target: 'db' },
      { op: 'group', id: 'backend', label: 'Backend', nodeIds: ['api', 'db'] },
      { op: 'group', id: 'cloud', label: 'Cloud', nodeIds: ['backend', 'web'] },
    ]);
    expect(byId(result, 'backend').parentId).toBe('cloud');
    expect(contains(absoluteRect(result, 'cloud'), absoluteRect(result, 'backend'))).toBe(true);
    expect(contains(absoluteRect(result, 'cloud'), absoluteRect(result, 'web'))).toBe(true);
    for (const id of ['api', 'db']) {
      expect(contains(absoluteRect(result, 'backend'), absoluteRect(result, id))).toBe(true);
    }
    expect(overlaps(absoluteRect(result, 'backend'), absoluteRect(result, 'web'))).toBe(false);
    expectParentsFirst(result);
  });

  it('moves an existing node into a section it sits outside of', () => {
    const graph = {
      nodes: [
        section('vpc', 0, 0, 300, 220),
        child('vpc', node('a', 40, 60)),
        node('b', 800, 0),
        node('c', 800, 300),
      ],
      edges: [],
    };
    const result = editOk(graph, [{ op: 'update_node', id: 'b', parentId: 'vpc' }]);
    expect(byId(result, 'b').parentId).toBe('vpc');
    expect(contains(absoluteRect(result, 'vpc'), absoluteRect(result, 'b'))).toBe(true);
    expect(byId(result, 'vpc').position).toEqual({ x: 0, y: 0 });
    expect(byId(result, 'a').position).toEqual({ x: 40, y: 60 });
    expect(byId(result, 'c').position).toEqual({ x: 800, y: 300 });
    expectNoOverlaps(result, ['a', 'b']);
  });

  it('moves an existing section into a section it sits outside of, contents and all', () => {
    const graph = {
      nodes: [
        section('fe', 0, 0, 400, 300),
        child('fe', node('web', 40, 60)),
        section('app', 800, 0, 500, 400),
        child('app', node('api', 40, 60)),
      ],
      edges: [],
    };
    const moved = editOk(graph, [{ op: 'update_node', id: 'fe', parentId: 'app' }]);
    expect(byId(moved, 'fe').parentId).toBe('app');
    expect(contains(absoluteRect(moved, 'app'), drawnRect(moved, 'fe'))).toBe(true);
    expect(byId(moved, 'app').position).toEqual({ x: 800, y: 0 });
    expect(byId(moved, 'fe').style).toEqual({ width: 400, height: 300 });
    expect(byId(moved, 'web').position).toEqual({ x: 40, y: 60 });
    expectNoOverlaps(moved, ['fe', 'api']);
    expectParentsFirst(moved);

    // What lands in the moved section in the same batch keeps clear of what it already holds.
    const filled = editOk(graph, [
      { op: 'update_node', id: 'fe', parentId: 'app' },
      { op: 'add_node', id: 'cdn', type: 'process', label: 'CDN', parentId: 'fe' },
    ]);
    for (const id of ['web', 'cdn']) {
      expect(contains(absoluteRect(filled, 'fe'), absoluteRect(filled, id))).toBe(true);
    }
    expect(contains(absoluteRect(filled, 'app'), drawnRect(filled, 'fe'))).toBe(true);
    expectNoOverlaps(filled, ['web', 'cdn']);
    expectNoOverlaps(filled, ['fe', 'api']);
  });

  it('moves nodes outside an existing section into it with the new section that wraps them', () => {
    const graph = {
      nodes: [
        section('vpc', 0, 0, 400, 300),
        node('a', 1500, 900),
        node('b', 1500, 1020),
        node('c', 700, 100),
      ],
      edges: [],
    };
    const added = editOk(graph, [
      { op: 'add_node', id: 'g', type: 'section', label: 'G', parentId: 'vpc' },
      { op: 'update_node', id: 'a', parentId: 'g' },
      { op: 'update_node', id: 'b', parentId: 'g' },
    ]);
    const grouped = editOk(graph, [
      { op: 'group', id: 'g', label: 'G', nodeIds: ['a', 'b'] },
      { op: 'update_node', id: 'g', parentId: 'vpc' },
    ]);

    for (const result of [added, grouped]) {
      expect(byId(result, 'g').parentId).toBe('vpc');
      expect(contains(absoluteRect(result, 'vpc'), drawnRect(result, 'g'))).toBe(true);
      for (const id of ['a', 'b']) {
        expect(contains(absoluteRect(result, 'g'), absoluteRect(result, id))).toBe(true);
      }
      // Members move together, and the section does not grow over what lies between.
      expect(absoluteRect(result, 'b').y - absoluteRect(result, 'a').y).toBe(120);
      expect(byId(result, 'vpc').position).toEqual({ x: 0, y: 0 });
      expect(byId(result, 'c').position).toEqual({ x: 700, y: 100 });
      expectNoOverlaps(result, ['vpc', 'c']);
      expectParentsFirst(result);
    }
  });

  it('adds to a full section below what it holds, not past the rest of the canvas', () => {
    const cells = Array.from({ length: 12 }, (_, index) =>
      child(
        'vpc',
        node(`c${index}`, 20 + (index % 3) * 270, 16 + Math.floor(index / 3) * 170, {
          style: { width: 200, height: 100 },
        })
      )
    );
    const graph = {
      nodes: [section('vpc', 0, 0, 860, 700), ...cells, node('mid', 1400, 100), node('far', 2500, 100)],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'new', type: 'process', label: 'New', parentId: 'vpc' },
    ]);
    expect(contains(absoluteRect(result, 'vpc'), absoluteRect(result, 'new'))).toBe(true);
    expect(byId(result, 'vpc').style.width).toBe(860);
    expectNoOverlaps(result, ['vpc', 'mid', 'far']);
    expectNoOverlaps(result, ['new', ...cells.map((cell) => cell.id)]);
  });

  it('grows a full section beside what it holds when something lies below it', () => {
    const cells = Array.from({ length: 6 }, (_, index) =>
      child('fe', node(`f${index}`, 20 + (index % 3) * 220, index < 3 ? 40 : 150))
    );
    const graph = {
      nodes: [
        section('fe', 0, 0, 640, 260),
        ...cells,
        section('be', 0, 340, 640, 260),
        child('be', node('api', 20, 40)),
      ],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'new', type: 'process', label: 'New', parentId: 'fe' },
    ]);
    expect(contains(absoluteRect(result, 'fe'), absoluteRect(result, 'new'))).toBe(true);
    expect(byId(result, 'fe').position).toEqual({ x: 0, y: 0 });
    expectNoOverlaps(result, ['fe', 'be']);
    expectNoOverlaps(result, ['new', 'be', ...cells.map((cell) => cell.id)]);
  });

  it('keeps a new section clear of what it does not hold when its members link far apart', () => {
    const graph = {
      nodes: [node('x', 0, 0), node('y', 300, 0), node('z', 600, 0), node('w', 900, 0)],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'vpc', type: 'section', label: 'VPC' },
      { op: 'add_node', id: 'a', type: 'process', label: 'A', parentId: 'vpc' },
      { op: 'add_node', id: 'b', type: 'process', label: 'B', parentId: 'vpc' },
      { op: 'add_edge', source: 'b', target: 'x' },
    ]);
    for (const id of ['a', 'b']) {
      expect(contains(absoluteRect(result, 'vpc'), absoluteRect(result, id))).toBe(true);
    }
    expectNoOverlaps(result, ['vpc', 'x', 'y', 'z', 'w']);
    expectNoOverlaps(result, ['a', 'b']);
    for (const original of graph.nodes) {
      expect(byId(result, original.id)).toEqual(original);
    }
  });

  it('regroups the children of a removed section under the same id', () => {
    const graph = {
      nodes: [
        section('tier', 100, 100, 600, 300),
        child('tier', node('a', 40, 60)),
        child('tier', node('b', 300, 60)),
        node('c', 1000, 100),
      ],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'remove_node', id: 'tier' },
      { op: 'group', id: 'tier', label: 'Tier', nodeIds: ['a', 'b'] },
    ]);
    for (const id of ['a', 'b']) {
      expect(byId(result, id).parentId).toBe('tier');
      expect(absoluteRect(result, id)).toEqual(absoluteRect(graph, id));
      expect(contains(absoluteRect(result, 'tier'), absoluteRect(result, id))).toBe(true);
    }
    expect(absoluteRect(result, 'c')).toEqual(absoluteRect(graph, 'c'));
    expectParentsFirst(result);
  });

  it('moves children into a section added in place of a removed one with the same id', () => {
    const graph = {
      nodes: [
        section('vpc', 100, 100, 600, 300),
        child('vpc', node('a', 40, 60)),
        child('vpc', node('b', 300, 60)),
      ],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'remove_node', id: 'vpc' },
      { op: 'add_node', id: 'vpc', type: 'section', label: 'VPC' },
      { op: 'update_node', id: 'a', parentId: 'vpc' },
    ]);
    expect(byId(result, 'a').parentId).toBe('vpc');
    expect(byId(result, 'b').parentId).toBeUndefined();
    expect(absoluteRect(result, 'a')).toEqual(absoluteRect(graph, 'a'));
    expect(absoluteRect(result, 'b')).toEqual(absoluteRect(graph, 'b'));
    expect(contains(absoluteRect(result, 'vpc'), absoluteRect(result, 'a'))).toBe(true);
    expectParentsFirst(result);
  });

  it('updates the measured size of a section it grows', () => {
    const graph = {
      nodes: [
        { ...section('vpc', 0, 0, 360, 260), measured: { width: 360, height: 260 } },
        child('vpc', node('a', 40, 60)),
      ],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'c1', type: 'process', label: 'C1', parentId: 'vpc' },
      { op: 'add_node', id: 'c2', type: 'process', label: 'C2', parentId: 'vpc' },
      { op: 'add_edge', source: 'a', target: 'c1' },
      { op: 'add_edge', source: 'c1', target: 'c2' },
    ]);
    const vpc = byId(result, 'vpc');
    expect(vpc.style).not.toEqual({ width: 360, height: 260 });
    expect(vpc.measured).toEqual(vpc.style);
    for (const id of ['a', 'c1', 'c2']) {
      expect(contains(absoluteRect(result, 'vpc'), absoluteRect(result, id))).toBe(true);
    }
  });

  it('grows a section the user resized', () => {
    const graph = {
      nodes: [
        { ...section('vpc', 0, 0, 360, 260), width: 360, height: 260 },
        child('vpc', node('a', 40, 60)),
      ],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'c1', type: 'process', label: 'C1', parentId: 'vpc' },
      { op: 'add_node', id: 'c2', type: 'process', label: 'C2', parentId: 'vpc' },
      { op: 'add_edge', source: 'a', target: 'c1' },
      { op: 'add_edge', source: 'c1', target: 'c2' },
    ]);
    const vpc = byId(result, 'vpc');
    expect(vpc.style).not.toEqual({ width: 360, height: 260 });
    expect({ width: vpc.width, height: vpc.height }).toEqual(vpc.style);
  });

  it('keeps nodes in place when they already sit inside the new section or leave one', () => {
    const graph = {
      nodes: [section('vpc', 0, 0, 800, 400), node('b', 300, 100), child('vpc', node('a', 40, 60))],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'update_node', id: 'b', parentId: 'vpc' },
      { op: 'update_node', id: 'a', parentId: null },
    ]);
    expect(byId(result, 'b')).toMatchObject({ parentId: 'vpc', position: { x: 300, y: 100 } });
    expect(byId(result, 'a').parentId).toBeUndefined();
    expect(byId(result, 'a').position).toEqual({ x: 40, y: 60 });
    expect(byId(result, 'vpc').style).toEqual({ width: 800, height: 400 });
  });
});

describe('applyCanvasEdits placement', () => {
  it('never moves existing nodes and keeps new nodes clear of them', () => {
    const graph = threeNodes();
    const result = editOk(graph, [
      { op: 'add_node', id: 'd', type: 'process', label: 'D' },
      { op: 'add_node', id: 'e', type: 'process', label: 'E' },
      { op: 'add_node', id: 'f', type: 'process', label: 'F' },
      { op: 'add_edge', source: 'b', target: 'd' },
      { op: 'add_edge', source: 'b', target: 'e' },
      { op: 'add_edge', source: 'b', target: 'f' },
    ]);
    for (const original of graph.nodes) {
      expect(byId(result, original.id)).toEqual(original);
    }
    expectNoOverlaps(result, ['a', 'b', 'c', 'd', 'e', 'f']);
    for (const id of ['d', 'e', 'f']) {
      const rect = absoluteRect(result, id);
      expect(Math.abs(rect.x - 300)).toBeLessThan(700);
      expect(Math.abs(rect.y)).toBeLessThan(500);
    }
  });

  it('places a new node after its source and before its target', () => {
    const graph = { nodes: [node('a', 0, 0)], edges: [] };
    const result = editOk(graph, [
      { op: 'add_node', id: 'next', type: 'process', label: 'Next' },
      { op: 'add_node', id: 'prev', type: 'process', label: 'Prev' },
      { op: 'add_edge', source: 'a', target: 'next' },
      { op: 'add_edge', source: 'prev', target: 'a' },
    ]);
    expect(byId(result, 'next').position.x).toBeGreaterThan(0);
    expect(byId(result, 'next').position.y).toBe(0);
    expect(byId(result, 'prev').position.x).toBeLessThan(0);
    expect(byId(result, 'prev').position.y).toBe(0);
  });

  it('follows a vertical canvas downwards', () => {
    const graph = { nodes: [node('a', 0, 0), node('b', 0, 300)], edges: [edge('a', 'b')] };
    const result = editOk(graph, [
      { op: 'add_node', id: 'c', type: 'process', label: 'C' },
      { op: 'add_edge', source: 'b', target: 'c' },
    ]);
    const rect = absoluteRect(result, 'c');
    expect(rect.y).toBeGreaterThan(300);
    expect(rect.x).toBe(0);
  });

  it('puts a node linking two existing nodes between them when there is room', () => {
    const graph = { nodes: [node('a', 0, 0), node('b', 800, 0)], edges: [] };
    const result = editOk(graph, [
      { op: 'add_node', id: 'mid', type: 'process', label: 'Mid' },
      { op: 'add_edge', source: 'a', target: 'mid' },
      { op: 'add_edge', source: 'mid', target: 'b' },
    ]);
    const rect = absoluteRect(result, 'mid');
    expect(rect.x).toBeGreaterThan(150);
    expect(rect.x + rect.width).toBeLessThan(800);
  });

  it('puts unconnected nodes beside the diagram and lays out chains on an empty canvas', () => {
    const result = editOk(threeNodes(), [
      { op: 'add_node', id: 'lonely', type: 'process', label: 'Lonely' },
      { op: 'add_node', id: 'other', type: 'process', label: 'Other' },
    ]);
    expect(absoluteRect(result, 'lonely').x).toBeGreaterThan(600);
    expectNoOverlaps(result, ['a', 'b', 'c', 'lonely', 'other']);

    const fresh = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'one', type: 'start', label: 'One' },
      { op: 'add_node', id: 'two', type: 'process', label: 'Two' },
      { op: 'add_node', id: 'three', type: 'end', label: 'Three' },
      { op: 'add_edge', source: 'one', target: 'two' },
      { op: 'add_edge', source: 'two', target: 'three' },
    ]);
    expect(byId(fresh, 'one').position).toEqual({ x: 0, y: 0 });
    expect(byId(fresh, 'two').position.x).toBeGreaterThan(byId(fresh, 'one').position.x);
    expect(byId(fresh, 'three').position.x).toBeGreaterThan(byId(fresh, 'two').position.x);
    expectNoOverlaps(fresh, ['one', 'two', 'three']);
  });

  it('sizes new sections before placing later nodes, so they keep clear of them', () => {
    const result = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'a', type: 'process', label: 'A' },
      { op: 'add_node', id: 'b', type: 'process', label: 'B' },
      { op: 'add_node', id: 'c', type: 'process', label: 'C' },
      { op: 'group', id: 'tier', label: 'Tier', nodeIds: ['a'] },
    ]);
    const tier = byId(result, 'tier');
    expect(tier.style).toMatchObject({
      width: SECTION_RENDER_MIN_WIDTH,
      height: SECTION_RENDER_MIN_HEIGHT,
    });
    expectNoOverlaps(result, ['tier', 'b', 'c']);
  });

  it('keeps new nodes clear of sections and their titles', () => {
    const graph = {
      nodes: [node('a', 0, 0), section('vpc', 0, 200, 200, 160), child('vpc', node('v', 40, 60))],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'b', type: 'process', label: 'B' },
      { op: 'add_node', id: 'c', type: 'process', label: 'C' },
      { op: 'add_edge', source: 'a', target: 'b' },
      { op: 'add_edge', source: 'a', target: 'c' },
    ]);
    expectNoOverlaps(result, ['a', 'vpc', 'b', 'c']);
  });

  it('keeps new class, entity and journey nodes clear of each other at the size they draw', () => {
    const fields = Array.from({ length: 6 }, (_, index) => ({
      name: `f${index}`,
      dataType: 'TEXT',
    }));
    const entities = editOk({ nodes: [], edges: [] }, [
      ...['users', 'orders', 'items', 'payments'].map((id) => ({
        op: 'add_node',
        id,
        type: 'er_entity',
        label: id,
        data: { erFields: fields },
      })),
      { op: 'add_edge', source: 'users', target: 'orders' },
      { op: 'add_edge', source: 'orders', target: 'items' },
      { op: 'add_edge', source: 'orders', target: 'payments' },
    ]);
    // EntityNode draws at least 220 wide and, with six fields, at least 56 + 6 * 18 + 24 high.
    const entity = (id: string) => ({ ...absoluteRect(entities, id), width: 220, height: 188 });
    const ids = ['users', 'orders', 'items', 'payments'];
    for (const [index, id] of ids.entries()) {
      for (const other of ids.slice(index + 1)) {
        expect(overlaps(entity(id), entity(other)), `${id} / ${other}`).toBe(false);
      }
    }

    const members = editOk({ nodes: [], edges: [] }, [
      {
        op: 'add_node',
        id: 'order',
        type: 'class',
        label: 'Order',
        data: {
          classAttributes: ['+id: string', '+total: number', '+status: string'],
          classMethods: ['+pay()', '+cancel()'],
        },
      },
      { op: 'add_node', id: 'line', type: 'class', label: 'Line' },
      { op: 'add_node', id: 'step', type: 'journey', label: 'Checkout' },
      { op: 'add_node', id: 'next', type: 'journey', label: 'Pay' },
      { op: 'add_edge', source: 'order', target: 'line' },
      { op: 'add_edge', source: 'order', target: 'step' },
      { op: 'add_edge', source: 'step', target: 'next' },
    ]);
    // ClassNode draws at least 220 wide and 76 + (3 * 18 + 16) + (2 * 18 + 16) high, JourneyNode 220 by 120.
    const drawn = {
      order: { width: 220, height: 198 },
      line: { width: 220, height: 140 },
      step: { width: 220, height: 120 },
      next: { width: 220, height: 120 },
    };
    const rects = Object.entries(drawn).map(([id, size]) => ({
      id,
      ...absoluteRect(members, id),
      ...size,
    }));
    for (const [index, rect] of rects.entries()) {
      for (const other of rects.slice(index + 1)) {
        expect(overlaps(rect, other), `${rect.id} / ${other.id}`).toBe(false);
      }
    }
  });

  it('uses measured sizes of existing nodes', () => {
    const graph = {
      nodes: [node('big', 0, 0, { measured: { width: 500, height: 100 } })],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'next', type: 'process', label: 'Next' },
      { op: 'add_edge', source: 'big', target: 'next' },
    ]);
    expect(byId(result, 'next').position.x).toBeGreaterThanOrEqual(500);
  });
});

describe('applyCanvasEdits sequence diagrams', () => {
  const participants = (): CanvasGraph => ({
    nodes: [
      node('alice', 0, 0, {
        type: 'sequence_participant',
        data: { label: 'Alice', seqParticipantKind: 'participant' },
      }),
      node('bob', 250, 0, {
        type: 'sequence_participant',
        data: { label: 'Bob', seqParticipantKind: 'participant' },
      }),
    ],
    edges: [
      edge('alice', 'bob', {
        id: 'm0',
        type: 'sequence_message',
        label: 'hi',
        data: { seqMessageKind: 'sync', seqMessageOrder: 0 },
      }),
      edge('bob', 'alice', {
        id: 'm1',
        type: 'sequence_message',
        label: 'hey',
        data: { seqMessageKind: 'return', seqMessageOrder: 1 },
      }),
    ],
  });

  it('adds participants to the row past anything in the way', () => {
    const graph = participants();
    graph.nodes.push(node('box', 500, 0));
    const result = editOk(graph, [
      { op: 'add_node', id: 'carol', type: 'sequence_participant', label: 'Carol' },
    ]);
    expect(byId(result, 'carol').position.y).toBe(0);
    expect(byId(result, 'carol').position.x).toBeGreaterThan(500);
    expectNoOverlaps(result, ['alice', 'bob', 'box', 'carol']);
  });

  it('adds participants in a row and messages after the last one', () => {
    const result = editOk(participants(), [
      {
        op: 'add_node',
        id: 'carol',
        type: 'sequence_participant',
        label: 'Carol',
        data: { seqParticipantKind: 'actor' },
      },
      {
        op: 'add_edge',
        id: 'm2',
        source: 'bob',
        target: 'carol',
        label: 'ask',
        data: { seqMessageKind: 'async' },
      },
    ]);
    expect(byId(result, 'carol').position.y).toBe(0);
    expect(byId(result, 'carol').position.x).toBeGreaterThan(250);
    expect(edgeById(result, 'm2')).toMatchObject({
      type: 'sequence_message',
      label: 'ask',
      data: {
        seqMessageKind: 'async',
        seqMessageOrder: 2,
        targetIsActor: true,
        sourceIsActor: false,
      },
    });
  });

  it('inserts a message at an order and shifts the later ones', () => {
    const result = editOk(participants(), [
      { op: 'add_edge', id: 'm-new', source: 'alice', target: 'bob', data: { seqMessageOrder: 1 } },
    ]);
    expect(edgeById(result, 'm-new')).toMatchObject({
      label: 'Message',
      data: { seqMessageOrder: 1 },
    });
    expect(edgeById(result, 'm0').data.seqMessageOrder).toBe(0);
    expect(edgeById(result, 'm1').data.seqMessageOrder).toBe(2);

    const moved = editOk(participants(), [
      { op: 'update_edge', id: 'm1', data: { seqMessageOrder: 0 } },
    ]);
    expect(edgeById(moved, 'm1').data.seqMessageOrder).toBe(0);
    expect(edgeById(moved, 'm0').data.seqMessageOrder).toBe(1);

    const clamped = editOk(participants(), [
      {
        op: 'add_edge',
        id: 'm-last',
        source: 'bob',
        target: 'alice',
        data: { seqMessageOrder: 99 },
      },
    ]);
    expect(edgeById(clamped, 'm-last').data.seqMessageOrder).toBe(2);
    expect(edgeById(clamped, 'm1').data.seqMessageOrder).toBe(1);
  });

  it('moves a message later in the list', () => {
    const graph = participants();
    graph.edges.push(
      edge('alice', 'bob', {
        id: 'm2',
        type: 'sequence_message',
        data: { seqMessageKind: 'sync', seqMessageOrder: 2 },
      })
    );
    const orders = (result: CanvasGraph) =>
      Object.fromEntries(result.edges.map((e) => [e.id, e.data.seqMessageOrder]));
    const move = (order: number) =>
      orders(editOk(graph, [{ op: 'update_edge', id: 'm0', data: { seqMessageOrder: order } }]));

    expect(move(1)).toEqual({ m1: 0, m0: 1, m2: 2 });
    expect(move(2)).toEqual({ m1: 0, m2: 1, m0: 2 });
    expect(move(99)).toEqual({ m1: 0, m2: 1, m0: 2 });
    expect(move(0)).toEqual({ m0: 0, m1: 1, m2: 2 });
    expect(
      orders(editOk(graph, [{ op: 'update_edge', id: 'm2', data: { seqMessageOrder: 0 } }]))
    ).toEqual({ m2: 0, m0: 1, m1: 2 });
  });

  it('keeps notes, fragments and activations before the same messages', () => {
    // Timeline: m0, note, activate alice, m1, fragment, m2, deactivate alice.
    const graph = participants();
    graph.nodes[0] = {
      ...graph.nodes[0],
      data: {
        ...graph.nodes[0].data,
        seqActivations: [
          { order: 1, activate: true },
          { order: 3, activate: false },
        ],
      },
    };
    graph.nodes.push(
      node('note', 100, 100, {
        type: 'sequence_note',
        data: { label: 'Note', seqNoteTarget: 'alice', seqMessageOrder: 1 },
      }),
      node('frag', -200, 200, {
        type: 'annotation',
        data: { label: 'LOOP', seqFragmentId: 'frag', seqMessageOrder: 2 },
      })
    );
    graph.edges.push(
      edge('alice', 'bob', {
        id: 'm2',
        type: 'sequence_message',
        data: { seqMessageKind: 'sync', seqMessageOrder: 2 },
      })
    );
    const timeline = (result: CanvasGraph) => ({
      m0: edgeById(result, 'm0').data.seqMessageOrder,
      m1: edgeById(result, 'm1').data.seqMessageOrder,
      m2: edgeById(result, 'm2').data.seqMessageOrder,
      note: byId(result, 'note').data.seqMessageOrder,
      frag: byId(result, 'frag').data.seqMessageOrder,
      activations: byId(result, 'alice').data.seqActivations.map((a) => a.order),
    });

    const moved = editOk(graph, [{ op: 'update_edge', id: 'm0', data: { seqMessageOrder: 1 } }]);
    expect(timeline(moved)).toEqual({
      m1: 0,
      note: 0,
      m0: 1,
      frag: 2,
      m2: 2,
      activations: [0, 3],
    });

    const inserted = editOk(graph, [
      { op: 'add_edge', id: 'm-new', source: 'bob', target: 'alice', data: { seqMessageOrder: 1 } },
    ]);
    expect(edgeById(inserted, 'm-new').data.seqMessageOrder).toBe(1);
    expect(timeline(inserted)).toEqual({
      m0: 0,
      note: 2,
      m1: 2,
      frag: 3,
      m2: 3,
      activations: [2, 4],
    });
  });

  it('refreshes actor flags when a participant kind changes', () => {
    const result = editOk(participants(), [
      { op: 'update_node', id: 'alice', data: { seqParticipantKind: 'actor' } },
    ]);
    expect(edgeById(result, 'm0').data).toMatchObject({
      sourceIsActor: true,
      targetIsActor: false,
    });
    expect(edgeById(result, 'm1').data).toMatchObject({
      sourceIsActor: false,
      targetIsActor: true,
    });
  });

  it('rejects message fields on ordinary edges', () => {
    expect(
      editError(threeNodes(), [
        { op: 'add_edge', source: 'a', target: 'c', data: { seqMessageKind: 'async' } },
      ])
    ).toContain(
      'seqMessageKind and seqMessageOrder only apply to edges between sequence_participant nodes'
    );
  });
});

describe('applyCanvasEdits mindmaps', () => {
  it('builds branches from the edges between mindmap topics', () => {
    const result = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'root', type: 'mindmap', label: 'Product' },
      { op: 'add_node', id: 'ideas', type: 'mindmap', label: 'Ideas' },
      { op: 'add_node', id: 'ai', type: 'mindmap', label: 'AI' },
      { op: 'add_edge', source: 'root', target: 'ideas' },
      { op: 'add_edge', source: 'ideas', target: 'ai' },
    ]);
    expect(byId(result, 'root').data).toMatchObject({ mindmapDepth: 0 });
    expect(byId(result, 'root').data.mindmapParentId).toBeUndefined();
    expect(byId(result, 'ideas').data).toMatchObject({
      mindmapDepth: 1,
      mindmapParentId: 'root',
      mindmapSide: 'right',
      mindmapBranchStyle: 'curved',
    });
    expect(byId(result, 'ai').data).toMatchObject({
      mindmapDepth: 2,
      mindmapParentId: 'ideas',
      mindmapSide: 'right',
    });
    expect(edgeById(result, 'e-root-ideas')).toMatchObject({
      type: 'bezier',
      data: { mindmapBranchKind: 'root' },
    });
    expect(edgeById(result, 'e-ideas-ai').data.mindmapBranchKind).toBe('branch');
  });

  it('hangs new topics off existing ones', () => {
    const graph = {
      nodes: [
        node('root', 0, 0, {
          type: 'mindmap',
          data: { label: 'Root', mindmapDepth: 0, mindmapBranchStyle: 'straight' },
        }),
        node('left', -300, 0, {
          type: 'mindmap',
          data: { label: 'Left', mindmapDepth: 1, mindmapParentId: 'root', mindmapSide: 'left' },
        }),
      ],
      edges: [edge('root', 'left')],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'leaf', type: 'mindmap', label: 'Leaf' },
      { op: 'add_edge', source: 'left', target: 'leaf' },
    ]);
    expect(byId(result, 'leaf').data).toMatchObject({
      mindmapDepth: 2,
      mindmapParentId: 'left',
      mindmapSide: 'left',
      mindmapBranchStyle: 'straight',
    });
    expect(edgeById(result, 'e-left-leaf').type).toBe('straight');
  });

  const leftBranch = (): CanvasGraph => ({
    nodes: [
      node('root', 0, 0, { type: 'mindmap', data: { label: 'Root', mindmapDepth: 0 } }),
      node('a', -300, 0, {
        type: 'mindmap',
        data: { label: 'A', mindmapDepth: 1, mindmapParentId: 'root', mindmapSide: 'left' },
      }),
      node('b', -560, 0, {
        type: 'mindmap',
        data: { label: 'B', mindmapDepth: 2, mindmapParentId: 'a', mindmapSide: 'left' },
      }),
    ],
    edges: [edge('root', 'a'), edge('a', 'b')],
  });

  it('places new topics on a left branch to the left of their parent', () => {
    const result = editOk(leftBranch(), [
      { op: 'add_node', id: 'c', type: 'mindmap', label: 'C' },
      { op: 'add_edge', source: 'b', target: 'c' },
      { op: 'add_node', id: 'd', type: 'mindmap', label: 'D' },
      { op: 'add_edge', source: 'a', target: 'd' },
    ]);
    for (const [id, parentId] of [
      ['c', 'b'],
      ['d', 'a'],
    ]) {
      const rect = absoluteRect(result, id);
      expect(rect.x + rect.width, id).toBeLessThan(absoluteRect(result, parentId).x);
      expect(byId(result, id).data.mindmapSide).toBe('left');
      expect(edgeById(result, `e-${parentId}-${id}`)).toMatchObject({
        sourceHandle: 'left',
        targetHandle: 'right',
      });
    }
    expectNoOverlaps(result, ['root', 'a', 'b', 'c', 'd']);
  });

  it('keeps a new branch on the side of the new topic it hangs off', () => {
    const result = editOk(leftBranch(), [
      { op: 'add_node', id: 'p', type: 'mindmap', label: 'P' },
      { op: 'add_edge', source: 'a', target: 'p' },
      { op: 'add_node', id: 'q', type: 'mindmap', label: 'Q' },
      { op: 'add_edge', source: 'p', target: 'q' },
    ]);
    const q = absoluteRect(result, 'q');
    expect(q.x + q.width).toBeLessThan(absoluteRect(result, 'p').x);
    expect(byId(result, 'q').data).toMatchObject({ mindmapParentId: 'p', mindmapSide: 'left' });
  });

  it('places a new topic of a tall mindmap beside its root, not below it', () => {
    const topics = Array.from({ length: 10 }, (_, index) =>
      node(`t${index}`, 300, index * 60, {
        type: 'mindmap',
        data: {
          label: `T${index}`,
          mindmapDepth: 1,
          mindmapParentId: 'root',
          mindmapSide: 'right',
        },
      })
    );
    const graph = {
      nodes: [
        node('root', 0, 250, { type: 'mindmap', data: { label: 'Root', mindmapDepth: 0 } }),
        ...topics,
      ],
      edges: topics.map((topic) => edge('root', topic.id)),
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'n', type: 'mindmap', label: 'N' },
      { op: 'add_edge', source: 'root', target: 'n' },
    ]);
    const root = absoluteRect(result, 'root');
    expect(absoluteRect(result, 'n').x).toBeGreaterThan(root.x + root.width);
    expect(byId(result, 'n').data.mindmapSide).toBe('right');
    expect(edgeById(result, 'e-root-n')).toMatchObject({
      sourceHandle: 'right',
      targetHandle: 'left',
    });
    expectNoOverlaps(result, ['root', 'n', ...topics.map((topic) => topic.id)]);
  });

  it('hangs topics added in an earlier call once a later call links them', () => {
    const topics = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'root', type: 'mindmap', label: 'Product' },
      { op: 'add_node', id: 'ideas', type: 'mindmap', label: 'Ideas' },
    ]);
    const result = editOk(topics, [{ op: 'add_edge', source: 'root', target: 'ideas' }]);
    expect(byId(result, 'ideas').data).toMatchObject({
      mindmapDepth: 1,
      mindmapParentId: 'root',
      mindmapSide: expect.stringMatching(/^(left|right)$/),
    });
    expect(edgeById(result, 'e-root-ideas').data.mindmapBranchKind).toBe('root');
  });

  it('picks the side from canvas positions when the root sits in a section', () => {
    const topic = (id: string, x: number) =>
      node(id, x, 100, { type: 'mindmap', data: { label: id, mindmapDepth: 0 } });
    const graph = {
      nodes: [section('area', 1000, 0, 400, 300), child('area', topic('root', 100)), topic('west', 600), topic('east', 1600)],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_edge', source: 'root', target: 'west' },
      { op: 'add_edge', source: 'root', target: 'east' },
    ]);
    expect(byId(result, 'west').data).toMatchObject({ mindmapParentId: 'root', mindmapSide: 'left' });
    expect(byId(result, 'east').data).toMatchObject({ mindmapParentId: 'root', mindmapSide: 'right' });
  });

  const branch = (): CanvasGraph => ({
    nodes: [
      node('root', 0, 0, { type: 'mindmap', data: { label: 'Root', mindmapDepth: 0 } }),
      node('x', 300, 0, {
        type: 'mindmap',
        data: { label: 'X', mindmapDepth: 1, mindmapParentId: 'root', mindmapSide: 'right' },
      }),
      node('y', 300, 200, {
        type: 'mindmap',
        data: { label: 'Y', mindmapDepth: 1, mindmapParentId: 'root', mindmapSide: 'right' },
      }),
      node('leaf', 600, 0, {
        type: 'mindmap',
        data: { label: 'Leaf', mindmapDepth: 2, mindmapParentId: 'x', mindmapSide: 'right' },
      }),
    ],
    edges: [edge('root', 'x'), edge('root', 'y'), edge('x', 'leaf')],
  });

  it('moves a re-linked topic and its branch under the new parent', () => {
    const result = editOk(branch(), [
      { op: 'remove_edge', id: 'e-root-x' },
      { op: 'add_edge', source: 'y', target: 'x' },
    ]);
    expect(byId(result, 'x').data).toMatchObject({ mindmapDepth: 2, mindmapParentId: 'y', mindmapSide: 'right' });
    expect(byId(result, 'leaf').data).toMatchObject({ mindmapDepth: 3, mindmapParentId: 'x' });
    expect(edgeById(result, 'e-y-x').data.mindmapBranchKind).toBe('branch');
  });

  it('makes a topic whose parent edge was removed a root', () => {
    const result = editOk(branch(), [{ op: 'remove_edge', id: 'e-root-x' }]);
    expect(byId(result, 'x').data.mindmapDepth).toBe(0);
    expect(byId(result, 'x').data.mindmapParentId).toBeUndefined();
    expect(byId(result, 'x').data.mindmapSide).toBeUndefined();
    expect(byId(result, 'leaf').data).toMatchObject({ mindmapDepth: 1, mindmapParentId: 'x' });
    expect(edgeById(result, 'e-x-leaf').data.mindmapBranchKind).toBe('root');
    expect(byId(result, 'y').data).toMatchObject({ mindmapDepth: 1, mindmapParentId: 'root' });
  });
});

describe('applyCanvasEdits mindmap edge cases', () => {
  const collapsed = (): CanvasGraph => ({
    nodes: [
      node('root', 0, 0, { type: 'mindmap', data: { label: 'Root', mindmapDepth: 0, mindmapCollapsed: true } }),
      node('c1', 300, 0, {
        type: 'mindmap',
        hidden: true,
        data: { label: 'C1', mindmapDepth: 1, mindmapParentId: 'root', mindmapSide: 'right' },
      }),
    ],
    edges: [edge('root', 'c1', { hidden: true })],
  });

  it('hides a topic added under a collapsed topic, like its siblings', () => {
    const result = editOk(collapsed(), [
      { op: 'add_node', id: 'c2', type: 'mindmap', label: 'C2' },
      { op: 'add_edge', source: 'root', target: 'c2' },
    ]);
    expect(byId(result, 'c2').hidden).toBe(true);
    expect(edgeById(result, 'e-root-c2').hidden).toBe(true);
    expect(byId(result, 'c1').hidden).toBe(true);
    expect(byId(result, 'root').hidden).toBe(false);
  });

  it('shows topics again once nothing collapsed hangs above them', () => {
    for (const ops of [[{ op: 'remove_node', id: 'root' }], [{ op: 'remove_edge', id: 'e-root-c1' }]]) {
      const result = editOk(collapsed(), ops);
      expect(byId(result, 'c1')).toMatchObject({ hidden: false, data: { mindmapDepth: 0 } });
    }
  });

  it('leaves visibility alone when no mindmap topic changes', () => {
    const graph = collapsed();
    const result = editOk(graph, [{ op: 'update_node', id: 'c1', label: 'Renamed' }]);
    expect(byId(result, 'root')).toBe(graph.nodes[0]);
    expect(result.edges[0]).toBe(graph.edges[0]);
  });

  it('never links topics in a loop', () => {
    const result = editOk({ nodes: [], edges: [] }, [
      { op: 'add_node', id: 'x', type: 'mindmap', label: 'X' },
      { op: 'add_node', id: 'y', type: 'mindmap', label: 'Y' },
      { op: 'add_edge', source: 'x', target: 'y' },
      { op: 'add_edge', source: 'y', target: 'x' },
    ]);
    const parents = result.nodes.map((n) => n.data.mindmapParentId).filter(Boolean);
    expect(parents).toHaveLength(1);
    expect(result.nodes.filter((n) => n.data.mindmapDepth === 0)).toHaveLength(1);
  });

  it('carries the root branch style down several new levels', () => {
    const graph = {
      nodes: [
        node('root', 0, 0, {
          type: 'mindmap',
          data: { label: 'Root', mindmapDepth: 0, mindmapBranchStyle: 'straight' },
        }),
      ],
      edges: [],
    };
    const result = editOk(graph, [
      { op: 'add_node', id: 'ideas', type: 'mindmap', label: 'Ideas' },
      { op: 'add_node', id: 'ai', type: 'mindmap', label: 'AI' },
      { op: 'add_edge', source: 'root', target: 'ideas' },
      { op: 'add_edge', source: 'ideas', target: 'ai' },
    ]);
    expect(byId(result, 'ideas').data.mindmapBranchStyle).toBe('straight');
    expect(byId(result, 'ai').data).toMatchObject({
      mindmapDepth: 2,
      mindmapParentId: 'ideas',
      mindmapBranchStyle: 'straight',
    });
  });
});

describe('applyCanvasEdits relations', () => {
  const classes = (): CanvasGraph => ({
    nodes: [
      node('user', 0, 0, { type: 'class', data: { label: 'User' } }),
      node('order', 400, 0, { type: 'class', data: { label: 'Order' } }),
    ],
    edges: [],
  });

  it('keeps relation labels where the edge panel keeps them', () => {
    const result = editOk(classes(), [
      {
        op: 'add_edge',
        id: 'owns',
        source: 'user',
        target: 'order',
        label: 'places',
        data: { classRelation: '-->' },
      },
      { op: 'add_edge', id: 'plain', source: 'order', target: 'user', label: ' ' },
    ]);
    expect(edgeById(result, 'owns')).toMatchObject({
      label: undefined,
      data: { classRelation: '-->', classRelationLabel: 'places' },
    });
    expect(edgeById(result, 'plain').label).toBeUndefined();

    const relabelled = editOk(result, [{ op: 'update_edge', id: 'owns', label: 'has' }]);
    expect(edgeById(relabelled, 'owns').data.classRelationLabel).toBe('has');
  });

  it('moves an existing label into the relation label when a relation is set', () => {
    const graph = { ...classes(), edges: [edge('user', 'order', { label: 'uses' })] };
    const result = editOk(graph, [
      {
        op: 'update_edge',
        id: 'e-user-order',
        data: { classRelation: '..>', dashPattern: 'dashed' },
      },
    ]);
    expect(edgeById(result, 'e-user-order')).toMatchObject({
      label: undefined,
      data: { classRelation: '..>', classRelationLabel: 'uses', dashPattern: 'dashed' },
    });
  });

  it('only allows relations between matching node families', () => {
    expect(
      editError(classes(), [
        { op: 'add_edge', source: 'user', target: 'order', data: { erRelation: '||--o{' } },
      ])
    ).toContain('erRelation only applies to edges between er_entity nodes');
    expect(
      editError(threeNodes(), [
        { op: 'add_edge', source: 'a', target: 'c', data: { classRelation: '-->' } },
      ])
    ).toContain('classRelation only applies to edges between class nodes');
  });
});

describe('applyCanvasEdits destructive changes', () => {
  const fiveNodes = (): CanvasGraph => ({
    nodes: ['a', 'b', 'c', 'd', 'e'].map((id, index) => node(id, index * 300, 0)),
    edges: [],
  });
  const remove = (...ids: string[]) => ids.map((id) => ({ op: 'remove_node', id }));

  it('asks for confirmation once enough start-of-turn nodes go', () => {
    expect(DESTRUCTIVE_REMOVAL_THRESHOLD).toBe(3);
    const two = editOk(fiveNodes(), remove('a', 'b'));
    expect(two.destructive).toEqual({
      removedNodes: [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
      ],
      removedStartNodeIds: ['a', 'b'],
      clearsCanvas: false,
      needsConfirmation: false,
    });
    expect(editOk(fiveNodes(), remove('a', 'b', 'c')).destructive.needsConfirmation).toBe(true);
  });

  it('counts removals across the batches of a turn', () => {
    const graph = fiveNodes();
    const startNodeIds = new Set([...graph.nodes.map((n) => n.id), 'x', 'y']);
    const result = editOk(graph, remove('c'), { startNodeIds, removedStartNodeIds: ['x', 'y'] });
    expect(result.destructive).toMatchObject({
      removedStartNodeIds: ['x', 'y', 'c'],
      needsConfirmation: true,
    });
    const additive = editOk(graph, [{ op: 'add_node', id: 'f', type: 'process', label: 'F' }], {
      startNodeIds,
      removedStartNodeIds: ['x', 'y', 'z'],
    });
    expect(additive.destructive.needsConfirmation).toBe(false);
  });

  it('ignores nodes the agent added earlier in the turn', () => {
    const graph = fiveNodes();
    const result = editOk(graph, remove('c', 'd', 'e'), { startNodeIds: new Set(['a', 'b']) });
    expect(result.destructive).toMatchObject({ removedNodes: [], needsConfirmation: false });
    expect(result.summary).toBe('Removed 3 nodes.');
  });

  it('always asks before clearing the canvas', () => {
    const result = editOk({ nodes: [node('a', 0, 0)], edges: [] }, remove('a'));
    expect(result.nodes).toEqual([]);
    expect(result.destructive).toMatchObject({ clearsCanvas: true, needsConfirmation: true });
  });

  it('asks before the last start-of-turn node goes, even with new nodes on the canvas', () => {
    const graph = { nodes: [node('a', 0, 0), node('b', 300, 0)], edges: [] };
    const replaced = editOk(graph, [
      { op: 'add_node', id: 'c', type: 'process', label: 'C' },
      ...remove('a', 'b'),
    ]);
    expect(replaced.nodes.map((n) => n.id)).toEqual(['c']);
    expect(replaced.destructive).toMatchObject({ clearsCanvas: true, needsConfirmation: true });

    // The same replacement spread over two batches.
    const later = editOk(
      { nodes: [node('b', 300, 0), node('c', 600, 0)], edges: [] },
      remove('b'),
      { startNodeIds: new Set(['a', 'b']), removedStartNodeIds: ['a'] }
    );
    expect(later.destructive).toMatchObject({ clearsCanvas: true, needsConfirmation: true });
    expect(editOk(graph, remove('a')).destructive.needsConfirmation).toBe(false);
  });
});

describe('applyCanvasEdits summary', () => {
  it('summarises every kind of change', () => {
    const result = editOk(threeNodes(), [
      { op: 'add_node', id: 'd', type: 'process', label: 'D' },
      { op: 'add_node', id: 'e', type: 'process', label: 'E' },
      { op: 'add_edge', source: 'c', target: 'd' },
      { op: 'update_node', id: 'a', label: 'Start' },
      { op: 'update_edge', id: 'e-a-b', label: 'go' },
      { op: 'remove_edge', id: 'e-b-c' },
    ]);
    expect(result.summary).toBe(
      'Added 2 nodes and 1 edge; updated 1 node and 1 edge; removed 1 edge.'
    );
  });
});

describe('tidyNodes', () => {
  // Added in earlier batches before their edges existed, so they were parked far away.
  const parked = (): CanvasGraph => ({
    nodes: [
      node('a', 0, 0),
      node('b', 300, 0),
      node('x', 5000, 5000),
      node('y', 9000, 0),
      section('s', 0, 400, 400, 300),
      child('s', node('c', 5000, 5000)),
      node('m', 7000, 7000, { type: 'mindmap' }),
    ],
    edges: [edge('a', 'x'), edge('x', 'y')],
  });

  it('places the given nodes again next to their connections', () => {
    const graph = parked();
    const result = tidyNodes(graph, ['y', 'x', 'missing']);

    expect(byId(result, 'a').position).toEqual({ x: 0, y: 0 });
    expect(byId(result, 'b').position).toEqual({ x: 300, y: 0 });
    const a = absoluteRect(result, 'a');
    const x = absoluteRect(result, 'x');
    const y = absoluteRect(result, 'y');
    expect(Math.hypot(x.x - a.x, x.y - a.y)).toBeLessThan(400);
    expect(Math.hypot(y.x - x.x, y.y - x.y)).toBeLessThan(400);
    expectNoOverlaps(result, ['a', 'b', 'x', 'y', 's']);
    expect(result.nodes).toHaveLength(graph.nodes.length);
    expect(result.edges).toBe(graph.edges);
  });

  it('keeps sections with children and fixed node types where they are', () => {
    const graph = parked();
    const result = tidyNodes(graph, ['s', 'c', 'm']);

    expect(byId(result, 's')).toEqual(byId(graph, 's'));
    expect(byId(result, 'm')).toEqual(byId(graph, 'm'));
    expect(contains(drawnRect(result, 's'), absoluteRect(result, 'c'))).toBe(true);
    expectParentsFirst(result);
  });
});
