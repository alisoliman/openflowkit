import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { composeDiagramForDisplay } from '@/services/composeDiagramForDisplay';
import { clearLayoutCache } from '@/services/elkLayout';
import { getFlowTemplates } from '@/services/templates';
import { useFlowStore } from '@/store';
import { INITIAL_GLOBAL_EDGE_OPTIONS } from '@/store/defaults';
import type { CanvasEditDestructiveInfo } from './canvasOps';
import { canUndoAgentTurn, createAgentTurnExecutor, undoAgentTurn } from './executor';

vi.mock('@/services/composeDiagramForDisplay', () => ({ composeDiagramForDisplay: vi.fn() }));
vi.mock('@/services/elkLayout', () => ({ clearLayoutCache: vi.fn() }));
vi.mock('./canvasCapture', () => ({ captureCanvasRegion: vi.fn() }));

const TURN = { turnId: 'turn-1', pageId: 'tab-1' };
const WORKSPACE_RULES_KEY = 'openflowkit:workspace-lint-rules';

function node(id: string, x: number, y: number, extra: Partial<FlowNode> = {}): FlowNode {
  return {
    id,
    type: 'process',
    position: { x, y },
    data: { label: id.toUpperCase(), color: 'white', shape: 'rounded' },
    ...extra,
  };
}

function edge(source: string, target: string, extra: Partial<FlowEdge> = {}): FlowEdge {
  return { id: `e-${source}-${target}`, source, target, ...extra };
}

function setCanvas(nodes: FlowNode[], edges: FlowEdge[] = []): void {
  useFlowStore.setState((state) => ({
    nodes,
    edges,
    tabs: [
      {
        id: 'tab-1',
        name: 'Checkout',
        diagramType: 'architecture',
        nodes,
        edges,
        history: { past: [], future: [] },
      },
    ],
    activeTabId: 'tab-1',
    agentTurn: TURN,
    viewSettings: { ...state.viewSettings, lintRules: '', smartRoutingEnabled: true },
  }));
}

function createExecutor(confirmRemoval = vi.fn(async () => true), endingReason = (): string | undefined => undefined) {
  return createAgentTurnExecutor({ turn: TURN, confirmRemoval, endingReason });
}

function storeNode(id: string): FlowNode | undefined {
  return useFlowStore.getState().nodes.find((candidate) => candidate.id === id);
}

function historyLength(): number {
  return useFlowStore.getState().tabs[0].history.past.length;
}

function renameNode(id: string, label: string): void {
  useFlowStore
    .getState()
    .setNodes((nodes) =>
      nodes.map((candidate) =>
        candidate.id === id ? { ...candidate, data: { ...candidate.data, label } } : candidate
      )
    );
}

const addDatabase = {
  ops: [
    { op: 'add_node', id: 'db', type: 'process', label: 'Orders DB' },
    { op: 'add_edge', source: 'api', target: 'db', label: 'writes' },
  ],
};

beforeEach(() => {
  localStorage.removeItem(WORKSPACE_RULES_KEY);
  setCanvas(
    [
      node('api', 0, 0, { selected: true }),
      node('web', 300, 0),
      { ...node('zone', 0, 300), type: 'section', style: { width: 400, height: 300 } },
      node('worker', 40, 60, { parentId: 'zone' }),
    ],
    [edge('web', 'api', { label: 'calls', style: { strokeDasharray: '8 4' }, data: { dashPattern: 'dashed' } })]
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.mocked(composeDiagramForDisplay).mockReset();
  vi.mocked(clearLayoutCache).mockClear();
});

describe('agent executor get_canvas', () => {
  it('summarises the page with ids, types, labels, sections, absolute bounds, the selection and the layout', async () => {
    const result = await createExecutor().execute('get_canvas', {});
    const box = (x: number, y: number, width = 120, height = 60) => ({
      position: { x, y },
      size: { width, height },
    });

    expect(result).toEqual({
      ok: true,
      result: {
        page: 'Checkout',
        nodeCount: 4,
        edgeCount: 1,
        nodes: [
          { id: 'api', type: 'process', label: 'API', color: 'white', ...box(0, 0) },
          { id: 'web', type: 'process', label: 'WEB', color: 'white', ...box(300, 0) },
          { id: 'zone', type: 'section', label: 'ZONE', color: 'white', ...box(0, 300, 400, 300) },
          { id: 'worker', type: 'process', label: 'WORKER', color: 'white', parentId: 'zone', ...box(40, 360) },
        ],
        edges: [{ id: 'e-web-api', source: 'web', target: 'api', label: 'calls', style: { arrowheads: 'none', dashPattern: 'dashed' } }],
        selectedIds: ['api'],
        layout: { flow: 'right to left', bounds: box(0, 0, 420, 600), issues: [] },
        style: expect.objectContaining({ appearance: 'light' }),
      },
    });
  });

  it('adds node data and absolute bounds in full detail, limited to the requested nodes', async () => {
    const result = await createExecutor().execute('get_canvas', {
      detail: 'full',
      nodeIds: ['worker', 'web', 'api', 'ghost'],
    });
    if (result.ok === false) throw new Error(result.error);

    const nodes = result.result.nodes as Array<Record<string, unknown>>;
    expect(nodes.map((entry) => entry.id)).toEqual(['api', 'web', 'worker']);
    expect(nodes[2]).toMatchObject({
      style: { color: 'white', shape: 'rounded' },
      position: { x: 40, y: 360 },
      size: { width: expect.any(Number), height: expect.any(Number) },
    });
    expect(result.result.edges).toEqual([
      {
        id: 'e-web-api',
        source: 'web',
        target: 'api',
        label: 'calls',
        style: {
          color: 'default',
          arrowheads: 'none',
          arrowStyle: 'filled',
          path: 'default',
          width: 2,
          dashPattern: 'dashed',
          animated: false,
          labelPosition: 0.5,
          sourceSide: 'auto',
          targetSide: 'auto',
        },
      },
    ]);
    expect(result.result.notFound).toEqual(['ghost']);
  });

  it('truncates large canvases with a note but keeps the whole selection', async () => {
    const nodes = Array.from({ length: 200 }, (_, index) =>
      node(`n${index}`, index * 200, 0, {
        data: { label: `${index} ${'x'.repeat(480)}` },
      })
    );
    nodes[199].selected = true;
    setCanvas(nodes);

    const result = await createExecutor().execute('get_canvas', {});
    if (result.ok === false) throw new Error(result.error);

    const shown = result.result.nodes as unknown[];
    expect(result.result.nodeCount).toBe(200);
    expect(shown.length).toBeGreaterThan(0);
    expect(shown.length).toBeLessThan(200);
    expect(JSON.stringify(shown).length).toBeLessThanOrEqual(40_000);
    expect(result.result.note).toBe(
      `Truncated: showing ${shown.length} of 200 nodes and 0 of 0 edges. Pass nodeIds to read the others.`
    );
    expect(result.result.selectedIds).toEqual(['n199']);
  });

  it('clips long text so one node cannot crowd the others out', async () => {
    const wall = 'x'.repeat(45_000);
    const clipped = `${'x'.repeat(2_000)}…`;
    setCanvas([
      node('api', 0, 0, { data: { label: wall, subLabel: wall, color: 'white' } }),
      node('web', 300, 0),
    ]);

    const summary = await createExecutor().execute('get_canvas', {});
    const requested = await createExecutor().execute('get_canvas', {
      detail: 'full',
      nodeIds: ['api'],
    });
    if (summary.ok === false) throw new Error(summary.error);
    if (requested.ok === false) throw new Error(requested.error);

    expect(summary.result.nodes).toEqual([
      expect.objectContaining({ id: 'api', type: 'process', label: clipped }),
      expect.objectContaining({ id: 'web', type: 'process', label: 'WEB' }),
    ]);
    expect(summary.result.note).toBeUndefined();
    expect(requested.result.nodes).toEqual([
      expect.objectContaining({
        id: 'api',
        label: clipped,
        style: { color: 'white' },
        data: { subLabel: clipped },
      }),
    ]);
  });
});

describe('agent executor edit_canvas', () => {
  it('commits a batch to the page and records one history entry for the whole turn', async () => {
    const executor = createExecutor();
    const first = await executor.execute('edit_canvas', addDatabase);
    const second = await executor.execute('edit_canvas', {
      ops: [{ op: 'update_node', id: 'web', label: 'Storefront' }],
    });

    expect(first).toMatchObject({ ok: true, result: { idMap: {} } });
    expect(second.ok).toBe(true);
    const state = useFlowStore.getState();
    expect(storeNode('db')?.data.label).toBe('Orders DB');
    expect(storeNode('web')?.data.label).toBe('Storefront');
    expect(state.edges.some((candidate) => candidate.target === 'db')).toBe(true);
    expect(state.tabs[0].nodes).toBe(state.nodes);
    expect(state.tabs[0].edges).toBe(state.edges);
    expect(historyLength()).toBe(1);
    expect(state.tabs[0].history.past[0].nodes).toBe(executor.startGraph.nodes);
  });

  it('says where the nodes it moved landed, the layout issues around them, and turns their edges', async () => {
    const result = await createExecutor().execute('edit_canvas', {
      ops: [{ op: 'move_node', id: 'web', position: { x: 60, y: 20 } }],
    });

    expect(result).toEqual({
      ok: true,
      result: {
        summary: 'Moved 1 node.',
        idMap: {},
        placed: [{ id: 'web', position: { x: 60, y: 20 }, size: { width: 120, height: 60 } }],
        layout: {
          issues: [
            '"api" and "web" overlap by 60 px x 40 px.',
            '"web" and "api" are 20 px out of line; for a straight edge, move "web" to y = 0 (or the other node to match).',
          ],
        },
      },
    });
    expect(useFlowStore.getState().edges[0]).toMatchObject({ sourceHandle: 'left', targetHandle: 'right' });
  });

  it('places nodes again at the size the canvas measures, except those a move placed', async () => {
    setCanvas([node('api', 0, 0)]);
    const renderer = document.createElement('div');
    renderer.className = 'react-flow__renderer';
    document.body.append(renderer);
    try {
      const pending = createExecutor().execute('edit_canvas', {
        ops: [
          { op: 'add_node', id: 'db', type: 'process', label: 'DB' },
          { op: 'add_edge', source: 'api', target: 'db' },
          { op: 'add_node', id: 'note', type: 'process', label: 'Note' },
          { op: 'move_node', id: 'note', position: { x: 0, y: 400 } },
        ],
      });
      // What React Flow does once it has drawn the new nodes.
      await vi.waitFor(() => expect(storeNode('db')).toBeDefined());
      useFlowStore.getState().setNodes((nodes) =>
        nodes.map((candidate) =>
          candidate.id === 'api' ? candidate : { ...candidate, measured: { width: 120, height: 140 } }
        )
      );
      const result = await pending;

      // Beside the api node and centred on it, now that its real height is known; the move stands.
      expect(result).toMatchObject({
        ok: true,
        result: {
          placed: [
            { id: 'db', position: { x: 180, y: -40 }, size: { width: 120, height: 140 } },
            { id: 'note', position: { x: 0, y: 400 }, size: { width: 120, height: 140 } },
          ],
        },
      });
      expect(historyLength()).toBe(1);
    } finally {
      renderer.remove();
    }
  });

  it('works moves next to other nodes out again at the measured sizes', async () => {
    setCanvas([node('api', 0, 0)]);
    const renderer = document.createElement('div');
    renderer.className = 'react-flow__renderer';
    document.body.append(renderer);
    try {
      const pending = createExecutor().execute('edit_canvas', {
        ops: [
          { op: 'add_node', id: 'queue', type: 'process', label: 'Queue' },
          { op: 'move_node', id: 'queue', nextTo: { id: 'api', side: 'below' } },
          { op: 'add_node', id: 'worker', type: 'process', label: 'Worker' },
          { op: 'move_node', id: 'worker', nextTo: { id: 'queue', side: 'right' } },
        ],
      });
      await vi.waitFor(() => expect(storeNode('worker')).toBeDefined());
      useFlowStore.getState().setNodes((nodes) =>
        nodes.map((candidate) =>
          candidate.id === 'queue' ? { ...candidate, measured: { width: 120, height: 140 } }
            : candidate.id === 'worker' ? { ...candidate, measured: { width: 120, height: 100 } }
              : candidate
        )
      );
      const result = await pending;

      // Below the api node, and the worker level with the queue's middle at their real heights.
      expect(result).toMatchObject({
        ok: true,
        result: {
          placed: [
            { id: 'queue', position: { x: 0, y: 140 } },
            { id: 'worker', position: { x: 200, y: 160 } },
          ],
        },
      });
    } finally {
      renderer.remove();
    }
  });

  it('leaves edge handles alone when smart routing is off', async () => {
    useFlowStore.setState((state) => ({ viewSettings: { ...state.viewSettings, smartRoutingEnabled: false } }));
    await createExecutor().execute('edit_canvas', { ops: [{ op: 'move_node', id: 'web', position: { x: 60, y: 200 } }] });
    expect(useFlowStore.getState().edges[0].sourceHandle).toBeUndefined();
  });

  it('returns the real ids when a chosen id is taken', async () => {
    const result = await createExecutor().execute('edit_canvas', {
      ops: [{ op: 'add_node', id: 'api', type: 'process', label: 'Second API' }],
    });
    if (result.ok === false) throw new Error(result.error);

    const realId = (result.result.idMap as Record<string, string>).api;
    expect(realId).toBeTruthy();
    expect(realId).not.toBe('api');
    expect(storeNode(realId)?.data.label).toBe('Second API');
  });

  it('animates only the nodes a batch adds, then clears the flags', async () => {
    vi.useFakeTimers();
    const executor = createExecutor();
    await executor.execute('edit_canvas', {
      ops: [
        { op: 'add_node', id: 'db', type: 'process', label: 'DB' },
        { op: 'add_node', id: 'cache', type: 'process', label: 'Cache' },
      ],
    });

    expect(storeNode('db')?.data).toMatchObject({ freshlyAdded: true, animateDelay: 0 });
    expect(storeNode('cache')?.data).toMatchObject({ freshlyAdded: true, animateDelay: 20 });
    expect(storeNode('api')?.data.freshlyAdded).toBeUndefined();

    await executor.execute('edit_canvas', {
      ops: [{ op: 'add_node', id: 'queue', type: 'process', label: 'Queue' }],
    });
    expect(storeNode('db')?.data.freshlyAdded).toBeUndefined();
    expect(storeNode('queue')?.data.freshlyAdded).toBe(true);

    vi.runAllTimers();
    for (const id of ['db', 'cache', 'queue']) {
      expect(storeNode(id)?.data).not.toHaveProperty('freshlyAdded');
      expect(storeNode(id)?.data).not.toHaveProperty('animateDelay');
    }
  });

  it('rejects invalid arguments and failing ops without touching the page', async () => {
    const executor = createExecutor();
    const before = useFlowStore.getState().nodes;

    const invalid = await executor.execute('edit_canvas', { ops: [{ op: 'explode' }] });
    const failing = await executor.execute('edit_canvas', {
      ops: [{ op: 'update_node', id: 'ghost', label: 'Nope' }],
    });

    expect(invalid).toMatchObject({ ok: false });
    expect(invalid.ok === false && invalid.error).toMatch(/^Invalid arguments for edit_canvas:/);
    expect(failing).toMatchObject({ ok: false, error: expect.stringContaining('ghost') });
    expect(failing.ok === false && failing.resultType).toBeUndefined();
    expect(useFlowStore.getState().nodes).toBe(before);
    expect(historyLength()).toBe(0);
    expect(executor.getUndo()).toBeNull();
  });

  it('asks before a destructive batch and applies it once the user agrees', async () => {
    const confirmRemoval = vi.fn(async () => true);
    const result = await createExecutor(confirmRemoval).execute('edit_canvas', {
      ops: ['api', 'web', 'zone', 'worker'].map((id) => ({ op: 'remove_node', id })),
    });

    expect(result.ok).toBe(true);
    expect(confirmRemoval).toHaveBeenCalledTimes(1);
    const info = (confirmRemoval.mock.calls[0] as unknown as [CanvasEditDestructiveInfo])[0];
    expect(info).toMatchObject({ clearsCanvas: true, needsConfirmation: true });
    expect(useFlowStore.getState().nodes).toEqual([]);
  });

  it('returns a failure the agent can carry on from and changes nothing when the user declines', async () => {
    const executor = createExecutor(vi.fn(async () => false));
    const before = useFlowStore.getState().nodes;

    const result = await executor.execute('edit_canvas', {
      ops: [
        { op: 'remove_node', id: 'api' },
        { op: 'remove_node', id: 'web' },
        { op: 'remove_node', id: 'worker' },
      ],
    });

    expect(result).toEqual({
      ok: false,
      error: 'User declined removing "API", "WEB", "WORKER". Nothing was changed.',
    });
    expect(useFlowStore.getState().nodes).toBe(before);
    expect(historyLength()).toBe(0);
  });

  it('asks once removals across calls reach the threshold, counting only nodes the user had', async () => {
    const confirmRemoval = vi.fn(async () => true);
    const executor = createExecutor(confirmRemoval);
    await executor.execute('edit_canvas', addDatabase);
    await executor.execute('edit_canvas', {
      ops: ['api', 'web', 'db'].map((id) => ({ op: 'remove_node', id })),
    });
    expect(confirmRemoval).not.toHaveBeenCalled();

    const result = await executor.execute('edit_canvas', { ops: [{ op: 'remove_node', id: 'worker' }] });
    expect(result.ok).toBe(true);
    expect(confirmRemoval).toHaveBeenCalledOnce();
    const info = (confirmRemoval.mock.calls[0] as unknown as [CanvasEditDestructiveInfo])[0];
    expect(info).toMatchObject({
      removedNodes: [{ id: 'worker' }],
      removedStartNodeIds: ['api', 'web', 'worker'],
      clearsCanvas: false,
    });
    expect(useFlowStore.getState().nodes.map((candidate) => candidate.id)).toEqual(['zone']);
  });

  it('does not count a declined removal toward later ones', async () => {
    const confirmRemoval = vi.fn(async () => false);
    const executor = createExecutor(confirmRemoval);
    await executor.execute('edit_canvas', {
      ops: ['api', 'web', 'worker'].map((id) => ({ op: 'remove_node', id })),
    });
    expect(confirmRemoval).toHaveBeenCalledOnce();

    const result = await executor.execute('edit_canvas', { ops: [{ op: 'remove_node', id: 'api' }] });
    expect(result.ok).toBe(true);
    expect(confirmRemoval).toHaveBeenCalledOnce();
    expect(storeNode('api')).toBeUndefined();
    expect(storeNode('web')).toBeDefined();
  });

  it('drops the batch when the page changed while the user was asked', async () => {
    let answer: (value: boolean) => void = () => undefined;
    const executor = createExecutor(
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      )
    );

    const pending = executor.execute('edit_canvas', {
      ops: ['api', 'web', 'zone', 'worker'].map((id) => ({ op: 'remove_node', id })),
    });
    await Promise.resolve();
    renameNode('web', 'Changed meanwhile');
    answer(true);

    expect(await pending).toEqual({
      ok: false,
      error: 'The canvas changed while this call ran. Read it again and retry.',
    });
    expect(storeNode('web')?.data.label).toBe('Changed meanwhile');
    expect(historyLength()).toBe(0);
  });

  it('still commits when only the entry animation flags were cleared meanwhile', async () => {
    vi.useFakeTimers();
    let answer: (value: boolean) => void = () => undefined;
    const executor = createExecutor(
      vi.fn(
        () =>
          new Promise<boolean>((resolve) => {
            answer = resolve;
          })
      )
    );
    await executor.execute('edit_canvas', addDatabase);

    const pending = executor.execute('edit_canvas', {
      ops: ['api', 'web', 'zone', 'worker'].map((id) => ({ op: 'remove_node', id })),
    });
    await Promise.resolve();
    vi.runAllTimers();
    answer(true);

    expect((await pending).ok).toBe(true);
    expect(useFlowStore.getState().nodes.map((candidate) => candidate.id)).toEqual(['db']);
    expect(storeNode('db')?.data.freshlyAdded).toBeUndefined();
  });
});

describe('agent executor lock', () => {
  it('fails every canvas call once the lock is released or the page changed', async () => {
    const executor = createExecutor();
    useFlowStore.getState().setAgentTurn(null);

    const released = await executor.execute('edit_canvas', addDatabase);
    useFlowStore.getState().setAgentTurn({ turnId: 'turn-1', pageId: 'tab-2' });
    useFlowStore.setState({ activeTabId: 'tab-2' });
    const otherPage = await executor.execute('get_canvas', {});

    const error = 'The Flowpilot turn is no longer active on this page.';
    expect(released).toEqual({ ok: false, error });
    expect(otherPage).toEqual({ ok: false, error });
    expect(storeNode('db')).toBeUndefined();
  });

  it('fails the catalog tools too once the lock is released', async () => {
    const executor = createExecutor();
    useFlowStore.getState().setAgentTurn(null);

    const error = 'The Flowpilot turn is no longer active on this page.';
    expect(await executor.execute('find_icons', { query: 'database' })).toEqual({
      ok: false,
      error,
    });
    expect(await executor.execute('list_templates', {})).toEqual({ ok: false, error });
  });

  it('reports unknown tools', async () => {
    const result = await createExecutor().execute('delete_everything' as never, {});
    expect(result).toEqual({ ok: false, error: 'Unknown tool "delete_everything".' });
  });
});

describe('agent executor undo', () => {
  it('undoes the whole turn in one step', async () => {
    const executor = createExecutor();
    await executor.execute('edit_canvas', addDatabase);
    await executor.execute('edit_canvas', {
      ops: [{ op: 'update_node', id: 'web', label: 'Storefront' }],
    });
    const undo = executor.getUndo();
    expect(canUndoAgentTurn(useFlowStore.getState(), undo)).toBe(false);
    useFlowStore.getState().setAgentTurn(null);

    expect(canUndoAgentTurn(useFlowStore.getState(), undo)).toBe(true);
    expect(undoAgentTurn(undo)).toBe(true);

    expect(useFlowStore.getState().nodes).toBe(executor.startGraph.nodes);
    expect(useFlowStore.getState().edges).toBe(executor.startGraph.edges);
    expect(canUndoAgentTurn(useFlowStore.getState(), undo)).toBe(false);
  });

  it('is gone once the user edits the page after the turn', async () => {
    const executor = createExecutor();
    await executor.execute('edit_canvas', addDatabase);
    const undo = executor.getUndo();
    useFlowStore.getState().setAgentTurn(null);

    renameNode('api', 'Gateway');

    expect(canUndoAgentTurn(useFlowStore.getState(), undo)).toBe(false);
    expect(undoAgentTurn(undo)).toBe(false);
    expect(storeNode('db')).toBeDefined();
  });

  it('is gone once a later change records its own history entry', async () => {
    const executor = createExecutor();
    await executor.execute('edit_canvas', addDatabase);
    const undo = executor.getUndo();
    useFlowStore.getState().setAgentTurn(null);

    useFlowStore.getState().recordHistoryV2();

    expect(canUndoAgentTurn(useFlowStore.getState(), undo)).toBe(false);
  });

  it('ignores the entry animation flags when comparing the page', async () => {
    vi.useFakeTimers();
    const executor = createExecutor();
    await executor.execute('edit_canvas', addDatabase);
    const undo = executor.getUndo();
    useFlowStore.getState().setAgentTurn(null);
    vi.runAllTimers();

    expect(canUndoAgentTurn(useFlowStore.getState(), undo)).toBe(true);
  });
});

describe('agent executor find_icons', () => {
  it('returns catalog icons up to the limit', async () => {
    const result = await createExecutor().execute('find_icons', {
      query: 'lambda',
      provider: 'aws',
      limit: 2,
    });
    if (result.ok === false) throw new Error(result.error);

    const icons = result.result.icons as Array<Record<string, unknown>>;
    expect(icons.length).toBeGreaterThan(0);
    expect(icons.length).toBeLessThanOrEqual(2);
    expect(Object.keys(icons[0]).sort()).toEqual([
      'category',
      'label',
      'packId',
      'provider',
      'shapeId',
    ]);
    expect(icons[0].provider).toBe('aws');
  });

  it('says so when nothing matches', async () => {
    const result = await createExecutor().execute('find_icons', { query: 'zzzqqqxxx' });
    expect(result).toMatchObject({ ok: true, result: { icons: [], note: expect.any(String) } });
  });
});

describe('agent executor layout', () => {
  it('tidies only the nodes added in this turn', async () => {
    const executor = createExecutor();
    const nothing = await executor.execute('layout', { scope: 'new' });
    // Added before its edge, the database waits beside the diagram; edits never move it after that.
    await executor.execute('edit_canvas', { ops: [addDatabase.ops[0]] });
    await executor.execute('edit_canvas', { ops: [addDatabase.ops[1]] });
    const unconnected = storeNode('db')!.position;
    const tidied = await executor.execute('layout', { scope: 'new' });

    expect(nothing).toEqual({
      ok: true,
      result: { summary: 'No nodes were added in this turn, so nothing moved.' },
    });
    expect(tidied).toEqual({
      ok: true,
      result: { summary: 'Tidied 1 node added in this turn.', layout: { issues: [] } },
    });
    // It moves next to the api node it now connects to, which sits at the origin.
    const moved = storeNode('db')!.position;
    expect(moved).not.toEqual(unconnected);
    expect(Math.hypot(moved.x, moved.y)).toBeLessThan(Math.hypot(unconnected.x, unconnected.y));
    expect(storeNode('api')?.position).toEqual({ x: 0, y: 0 });
    expect(storeNode('web')?.position).toEqual({ x: 300, y: 0 });
    expect(historyLength()).toBe(1);
  });

  it('re-lays out the whole page with a fresh layout cache', async () => {
    vi.mocked(composeDiagramForDisplay).mockImplementation(async (nodes, edges) => ({
      nodes: nodes.map((candidate, index) => ({
        ...candidate,
        position: { x: index * 500, y: 900 },
      })),
      edges,
    }));
    const before = useFlowStore.getState();

    const result = await createExecutor().execute('layout', { scope: 'all' });

    expect(result).toEqual({
      ok: true,
      result: { summary: 'Re-laid out the whole page.', layout: { issues: [] } },
    });
    expect(clearLayoutCache).toHaveBeenCalledTimes(1);
    // Layered like the toolbar's auto-layout, forwards along the page's axis: its one edge runs right to left.
    expect(composeDiagramForDisplay).toHaveBeenCalledWith(before.nodes, before.edges, {
      diagramType: 'architecture',
      algorithm: 'layered',
      direction: 'LR',
    });
    expect(storeNode('web')?.position).toEqual({ x: 500, y: 900 });
    expect(historyLength()).toBe(1);
  });

  it('lays the page out the way the agent asks it to flow', async () => {
    vi.mocked(composeDiagramForDisplay).mockImplementation(async (nodes, edges) => ({ nodes, edges }));
    await createExecutor().execute('layout', { scope: 'all', direction: 'down' });
    expect(composeDiagramForDisplay).toHaveBeenCalledWith(expect.anything(), expect.anything(), {
      diagramType: 'architecture',
      algorithm: 'layered',
      direction: 'TB',
    });
  });

  it('drops a whole-page layout that finishes after the turn started ending', async () => {
    let finishLayout!: () => void;
    vi.mocked(composeDiagramForDisplay).mockImplementation(
      (nodes, edges) =>
        new Promise((resolve) => {
          finishLayout = () =>
            resolve({ nodes: nodes.map((candidate) => ({ ...candidate, position: { x: 0, y: 900 } })), edges });
        })
    );
    const endingReason = vi.fn((): string | undefined => undefined);
    const pending = createExecutor(undefined, endingReason).execute('layout', { scope: 'all' });
    await vi.waitFor(() => expect(composeDiagramForDisplay).toHaveBeenCalledOnce());
    endingReason.mockReturnValue('The user stopped this turn.');
    finishLayout();

    expect(await pending).toEqual({ ok: false, error: 'The user stopped this turn.' });
    expect(storeNode('web')?.position).toEqual({ x: 300, y: 0 });
    expect(historyLength()).toBe(0);
  });
});

describe('agent executor review_architecture', () => {
  it('says when no rules are set up', async () => {
    const result = await createExecutor().execute('review_architecture', {});
    expect(result).toMatchObject({ ok: true, result: { ruleCount: 0, violations: [] } });
  });

  it('says when rules could not be parsed instead of reporting a clean review', async () => {
    localStorage.setItem(WORKSPACE_RULES_KEY, '{ not json');

    const result = await createExecutor().execute('review_architecture', {});

    expect(result).toEqual({
      ok: true,
      result: {
        ruleCount: 0,
        violations: [],
        note: 'The workspace lint rules could not be parsed and were skipped. No other lint rules are set up.',
      },
    });
  });

  it('checks workspace and diagram rules', async () => {
    localStorage.setItem(
      WORKSPACE_RULES_KEY,
      JSON.stringify({
        rules: [
          {
            id: 'needs-db',
            description: 'Add a database',
            severity: 'error',
            type: 'must-have-node',
            from: { labelContains: 'db' },
          },
        ],
      })
    );
    useFlowStore.setState((state) => ({
      viewSettings: {
        ...state.viewSettings,
        lintRules: JSON.stringify({
          rules: [
            {
              id: 'web-not-api',
              severity: 'warning',
              type: 'cannot-connect',
              from: { id: 'web' },
              to: { id: 'api' },
            },
          ],
        }),
      },
    }));

    const result = await createExecutor().execute('review_architecture', {});
    if (result.ok === false) throw new Error(result.error);

    expect(result.result.ruleCount).toBe(2);
    expect(result.result.violations).toEqual([
      expect.objectContaining({ ruleId: 'needs-db', message: 'Add a database' }),
      expect.objectContaining({ ruleId: 'web-not-api', edgeIds: ['e-web-api'] }),
    ]);
  });
});

describe('agent executor templates', () => {
  it('lists the starter templates', async () => {
    const result = await createExecutor().execute('list_templates', {});
    if (result.ok === false) throw new Error(result.error);

    const templates = result.result.templates as Array<Record<string, unknown>>;
    expect(templates.map((template) => template.id)).toEqual(
      getFlowTemplates().map((template) => template.id)
    );
    expect(Object.keys(templates[0]).sort()).toEqual(['category', 'description', 'id', 'name']);
  });

  it('loads a template onto an empty canvas only', async () => {
    const template = getFlowTemplates()[0];
    const busy = await createExecutor().execute('use_template', { templateId: template.id });
    expect(busy).toMatchObject({ ok: false, error: expect.stringContaining('empty canvas') });

    setCanvas([]);
    const unknown = await createExecutor().execute('use_template', { templateId: 'nope' });
    const loaded = await createExecutor().execute('use_template', { templateId: template.id });

    expect(unknown).toMatchObject({ ok: false, error: expect.stringContaining('"nope"') });
    expect(loaded).toMatchObject({
      ok: true,
      result: {
        summary: `Loaded the "${template.name}" template.`,
        canvas: { nodeCount: template.nodes.length },
      },
    });
    const nodes = useFlowStore.getState().nodes;
    expect(nodes).toHaveLength(template.nodes.length);
    expect(nodes.every((candidate) => candidate.data.freshlyAdded)).toBe(true);
    expect(historyLength()).toBe(1);
  });
});

describe('agent executor page style', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    useFlowStore.setState({ globalEdgeOptions: INITIAL_GLOBAL_EDGE_OPTIONS });
  });

  it('reports the appearance, design system, edge defaults and colors in use', async () => {
    document.documentElement.setAttribute('data-theme', 'dark');
    useFlowStore.setState({ globalEdgeOptions: { type: 'step', curve: 'step', animated: false, strokeWidth: 2 } });
    setCanvas(
      [node('api', 0, 0, { data: { label: 'API', color: 'blue' } }), node('web', 300, 0, { data: { label: 'WEB', color: 'blue' } }), node('db', 0, 200)],
      [edge('web', 'api', { style: { stroke: '#f87171' } }), edge('api', 'db')]
    );

    const result = await createExecutor().execute('get_canvas', {});
    if (result.ok === false) throw new Error(result.error);

    expect(result.result.style).toMatchObject({
      appearance: 'dark',
      canvasBackground: '#0a0a0a',
      designSystem: { name: expect.any(String), edgeColor: expect.any(String) },
      edgeDefaults: { path: 'sharp', width: 2, animated: false },
      nodeColors: [
        { color: 'blue', colorMode: 'subtle', count: 2, types: ['process'] },
        { color: 'white', colorMode: 'subtle', count: 1, types: ['process'] },
      ],
      edgeColors: [{ color: 'red', count: 1 }, { color: 'default', count: 1 }],
    });
  });

  it('gives new edges the diagram-wide edge style', async () => {
    useFlowStore.setState({ globalEdgeOptions: { type: 'straight', curve: 'linear', animated: true, strokeWidth: 3 } });
    await createExecutor().execute('edit_canvas', addDatabase);
    expect(useFlowStore.getState().edges.at(-1)).toMatchObject({ type: 'straight', animated: true, style: { strokeWidth: 3 } });
  });
});

describe('agent executor capture_canvas and focus_canvas', () => {
  it('shows the requested area and returns its picture as an image', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'requestAnimationFrame'] });
    const { captureCanvasRegion } = await import('./canvasCapture');
    const capture = vi.mocked(captureCanvasRegion);
    capture.mockResolvedValue({ data: 'aGk=', mimeType: 'image/jpeg', width: 400, height: 200, scale: 1 });
    const setViewport = vi.fn(async () => true);
    const container = document.createElement('div');
    container.className = 'react-flow';
    container.getBoundingClientRect = () => ({ width: 800, height: 600 }) as DOMRect;
    document.body.appendChild(container);

    try {
      const pending = createAgentTurnExecutor({
        turn: TURN, confirmRemoval: vi.fn(async () => true), endingReason: () => undefined, view: () => ({ setViewport }),
      }).execute('capture_canvas', { nodeIds: ['api', 'web'] });
      await vi.runAllTimersAsync();
      const result = await pending;

      // api and web span 0..420 x 0..60; the picture adds 40 px around them.
      expect(capture).toHaveBeenCalledWith({ x: -40, y: -40, width: 500, height: 140 }, '#f8fafc');
      expect(setViewport).toHaveBeenCalledWith(expect.objectContaining({ zoom: 1.25 }), { duration: 250 });
      expect(result).toEqual({
        ok: true,
        result: {
          area: { position: { x: -40, y: -40 }, size: { width: 500, height: 140 } },
          image: { width: 400, height: 200, note: 'Image px = (canvas px - area.position) x 1.' },
        },
        images: [{ data: 'aGk=', mimeType: 'image/jpeg' }],
      });
    } finally {
      container.remove();
      capture.mockReset();
    }
  });

  it('says so when there is nothing to show or no picture could be taken', async () => {
    const { captureCanvasRegion } = await import('./canvasCapture');
    vi.mocked(captureCanvasRegion).mockResolvedValue(null);
    const executor = createExecutor();

    expect(await executor.execute('capture_canvas', { nodeIds: ['ghost'] })).toMatchObject({ ok: false, error: expect.stringContaining('"ghost" do not exist') });
    expect(await executor.execute('capture_canvas', {})).toEqual({
      ok: true,
      result: { note: 'The canvas is not showing, so no picture could be taken. Rely on get_canvas.' },
    });
    setCanvas([]);
    expect(await executor.execute('capture_canvas', {})).toEqual({ ok: true, result: { note: 'The canvas is empty, so there is nothing to look at.' } });
  });

  it('selects the nodes it points the user at without changing the page', async () => {
    const executor = createExecutor();
    const result = await executor.execute('focus_canvas', { nodeIds: ['web', 'worker'], select: true });

    expect(result).toMatchObject({ ok: true, result: { summary: expect.stringContaining('Selected 2 node(s).') } });
    expect(useFlowStore.getState().nodes.filter((candidate) => candidate.selected).map((candidate) => candidate.id)).toEqual(['web', 'worker']);
    expect(historyLength()).toBe(0);
    expect(executor.getUndo()).toBeNull();

    await executor.execute('focus_canvas', { select: false });
    expect(useFlowStore.getState().nodes.some((candidate) => candidate.selected)).toBe(false);
  });
});

describe('agent executor capture regions', () => {
  it('leaves nodes the user cannot see out of the whole-page picture', async () => {
    const { captureCanvasRegion } = await import('./canvasCapture');
    const capture = vi.mocked(captureCanvasRegion);
    capture.mockResolvedValue(null);
    useFlowStore.setState({ layers: [{ id: 'default', name: 'Default', visible: true, locked: false }, { id: 'off', name: 'Off', visible: false, locked: false }] });
    setCanvas([node('api', 0, 0), node('ghost', 2000, 2000, { data: { label: 'G', layerId: 'off' } })]);

    await createExecutor().execute('capture_canvas', {});
    expect(capture).toHaveBeenCalledWith({ x: -40, y: -40, width: 200, height: 140 }, expect.any(String));
    capture.mockReset();
  });
});
