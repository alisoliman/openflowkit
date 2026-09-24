import type { FlowEdge, FlowNode } from '@/lib/types';
import { NODE_DEFAULTS } from '@/theme';
import type { DiagramChange, DiagramChangeSummary } from './types';

export interface DiagramGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, stableValue(entry)]));
  }
  return value;
}

function fingerprint(value: unknown): string {
  return JSON.stringify(stableValue(value));
}

function nodeContent(node: FlowNode) {
  const { freshlyAdded: _fresh, animateDelay: _delay, ...data } = node.data;
  const defaults = NODE_DEFAULTS[node.type || 'process'] || NODE_DEFAULTS.process;
  return {
    type: node.type || 'process',
    parentId: node.parentId,
    data: {
      ...data,
      color: data.color ?? defaults.color,
      shape: data.shape ?? defaults.shape,
      icon: (data.icon ?? defaults.icon) === 'none' ? undefined : (data.icon ?? defaults.icon),
    },
    style: node.style,
    hidden: node.hidden || undefined,
  };
}

function edgeContent(edge: FlowEdge) {
  const {
    label: _label,
    elkPoints: _elk,
    importRoutePoints: _points,
    importRoutePath: _path,
    ...data
  } = edge.data ?? {};
  return {
    label: edge.label || edge.data?.label || '',
    type: !edge.type || edge.type === 'default' ? 'bezier' : edge.type,
    animated: Boolean(edge.animated),
    style: edge.style,
    data,
  };
}

// Model-generated edges do not retain IDs. Match content first, then endpoints,
// so a changed label is one update rather than a removal plus an addition.
export function matchDiagramEdges(before: FlowEdge[], after: FlowEdge[]) {
  const remaining = new Set(before);
  const pairs: Array<{ before?: FlowEdge; after: FlowEdge }> = after.map((edge) => ({ after: edge }));
  const strategies: Array<(candidate: FlowEdge, edge: FlowEdge) => boolean> = [
    (candidate, edge) => fingerprint(edgeContent(candidate)) === fingerprint(edgeContent(edge)),
    (candidate, edge) => (candidate.label || candidate.data?.label || '') === (edge.label || edge.data?.label || ''),
    () => true,
  ];
  for (const matches of strategies) {
    for (const pair of pairs) {
      if (pair.before) continue;
      const matched = [...remaining].find((candidate) =>
        candidate.source === pair.after.source && candidate.target === pair.after.target
        && matches(candidate, pair.after));
      if (matched) {
        remaining.delete(matched);
        pair.before = matched;
      }
    }
  }
  return [...pairs, ...[...remaining].map((edge) => ({ before: edge, after: undefined }))];
}

/**
 * With `countMoves`, nodes that only moved count too: an agent turn moves nodes on purpose, while a
 * generated diagram is laid out afresh, so there every node would count.
 */
export function summarizeDiagramChanges(
  before: DiagramGraph,
  after: DiagramGraph,
  { countMoves = false }: { countMoves?: boolean } = {}
): DiagramChangeSummary {
  const details: DiagramChange[] = [];
  let movedCount = 0;
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));
  for (const node of after.nodes) {
    const previous = beforeById.get(node.id);
    if (!previous) {
      details.push({ kind: 'node', status: 'added', label: node.data.label });
    } else if (fingerprint(nodeContent(previous)) !== fingerprint(nodeContent(node))) {
      details.push({
        kind: 'node',
        status: 'updated',
        label: node.data.label,
        previousLabel: previous.data.label !== node.data.label ? previous.data.label : undefined,
      });
    } else if (
      countMoves &&
      (previous.position.x !== node.position.x || previous.position.y !== node.position.y)
    ) {
      movedCount += 1;
    }
  }
  for (const node of before.nodes) {
    if (!afterById.has(node.id)) details.push({ kind: 'node', status: 'removed', label: node.data.label });
  }
  const edgeLabel = (edge: FlowEdge, nodes: Map<string, FlowNode>) => {
    const label = edge.label || edge.data?.label;
    return `${nodes.get(edge.source)?.data.label ?? edge.source} -> ${nodes.get(edge.target)?.data.label ?? edge.target}${label ? ` (${String(label)})` : ''}`;
  };
  for (const pair of matchDiagramEdges(before.edges, after.edges)) {
    if (!pair.before && pair.after) {
      details.push({ kind: 'edge', status: 'added', label: edgeLabel(pair.after, afterById) });
    } else if (pair.before && !pair.after) {
      details.push({ kind: 'edge', status: 'removed', label: edgeLabel(pair.before, beforeById) });
    } else if (pair.before && pair.after && fingerprint(edgeContent(pair.before)) !== fingerprint(edgeContent(pair.after))) {
      details.push({ kind: 'edge', status: 'updated', label: edgeLabel(pair.after, afterById) });
    }
  }
  const count = (kind: DiagramChange['kind'], status: DiagramChange['status']) =>
    details.filter((change) => change.kind === kind && change.status === status).length;
  return {
    addedCount: count('node', 'added'),
    removedCount: count('node', 'removed'),
    updatedCount: count('node', 'updated'),
    addedEdgeCount: count('edge', 'added'),
    removedEdgeCount: count('edge', 'removed'),
    updatedEdgeCount: count('edge', 'updated'),
    ...(countMoves ? { movedCount } : {}),
    totalChanges: details.length + movedCount,
    details,
  };
}

export function getCanvasFingerprint(graph: DiagramGraph): string {
  return fingerprint({
    nodes: graph.nodes.map((node) => ({
      id: node.id, ...nodeContent(node), position: node.position,
    })).sort((a, b) => a.id.localeCompare(b.id)),
    edges: graph.edges.map((edge) => ({
      source: edge.source, target: edge.target, ...edgeContent(edge),
      sourceHandle: edge.sourceHandle,
      targetHandle: edge.targetHandle,
      markerStart: edge.markerStart,
      markerEnd: edge.markerEnd,
      hidden: edge.hidden || undefined,
    })).sort((a, b) => fingerprint(a).localeCompare(fingerprint(b))),
  });
}
