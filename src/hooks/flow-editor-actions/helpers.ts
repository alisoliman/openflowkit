import { getCompatibleNodesBounds } from '@/lib/reactflowCompat';
import { createId } from '@/lib/id';
import type { FlowEdge, FlowNode } from '@/lib/types';
import type { FlowTemplate } from '@/services/templates';
import { assignSmartHandles } from '@/services/smartEdgeRouting';

interface TemplateInsertionResult {
    newNodes: FlowNode[];
    newEdges: FlowEdge[];
}

export function buildInsertedTemplateData(
    template: FlowTemplate,
    existingNodes: FlowNode[]
): TemplateInsertionResult {
    const bounds = getCompatibleNodesBounds(existingNodes);
    const startX = (bounds.width || 0) + (bounds.x || 0) + 100;
    const startY = bounds.y || 0;

    const newNodes = template.nodes.map((node) => {
        return {
            ...node,
            id: createId(node.id),
            position: { x: node.position.x + startX, y: node.position.y + startY },
            selected: false,
        };
    });

    const idMap = new Map<string, string>();
    template.nodes.forEach((node, index) => {
        idMap.set(node.id, newNodes[index].id);
    });

    const insertedEdges = template.edges.map((edge) => {
        return {
            ...edge,
            id: createId(edge.id),
            source: idMap.get(edge.source) || edge.source,
            target: idMap.get(edge.target) || edge.target,
        };
    });

    // Most template edges leave their handles to routing. Without one, React Flow attaches the
    // edge to each node's first handle (the top), so it loops back through its source node.
    const unroutedEdges = insertedEdges.filter((edge) => !edge.sourceHandle && !edge.targetHandle);
    const routedEdgesById = new Map(
        assignSmartHandles(newNodes, unroutedEdges).map((edge) => [edge.id, edge])
    );
    const newEdges = insertedEdges.map((edge) => routedEdgesById.get(edge.id) ?? edge);

    return { newNodes, newEdges };
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}
