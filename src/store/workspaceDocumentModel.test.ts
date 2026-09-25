import { describe, expect, it } from 'vitest';
import type { FlowNode, FlowTab } from '@/lib/types';
import { createWorkspaceDocumentsFromTabs } from './workspaceDocumentModel';
import type { FlowDocument } from '@/services/storage/flowDocumentModel';

function createTab(overrides: Partial<FlowTab> = {}): FlowTab {
  return {
    id: 'tab-1',
    name: 'Document One',
    diagramType: 'flowchart',
    updatedAt: '2026-03-27T00:00:00.000Z',
    nodes: [],
    edges: [],
    history: { past: [], future: [] },
    playback: undefined,
    ...overrides,
  };
}

function createDocumentFromTab(tab: FlowTab): FlowDocument {
  return {
    id: tab.id,
    name: tab.name,
    createdAt: tab.updatedAt ?? '2026-03-27T00:00:00.000Z',
    updatedAt: tab.updatedAt ?? '2026-03-27T00:00:00.000Z',
    activePageId: tab.id,
    pages: [tab],
  };
}

describe('workspaceDocumentModel', () => {
  it('builds document summaries from tabs', () => {
    const documents = createWorkspaceDocumentsFromTabs({
      documents: [createDocumentFromTab(createTab())],
      activeDocumentId: 'tab-1',
      activeNodes: [{ id: 'n1' } as never],
      activeEdges: [],
      activePages: [createTab()],
      activePageId: 'tab-1',
    });

    expect(documents).toHaveLength(1);
    expect(documents[0]).toMatchObject({
      id: 'tab-1',
      name: 'Document One',
      nodeCount: 1,
      edgeCount: 0,
      isActive: true,
    });
  });

  it('sorts the active document first, then by updated time', () => {
    const documents = createWorkspaceDocumentsFromTabs({
      documents: [
        createDocumentFromTab(
          createTab({
            id: 'tab-older',
            name: 'Older',
            updatedAt: '2026-03-26T00:00:00.000Z',
          })
        ),
        createDocumentFromTab(
          createTab({
            id: 'tab-active',
            name: 'Active',
            updatedAt: '2026-03-25T00:00:00.000Z',
          })
        ),
        createDocumentFromTab(
          createTab({
            id: 'tab-newer',
            name: 'Newer',
            updatedAt: '2026-03-27T00:00:00.000Z',
          })
        ),
      ],
      activeDocumentId: 'tab-active',
      activeNodes: [],
      activeEdges: [],
      activePages: [
        createTab({ id: 'tab-active', name: 'Active', updatedAt: '2026-03-25T00:00:00.000Z' }),
      ],
      activePageId: 'tab-active',
    });

    expect(documents.map((document) => document.id)).toEqual([
      'tab-active',
      'tab-newer',
      'tab-older',
    ]);
  });
});

function summariesForPages(pages: FlowTab[]) {
  return createWorkspaceDocumentsFromTabs({
    documents: pages.map(createDocumentFromTab),
    activeDocumentId: '',
    activeNodes: [],
    activeEdges: [],
    activePages: [],
    activePageId: '',
  });
}

function previewNode(id: string, x = 0, y = 0, overrides: Partial<FlowNode> = {}): FlowNode {
  return { id, type: 'process', position: { x, y }, data: { label: id }, ...overrides };
}

describe('bounded workspace thumbnails', () => {
  it('provides connected previews for every document, including beyond the third', () => {
    const pages = Array.from({ length: 6 }, (_, index) =>
      createTab({
        id: `doc-${index}`,
        nodes: [previewNode('a', -180, -60), previewNode('b', 60, -60, { type: 'decision' })],
        edges: [{ id: 'a-b', source: 'a', target: 'b' }],
      })
    );
    const summaries = summariesForPages(pages);
    expect(summaries.every((summary) => summary.preview?.nodes.length === 2)).toBe(true);
    expect(summaries[5].preview).toMatchObject({
      nodes: [
        { id: 'a', x: -180, y: -60, label: 'a' },
        { id: 'b', shape: 'diamond' },
      ],
      edges: [{ id: 'a-b', source: 'a', target: 'b' }],
    });
  });

  it('shows a bounded sample of large diagrams instead of returning an empty thumbnail', () => {
    const nodes = Array.from({ length: 2000 }, (_, index) =>
      previewNode(`n${index}`, (index % 10) * 180, Math.floor(index / 10) * 120)
    );
    const edges = nodes
      .slice(1)
      .map((node, index) => ({ id: `e${index}`, source: `n${index}`, target: node.id }));
    const preview = summariesForPages([createTab({ nodes, edges })])[0].preview;
    expect(preview?.nodes).toHaveLength(18);
    expect(preview?.edges).toHaveLength(17);
    const ids = new Set(preview?.nodes.map((node) => node.id));
    expect(preview?.edges.every((edge) => ids.has(edge.source) && ids.has(edge.target))).toBe(true);
    expect(nodes).toHaveLength(2000);
  });

  it('resolves nested negative coordinates and excludes invalid, hidden, and cyclic nodes', () => {
    const nodes = [
      previewNode('group', -400, -300, { type: 'group' }),
      previewNode('child', 40, 30, { parentId: 'group' }),
      previewNode('hidden', 0, 0, { hidden: true }),
      previewNode('invalid', Number.NaN, 20),
      previewNode('cycle-a', 0, 0, { parentId: 'cycle-b' }),
      previewNode('cycle-b', 0, 0, { parentId: 'cycle-a' }),
    ];
    expect(summariesForPages([createTab({ nodes })])[0].preview?.nodes).toEqual([
      expect.objectContaining({ id: 'child', x: -360, y: -270 }),
    ]);
  });

  it('caches unchanged graph snapshots, invalidates edited arrays, and includes only bounded display data', () => {
    const nodes = [
      previewNode('first', 0, 0, {
        data: {
          label: 'A very long diagram node label to truncate',
          description: 'private detail not needed by thumbnails',
        },
      }),
    ];
    const page = createTab({ nodes });
    const first = summariesForPages([page])[0].preview;
    expect(summariesForPages([page])[0].preview).toBe(first);
    const editedPage = { ...page, nodes: [...nodes, previewNode('next', 180, 0)] };
    expect(summariesForPages([editedPage])[0].preview).not.toBe(first);
    expect(first?.nodes[0].label.length).toBeLessThanOrEqual(24);
    expect(first?.nodes[0]).not.toHaveProperty('data');
    expect(JSON.stringify(first)).not.toContain('private detail');
  });
});
