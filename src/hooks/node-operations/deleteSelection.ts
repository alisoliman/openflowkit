import type { FlowEdge, FlowNode } from '@/lib/types';
import { autoFitSectionsToChildren, unparentSectionChildren } from './sectionOperations';

export interface FlowElementIds {
  nodeIds: string[];
  edgeIds: string[];
}

interface SelectionState {
  nodes: FlowNode[];
  edges: FlowEdge[];
  selectedNodeId: string | null;
  selectedEdgeId: string | null;
}

/**
 * What the user sees selected: React Flow's selection plus the node or edge the inspector shows,
 * which some flows (adding a node, search, layers) set without flagging it in React Flow.
 */
export function getSelectedElementIds({
  nodes,
  edges,
  selectedNodeId,
  selectedEdgeId,
}: SelectionState): FlowElementIds {
  const nodeIds = new Set(nodes.filter((node) => node.selected).map((node) => node.id));
  const edgeIds = new Set(edges.filter((edge) => edge.selected).map((edge) => edge.id));
  if (selectedNodeId) nodeIds.add(selectedNodeId);
  if (selectedEdgeId) edgeIds.add(selectedEdgeId);
  return { nodeIds: [...nodeIds], edgeIds: [...edgeIds] };
}

/**
 * Removes nodes and edges, along with the edges of removed nodes. A removed section releases
 * the children that are not removed themselves. Returns null when nothing matches.
 */
export function removeFlowElements(
  nodes: FlowNode[],
  edges: FlowEdge[],
  { nodeIds, edgeIds }: FlowElementIds
): { nodes: FlowNode[]; edges: FlowEdge[] } | null {
  const removedNodeIds = new Set(nodeIds.filter((id) => nodes.some((node) => node.id === id)));
  const removedEdgeIds = new Set(edgeIds);
  const nextEdges = edges.filter(
    (edge) =>
      !removedEdgeIds.has(edge.id)
      && !removedNodeIds.has(edge.source)
      && !removedNodeIds.has(edge.target)
  );
  if (removedNodeIds.size === 0 && nextEdges.length === edges.length) {
    return null;
  }

  const releasedNodes = nodes
    .filter((node) => node.type === 'section' && removedNodeIds.has(node.id))
    .reduce((currentNodes, section) => unparentSectionChildren(section.id, currentNodes), nodes);
  const nextNodes = autoFitSectionsToChildren(
    releasedNodes.filter((node) => !removedNodeIds.has(node.id))
  );
  return { nodes: nextNodes, edges: nextEdges };
}
