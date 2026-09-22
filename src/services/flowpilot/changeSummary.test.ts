import { describe, expect, it } from 'vitest';
import type { FlowEdge, FlowNode } from '@/lib/types';
import { MarkerType } from '@/lib/reactflowCompat';
import { getCanvasFingerprint, matchDiagramEdges, summarizeDiagramChanges } from './changeSummary';

const node = (id: string, label = id): FlowNode => ({
  id, type: 'process', position: { x: 100, y: 200 }, data: { label },
});
const edge = (id: string, source = 'api', target = 'cache', label = 'lookup'): FlowEdge => ({
  id, source, target, label, type: 'bezier', data: { label },
});

describe('semantic Flowpilot change summaries', () => {
  it('counts a rename as one changed node, not every retained node', () => {
    const nodes = [node('web'), node('api'), node('cache', 'Redis'), node('db')];
    const result = summarizeDiagramChanges(
      { nodes, edges: [edge('old')] },
      { nodes: nodes.map((n) => n.id === 'cache' ? { ...n, data: { label: 'Orders Cache' } } : n), edges: [edge('new-id')] },
    );
    expect(result).toMatchObject({ addedCount: 0, removedCount: 0, updatedCount: 1, totalChanges: 1, addedEdgeCount: 0, removedEdgeCount: 0 });
    expect(result.details).toEqual([{ kind: 'node', status: 'updated', label: 'Orders Cache', previousLabel: 'Redis' }]);
  });

  it('ignores selection, measurement, animation state, positions, key order, and regenerated edge IDs in the diff', () => {
    const before = node('api');
    const after = { ...before, selected: true, measured: { width: 200, height: 100 }, position: { x: 90, y: 30 }, data: { animateDelay: 20, freshlyAdded: true, label: 'api' } };
    expect(summarizeDiagramChanges({ nodes: [before], edges: [edge('a')] }, { nodes: [after], edges: [edge('b')] }).totalChanges).toBe(0);
  });

  it('detects visual and structural node edits without counting implicit default values as changes', () => {
    const original = node('api');
    expect(summarizeDiagramChanges({ nodes: [original], edges: [] }, {
      nodes: [{ ...original, data: { ...original.data, color: 'red', icon: 'Database' } }], edges: [],
    }).updatedCount).toBe(1);
    expect(summarizeDiagramChanges({ nodes: [original], edges: [] }, {
      nodes: [{ ...original, parentId: 'group' }], edges: [],
    }).updatedCount).toBe(1);
  });

  it('recognizes additions, removals, and changed connection labels', () => {
    const result = summarizeDiagramChanges(
      { nodes: [node('api'), node('old')], edges: [edge('old-id', 'api', 'cache')] },
      { nodes: [node('api'), node('new')], edges: [edge('new-id', 'api', 'cache', 'cached query')] },
    );
    expect(result).toMatchObject({ addedCount: 1, removedCount: 1, updatedCount: 0, updatedEdgeCount: 1, totalChanges: 3 });
  });

  it('matches parallel edges by content before treating them as edits', () => {
    const before = [edge('a', 'api', 'cache', 'read'), edge('b', 'api', 'cache', 'write')];
    const after = [edge('x', 'api', 'cache', 'write'), edge('y', 'api', 'cache', 'read')];
    expect(summarizeDiagramChanges({ nodes: [], edges: before }, { nodes: [], edges: after }).totalChanges).toBe(0);
    expect(summarizeDiagramChanges({ nodes: [], edges: before }, { nodes: [], edges: after.slice(0, 1) }).removedEdgeCount).toBe(1);
  });

  it('reserves unchanged parallel edges before matching an earlier changed edge', () => {
    const before = [edge('read', 'api', 'cache', 'read'), edge('write', 'api', 'cache', 'write')];
    const after = [edge('new-write', 'api', 'cache', 'update'), edge('new-read', 'api', 'cache', 'read')];
    const pairs = matchDiagramEdges(before, after);

    expect(pairs.map((pair) => [pair.before?.id, pair.after?.id])).toEqual([
      ['write', 'new-write'], ['read', 'new-read'],
    ]);
    expect(summarizeDiagramChanges({ nodes: [], edges: before }, { nodes: [], edges: after }).updatedEdgeCount).toBe(1);
  });

  it.each([
    { sourceHandle: 'right-source', targetHandle: 'left-target' },
    { markerEnd: { type: MarkerType.ArrowClosed } },
    { hidden: true },
  ])('invalidates previews after manual connection changes: %j', (change) => {
    const original = edge('connection');
    const before = getCanvasFingerprint({ nodes: [], edges: [original] });
    const after = getCanvasFingerprint({ nodes: [], edges: [{ ...original, ...change }] });
    expect(after).not.toBe(before);
  });

  it('detects position changes for stale-result safety while ignoring transient canvas metadata', () => {
    const original = node('api');
    const baseline = getCanvasFingerprint({ nodes: [original], edges: [] });
    expect(getCanvasFingerprint({ nodes: [{ ...original, selected: true, measured: { width: 300, height: 120 } }], edges: [] })).toBe(baseline);
    expect(getCanvasFingerprint({ nodes: [{ ...original, position: { x: 0, y: 0 } }], edges: [] })).not.toBe(baseline);
  });
});
