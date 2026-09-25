import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { buildDiagramDocumentJson, importDiagramDocumentJson } from './diagramDocumentTransfer';

function createNode(id: string): FlowNode {
  return {
    id,
    type: 'process',
    position: { x: 0, y: 0 },
    data: { label: id },
  } as FlowNode;
}

function createEdge(id: string, source: string, target: string): FlowEdge {
  return { id, source, target } as FlowEdge;
}

describe('diagramDocumentTransfer', () => {
  it('builds diagram document json from the current graph', async () => {
    const json = await buildDiagramDocumentJson({
      nodes: [createNode('n1')],
      edges: [createEdge('e1', 'n1', 'n1')],
      exportSerializationMode: 'deterministic',
      activeTab: { diagramType: 'flowchart' },
    });

    const parsed = JSON.parse(json) as { nodes: FlowNode[]; edges: FlowEdge[]; diagramType: string };
    expect(parsed.diagramType).toBe('flowchart');
    expect(parsed.nodes).toHaveLength(1);
    expect(parsed.edges).toHaveLength(1);
  });

  it('imports diagram document json into composed nodes and edges', async () => {
    const json = await buildDiagramDocumentJson({
      nodes: [createNode('n1')],
      edges: [createEdge('e1', 'n1', 'n1')],
      exportSerializationMode: 'deterministic',
      activeTab: { diagramType: 'flowchart' },
    });

    const result = await importDiagramDocumentJson({
      json,
      importStart: performance.now(),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.nodes).toHaveLength(1);
    expect(result.edges).toHaveLength(1);
    expect(result.outcome.status).toBe('success');
    expect(result.report.status).toBe('success');
  });

  it('restores the latest native document after a node moves and is renamed', async () => {
    const section = (id: string): FlowNode =>
      ({ ...createNode(id), type: 'section', style: { width: 400, height: 300 } }) as FlowNode;
    const importNodes = async (nodes: FlowNode[]) => {
      const json = await buildDiagramDocumentJson({
        nodes,
        edges: [createEdge('e1', 'x', 'z')],
        exportSerializationMode: 'deterministic',
        activeTab: { diagramType: 'flowchart' },
      });
      const result = await importDiagramDocumentJson({ json, importStart: performance.now() });
      if (!result.ok) throw new Error('expected the import to succeed');
      return result.nodes.find((node) => node.id === 'z');
    };
    const inB = [section('a'), section('b'), { ...createNode('x'), parentId: 'a' }];

    await importNodes([...inB, { ...createNode('z'), parentId: 'b' }]);
    const moved = await importNodes([
      ...inB,
      { ...createNode('z'), parentId: 'a', data: { label: 'Renamed' } } as FlowNode,
    ]);

    expect(moved?.parentId).toBe('a');
    expect(moved?.data.label).toBe('Renamed');
  });

  it('round-trips native node positions, handles, and manual bends without relayout', async () => {
    const nodes = [
      { ...createNode('a'), position: { x: -450, y: 230 } },
      { ...createNode('b'), position: { x: 900, y: 620 } },
    ];
    const edges: FlowEdge[] = [{
      ...createEdge('ab', 'a', 'b'), sourceHandle: 'top', targetHandle: 'bottom',
      data: {
        routingMode: 'manual', curve: 'smoothstep',
        waypoint: { x: 120, y: -240 },
        waypoints: [{ x: -400, y: -100 }, { x: 900, y: -100 }],
        elkPoints: [{ x: -390, y: 230 }, { x: 960, y: 680 }],
        labelPosition: 0.7,
      },
    }];
    const json = await buildDiagramDocumentJson({ nodes, edges, exportSerializationMode: 'deterministic' });
    const result = await importDiagramDocumentJson({ json, importStart: performance.now() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes).toEqual(nodes);
    expect(result.edges).toEqual(edges);
  });

  it('still lays out legacy graph JSON without a native document envelope', async () => {
    const result = await importDiagramDocumentJson({
      json: JSON.stringify({ nodes: [createNode('a'), createNode('b')], edges: [createEdge('ab', 'a', 'b')] }),
      importStart: performance.now(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.nodes[0].position).not.toEqual(result.nodes[1].position);
    expect(result.warnings).toContain('Imported legacy JSON without version metadata; loaded with compatibility mode.');
  });

  it('returns a structured failure report for invalid diagram json', async () => {
    const result = await importDiagramDocumentJson({
      json: JSON.stringify({ version: '1.0', nodes: [] }),
      importStart: performance.now(),
    });

    expect(result.ok).toBe(false);
    expect(result.outcome.status).toBe('error');
    expect(result.report.status).toBe('failed');
    expect(result.report.issues[0]?.message).toContain('missing nodes or edges arrays');
  });

  it('returns a structured failure report for non-object diagram envelopes', async () => {
    const result = await importDiagramDocumentJson({
      json: JSON.stringify(['not-a-document']),
      importStart: performance.now(),
    });

    expect(result.ok).toBe(false);
    expect(result.outcome.status).toBe('error');
    expect(result.report.status).toBe('failed');
    expect(result.report.issues[0]?.message).toContain('missing nodes or edges arrays');
  });
});
